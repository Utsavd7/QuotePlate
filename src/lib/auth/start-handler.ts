import { NextResponse } from 'next/server';

import {
  InvalidJsonBodyError,
  readBoundedJson,
  RequestBodyTooLargeError,
} from '@/lib/api/read-bounded-json';
import {
  googleAuthAvailable,
  type AuthEnvironment,
} from '@/lib/auth';
import {
  createEmailWorkspace,
  EmailSignupError,
  type EmailSignupInput,
} from '@/lib/auth/email-signup';
import {
  createGoogleOnboardingCookie,
  GoogleOnboardingError,
} from '@/lib/auth/oauth-start';
import { consumeWorkspaceCreationRateLimit } from '@/lib/auth/rate-limit';
import { productionEmailOwnerSignupAllowed } from '@/lib/auth/pilot-access';
import {
  browserJsonMutationRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';

const MAX_SIGNUP_BODY_BYTES = 16 * 1_024;
const GENERIC_SIGNUP_ERROR =
  'Unable to create the workspace right now. Try again shortly.';

type AuthStartDependencies = {
  env: AuthEnvironment;
  emailSignup: typeof createEmailWorkspace;
  now: () => Date;
  rateLimit: typeof consumeWorkspaceCreationRateLimit;
};

function errorResponse(error: unknown) {
  if (error instanceof EmailSignupError) {
    return privateMutationResponse(NextResponse.json({ error: error.message }, { status: error.status }));
  }
  if (error instanceof GoogleOnboardingError) {
    return privateMutationResponse(NextResponse.json({ error: error.message }, { status: 400 }));
  }
  return privateMutationResponse(NextResponse.json(
    { error: GENERIC_SIGNUP_ERROR },
    { status: 503 },
  ));
}

function invalidBodyResponse(error: unknown) {
  if (error instanceof RequestBodyTooLargeError) {
    return privateMutationResponse(NextResponse.json(
      { error: 'Signup details must be smaller than 16 KB.' },
      { status: 413 },
    ));
  }
  if (error instanceof InvalidJsonBodyError) {
    return privateMutationResponse(NextResponse.json(
      { error: 'Send valid signup details.' },
      { status: 400 },
    ));
  }
  return null;
}

export function createAuthStartHandler(dependencies: AuthStartDependencies) {
  return async function authStart(request: Request) {
    const rejected = browserJsonMutationRejection(request, dependencies.env);
    if (rejected) {
      return privateMutationResponse(rejected === 'CROSS_ORIGIN'
        ? NextResponse.json({ error: 'Start signup from the QuotePlate sign-up page.' }, { status: 403 })
        : NextResponse.json({ error: 'Send signup details as application/json.' }, { status: 415 }));
    }
    let body: EmailSignupInput & { method?: string };
    try {
      const parsed = await readBoundedJson(request, MAX_SIGNUP_BODY_BYTES);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new InvalidJsonBodyError();
      }
      body = parsed as EmailSignupInput & { method?: string };
    } catch (error) {
      return invalidBodyResponse(error) ?? errorResponse(error);
    }

    if (body.method !== 'email' && body.method !== 'google') {
      return privateMutationResponse(NextResponse.json(
        { error: 'Choose email or Google signup.' },
        { status: 400 },
      ));
    }

    if (
      body.method === 'email' &&
      !productionEmailOwnerSignupAllowed(dependencies.env)
    ) {
      return privateMutationResponse(NextResponse.json(
        { error: 'Create your workspace with a verified Google email. Password-only signup is unavailable.' },
        { status: 403 },
      ));
    }

    const now = dependencies.now();
    try {
      const rateLimit = await dependencies.rateLimit({
        email: body.email,
        request,
        now,
      });
      if (!rateLimit.allowed) {
        return privateMutationResponse(NextResponse.json(
          { error: GENERIC_SIGNUP_ERROR },
          {
            status: 429,
            headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
          },
        ));
      }
    } catch (error) {
      return errorResponse(error);
    }

    if (body.method === 'email') {
      try {
        await dependencies.emailSignup(body);
        return privateMutationResponse(NextResponse.json({ ok: true }, { status: 201 }));
      } catch (error) {
        if (
          error instanceof EmailSignupError &&
          error.code === 'EMAIL_ALREADY_REGISTERED'
        ) {
          return privateMutationResponse(NextResponse.json({ ok: true }, { status: 201 }));
        }
        return errorResponse(error);
      }
    }

    if (!googleAuthAvailable(dependencies.env)) {
      return privateMutationResponse(NextResponse.json(
        { error: 'Google sign-in is not configured. Try again shortly.' },
        { status: 503 },
      ));
    }
    const secret = dependencies.env.NEXTAUTH_SECRET?.trim();
    if (!secret) {
      return privateMutationResponse(NextResponse.json(
        { error: 'Google sign-in is temporarily unavailable. Try again shortly.' },
        { status: 503 },
      ));
    }

    try {
      const cookie = createGoogleOnboardingCookie(
        {
          restaurantName: body.restaurantName ?? '',
          ownerName: body.ownerName ?? '',
          email: body.email ?? '',
          addressLine: body.addressLine ?? '',
          city: body.city ?? '',
          state: body.state ?? '',
          pin: body.pin ?? '',
          phone: body.phone ?? '',
          timezone: body.timezone,
          gstin: body.gstin,
        },
        {
          secret,
          now,
          secure: dependencies.env.NODE_ENV === 'production',
        },
      );
      const response = NextResponse.json({
        ok: true,
        provider: 'google',
        flowId: cookie.flowId,
      });
      response.cookies.set(cookie.name, cookie.value, cookie.options);
      return privateMutationResponse(response);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
