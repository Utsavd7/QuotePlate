import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import {
  deactivateWorkspaceMember,
  getWorkspaceSettings,
  updateWorkspaceSettings,
  WorkspaceSettingsValidationError,
} from '@/lib/account/workspace-settings';
import { privateNoStoreResponse as privateResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import {
  InvalidJsonBodyError,
  readBoundedJson,
  RequestBodyTooLargeError,
} from '@/lib/api/read-bounded-json';
import {
  AuthorizationError,
  LastActiveOwnerError,
  requireOwner,
} from '@/lib/auth/guards';
import { requireAccountContext } from '@/lib/server-account';
import { authOptions } from '@/lib/auth';
import { browserJsonMutationRejection } from '@/lib/security/browser-mutation';

const SETTINGS_BODY_BYTES = 16 * 1_024;

function settingsProblem(error: unknown) {
  if (error instanceof WorkspaceSettingsValidationError) {
    return privateResponse(problemResponse(
      422,
      'Check restaurant details',
      error.message,
      { errors: error.errors },
    ));
  }
  if (error instanceof LastActiveOwnerError) {
    return privateResponse(problemResponse(409, 'Owner required', error.message));
  }
  if (error instanceof AuthorizationError) {
    return privateResponse(problemResponse(
      403,
      'Forbidden',
      'You do not have permission to manage this workspace.',
    ));
  }
  if (error instanceof RequestBodyTooLargeError) {
    return privateResponse(problemResponse(
      413,
      'Request too large',
      'Settings changes must be smaller than 16 KB.',
    ));
  }
  if (error instanceof InvalidJsonBodyError) {
    return privateResponse(problemResponse(
      400,
      'Invalid request',
      'Provide a valid JSON object.',
    ));
  }
  return privateResponse(problemResponse(
    503,
    'Settings unavailable',
    'Unable to load or save workspace settings right now. Try again shortly.',
  ));
}

function unauthorized() {
  return privateResponse(problemResponse(
    401,
    'Unauthorized',
    'Authentication is required.',
  ));
}

function ownerDenied(detail: string) {
  return privateResponse(problemResponse(403, 'Owner access required', detail));
}

function mutationRejected(request: Request) {
  const rejection = browserJsonMutationRejection(request);
  if (rejection === 'CROSS_ORIGIN') {
    return privateResponse(problemResponse(
      403,
      'Request not allowed',
      'Make this change from the QuotePlate workspace page.',
    ));
  }
  if (rejection === 'UNSUPPORTED_MEDIA_TYPE') {
    return privateResponse(problemResponse(
      415,
      'Unsupported media type',
      'Send this request as application/json.',
    ));
  }
  return null;
}

async function settingsBody(request: Request) {
  const value = await readBoundedJson(request, SETTINGS_BODY_BYTES);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidJsonBodyError();
  }
  return value as Record<string, unknown>;
}

function actorFor(context: NonNullable<Awaited<ReturnType<typeof requireAccountContext>>>) {
  return { tenantId: context.tenant.id, userId: context.user.id };
}

export async function GET() {
  const started = performance.now();
  let session;
  try {
    session = await getServerSession(authOptions);
  } catch (error) {
    return settingsProblem(error);
  }
  const userId = session?.user?.userId;
  const tenantId = session?.user?.tenantId;
  if (typeof userId !== 'string' || !userId || typeof tenantId !== 'string' || !tenantId) return unauthorized();
  const sessionFinished = performance.now();
  try {
    // The settings operation checks the active user, tenant and current role in
    // its own transaction. Loading the account here first repeats that DB work.
    const settings = await getWorkspaceSettings({ actor: { userId, tenantId } });
    const response = privateResponse(NextResponse.json(settings));
    response.headers.set('Server-Timing',
      `session;dur=${(sessionFinished - started).toFixed(1)}, settings;dur=${(performance.now() - sessionFinished).toFixed(1)}`);
    return response;
  } catch (error) {
    return settingsProblem(error);
  }
}

export async function PATCH(request: Request) {
  let context;
  try {
    context = await requireAccountContext();
  } catch (error) {
    return settingsProblem(error);
  }
  if (!context) return unauthorized();
  try {
    requireOwner(context.user, 'manage-settings');
  } catch {
    return ownerDenied('Only workspace owners can change these settings.');
  }
  const rejected = mutationRejected(request);
  if (rejected) return rejected;
  try {
    const body = await settingsBody(request);
    return privateResponse(NextResponse.json(
      await updateWorkspaceSettings({
        actor: actorFor(context),
        details: body.details,
      }),
    ));
  } catch (error) {
    return settingsProblem(error);
  }
}

export async function POST(request: Request) {
  let context;
  try {
    context = await requireAccountContext();
  } catch (error) {
    return settingsProblem(error);
  }
  if (!context) return unauthorized();
  try {
    requireOwner(context.user, 'manage-members');
  } catch {
    return ownerDenied('Only workspace owners can manage people.');
  }
  const rejected = mutationRejected(request);
  if (rejected) return rejected;

  try {
    const body = await settingsBody(request);
    const actor = actorFor(context);
    if (body.action === 'deactivate-member') {
      await deactivateWorkspaceMember({ actor, userId: body.userId });
      return privateResponse(NextResponse.json({ ok: true }));
    }
    return privateResponse(problemResponse(
      400,
      'Invalid action',
      'Choose a valid people action.',
    ));
  } catch (error) {
    return settingsProblem(error);
  }
}
