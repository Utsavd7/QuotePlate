import { createHash, randomBytes } from 'node:crypto';
import { createServer, request as requestHttp } from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import { build } from 'esbuild';
import { encode } from 'next-auth/jwt';

const nextAuthPath = /^\/api\/auth\/(?:providers|session|csrf|signin(?:\/[^/?]+)?|callback\/[^/?]+|signout|error)(?:[/?]|$)/;

function compactRequestDocuments({ itemId, itemName, quantity, supplierId }) {
  return {
    items: {
      v: 1,
      items: [{
        id: itemId,
        itemKey: itemName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        name: itemName,
        quantity,
        unit: 'KILOGRAM',
        specification: {
          v: 1,
          category: 'VEGETABLES',
          description: null,
          preferredBrand: null,
          packSize: null,
          qualityGrade: null,
          notes: null,
          referenceUrl: null,
          thumbnailWebpBase64: null,
        },
        sourcingOverride: null,
      }],
    },
    sourcing: {
      v: 1,
      default: {
        v: 1,
        modes: ['CURRENT'],
        currentSupplierIds: [supplierId],
        selectedNewSupplierIds: [],
        acceptVerifiedApplications: false,
      },
    },
  };
}

function bodyBuffer(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.once('end', () => resolveBody(Buffer.concat(chunks)));
    request.once('error', reject);
  });
}

async function webRequest(request, origin) {
  const body = await bodyBuffer(request);
  return new Request(new URL(request.url ?? '/', origin), {
    method: request.method,
    headers: request.headers,
    body: body.length ? body : undefined,
  });
}

async function sendWebResponse(response, nodeResponse) {
  for (const [name, value] of response.headers) {
    if (name !== 'set-cookie') nodeResponse.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length) nodeResponse.setHeader('set-cookie', cookies);
  nodeResponse.statusCode = response.status;
  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
}

function json(nodeResponse, status, value) {
  nodeResponse.writeHead(status, { 'content-type': 'application/json' });
  nodeResponse.end(JSON.stringify(value));
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function providerPage(url) {
  const redirectUri = url.searchParams.get('redirect_uri') ?? '';
  const state = url.searchParams.get('state') ?? '';
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Local OAuth provider</title></head>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
  <main>
    <p>Test infrastructure · not Google-hosted</p>
    <h1>Local OAuth provider</h1>
    <form method="post">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
      <input type="hidden" name="state" value="${escapeHtml(state)}">
      <p><label>Provider email<br><input name="email" type="email" required></label></p>
      <p><label>Provider subject<br><input name="subject" required></label></p>
      <p><label><input name="email_verified" type="checkbox" checked> Verified email</label></p>
      <button name="action" value="authorize">Authorize</button>
      <button formnovalidate name="action" value="provider-error">Return provider error</button>
    </form>
  </main>
</body>
</html>`;
}

async function compileLocalNextAuth(projectRoot, supportDirectory) {
  await rm(supportDirectory, { recursive: true, force: true });
  await mkdir(supportDirectory, { recursive: true });
  const outfile = join(supportDirectory, 'local-nextauth.cjs');
  await build({
    absWorkingDir: projectRoot,
    bundle: true,
    entryPoints: [join(projectRoot, 'test-support/local-nextauth.ts')],
    external: ['@node-rs/argon2', '@prisma/client'],
    format: 'cjs',
    logLevel: 'silent',
    outfile,
    platform: 'node',
    sourcemap: false,
    target: 'node20',
    tsconfig: join(projectRoot, 'tsconfig.json'),
  });
  const localNextAuthModule = createRequire(import.meta.url)(outfile);
  return localNextAuthModule.handleLocalNextAuth;
}

function proxyToApplication(request, response, upstreamPort) {
  const upstream = requestHttp(
    {
      hostname: '127.0.0.1',
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers: request.headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.once('error', () => {
    if (!response.headersSent) json(response, 502, { error: 'Application is starting.' });
    else response.destroy();
  });
  request.pipe(upstream);
}

export async function startAuthGateway({
  admin,
  appPort,
  gatewayPort,
  liveGoogle,
  projectRoot,
  supportDirectory,
}) {
  const origin = `http://127.0.0.1:${gatewayPort}`;
  const authorizationCodes = new Map();
  const accessTokens = new Map();
  const handleLocalNextAuth = liveGoogle
    ? null
    : await compileLocalNextAuth(resolve(projectRoot), supportDirectory);
  let seedInternalDemo;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', origin);
    try {
      if (url.pathname === '/__test/database/internal-demo' && request.method === 'POST') {
        if (!seedInternalDemo) {
          const outfile = join(supportDirectory, 'internal-demo.cjs');
          await build({ absWorkingDir: projectRoot, bundle: true, entryPoints: [join(projectRoot, 'scripts/demo/seed-demo.ts')], packages: 'external', format: 'cjs', outfile, platform: 'node', logLevel: 'silent', tsconfig: join(projectRoot, 'tsconfig.json') });
          seedInternalDemo = createRequire(import.meta.url)(outfile).seedDemoRestaurant;
        }
        json(response, 201, await seedInternalDemo(admin, 'Local-only demo password 42!', new Date()));
        return;
      }
      if (!liveGoogle && nextAuthPath.test(url.pathname)) {
        const authResponse = await handleLocalNextAuth(
          await webRequest(request, origin),
        );
        await sendWebResponse(authResponse, response);
        return;
      }

      if (url.pathname === '/__test/oauth/authorize' && request.method === 'GET') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(providerPage(url));
        return;
      }

      if (url.pathname === '/__test/oauth/authorize' && request.method === 'POST') {
        const fields = new URLSearchParams((await bodyBuffer(request)).toString('utf8'));
        const callback = new URL(fields.get('redirect_uri') ?? origin);
        callback.port = String(gatewayPort);
        callback.searchParams.set('state', fields.get('state') ?? '');
        if (fields.get('action') === 'provider-error') {
          callback.searchParams.set('error', 'server_error');
          callback.searchParams.set('error_description', 'Local provider unavailable');
        } else {
          const code = randomBytes(24).toString('hex');
          authorizationCodes.set(code, {
            sub: fields.get('subject') ?? '',
            name: 'Local OAuth User',
            email: fields.get('email') ?? '',
            email_verified: fields.get('email_verified') === 'on',
            picture: null,
          });
          callback.searchParams.set('code', code);
        }
        response.writeHead(302, { location: callback.toString() });
        response.end();
        return;
      }

      if (url.pathname === '/__test/oauth/token' && request.method === 'POST') {
        const fields = new URLSearchParams((await bodyBuffer(request)).toString('utf8'));
        const profile = authorizationCodes.get(fields.get('code'));
        if (!profile) {
          json(response, 400, { error: 'invalid_grant' });
          return;
        }
        authorizationCodes.delete(fields.get('code'));
        const token = randomBytes(24).toString('hex');
        accessTokens.set(token, profile);
        json(response, 200, {
          access_token: token,
          token_type: 'Bearer',
          expires_in: 300,
          scope: 'openid email profile',
        });
        return;
      }

      if (url.pathname === '/__test/oauth/userinfo' && request.method === 'GET') {
        const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
        const profile = accessTokens.get(token);
        if (!profile) {
          json(response, 401, { error: 'invalid_token' });
          return;
        }
        json(response, 200, profile);
        return;
      }

      if (url.pathname === '/__test/database/reset-workspace-client-rate-limit' && request.method === 'POST') {
        // next start has no trusted hosting proxy, so all local signup fixtures
        // share this client bucket. Reset only it, preserving email limits and data.
        const subjectDigest = createHash('sha256')
          .update('quoteplate:v1:auth-rate-limit-subject:client:production-unidentified')
          .digest('hex');
        const keyDigest = createHash('sha256')
          .update('quoteplate:v1:rate-limit:auth-workspace-create-client:')
          .update(subjectDigest, 'ascii')
          .digest('hex');
        await admin.rateLimitBucket.deleteMany({ where: { keyDigest } });
        response.writeHead(204).end();
        return;
      }

      if (url.pathname === '/__test/database/reset-quote-submit-client-rate-limit' && request.method === 'POST') {
        // Only the production-mode localhost quote-submission client bucket.
        // Preserve per-grant quotas, quote-access limits, and all application data.
        const subjectDigest = createHash('sha256')
          .update('quoteplate:v1:public-client:quote-submit:', 'utf8')
          .update('production-unidentified', 'utf8')
          .digest('hex');
        const keyDigest = createHash('sha256')
          .update('quoteplate:v1:rate-limit:supplier-quote-submit-client:', 'utf8')
          .update(subjectDigest, 'ascii')
          .digest('hex');
        await admin.rateLimitBucket.deleteMany({ where: { keyDigest } });
        response.writeHead(204).end();
        return;
      }

      if (url.pathname === '/__test/database/identity-lookup' && request.method === 'POST') {
        const body = JSON.parse((await bodyBuffer(request)).toString('utf8'));
        const privilege = body.available ? 'GRANT' : 'REVOKE';
        const recipient = body.available ? 'TO' : 'FROM';
        await admin.$executeRawUnsafe(
          `${privilege} EXECUTE ON FUNCTION autorfp_private.autorfp_auth_identity_by_google_subject(TEXT) ${recipient} autorfp_app`,
        );
        response.writeHead(204).end();
        return;
      }

      if (url.pathname === '/__test/database/user-active' && request.method === 'POST') {
        const body = JSON.parse((await bodyBuffer(request)).toString('utf8'));
        const changed = await admin.$executeRawUnsafe(
          'UPDATE public."User" SET "isActive" = $1 WHERE "email" = $2',
          body.active === true,
          String(body.email ?? '').trim().toLowerCase(),
        );
        if (changed !== 1) {
          json(response, 404, { error: 'User fixture was not found.' });
          return;
        }
        response.writeHead(204).end();
        return;
      }

      if (
        url.pathname === '/__test/database/procurement-export-journey' &&
        request.method === 'POST'
      ) {
        const body = JSON.parse((await bodyBuffer(request)).toString('utf8'));
        const email = String(body.email ?? '').trim().toLowerCase();
        const user = await admin.user.findUnique({
          where: { email },
          select: { id: true, tenantId: true },
        });
        if (!user) {
          json(response, 404, { error: 'Export journey owner was not found.' });
          return;
        }
        const suffix = randomBytes(8).toString('hex');
        const supplierId = `e2e-supplier-${suffix}`;
        const requestId = `e2e-request-${suffix}`;
        const itemId = `e2e-item-${suffix}`;
        const grantId = `e2e-grant-${suffix}`;
        const supplierName = 'GreenLeaf Export Foods';
        const itemName = 'Tomato';
        // Opt-in only: preserve existing export/readiness journeys while giving
        // collaboration E2E real competing allocations to exclude from the portal.
        const competitor = body.vendorCollaboration === true ? {
          supplierId: `e2e-competitor-${suffix}`,
          grantId: `e2e-competitor-grant-${suffix}`,
          supplierName: 'Private Rival Produce',
          itemId: `e2e-rival-item-${suffix}`,
          itemName: 'Private rival shallots',
        } : null;
        const documents = compactRequestDocuments({ itemId, itemName, quantity: '100', supplierId });
        if (competitor) {
          documents.sourcing.default.currentSupplierIds.push(competitor.supplierId);
          documents.items.items.push(...compactRequestDocuments({
            itemId: competitor.itemId, itemName: competitor.itemName,
            quantity: '20', supplierId: competitor.supplierId,
          }).items.items);
        }
        await admin.$transaction(async (transaction) => {
          await transaction.supplier.create({
            data: {
              id: supplierId,
              tenantId: user.tenantId,
              businessName: supplierName,
              contactName: 'Meera Shah',
              phone: '9876543210',
              whatsappNumber: '9876543210',
              email: 'orders@greenleaf.example',
              addressLine: '7 APMC Yard',
              city: 'Pune',
              state: 'Maharashtra',
              pin: '411037',
              gstin: '27ABCDE9999F1Z1',
              capabilities: { v: 1, categories: [], items: [] },
              verificationStatus: 'VERIFIED',
              verifiedAt: new Date(),
              verifiedByUserId: user.id,
            },
          });
          await transaction.procurementRequest.create({
            data: {
              id: requestId,
              tenantId: user.tenantId,
              title: 'Fresh produce · Export journey',
              status: 'OPEN',
              version: 2,
              ...documents,
              deliveryDetails: {
                addressLine: '18 Koregaon Park Road',
                city: 'Pune',
                state: 'Maharashtra',
                pin: '411001',
                instructions: 'Deliver before 8:00 AM.',
              },
              deliveryDate: new Date('2099-09-05T00:00:00.000Z'),
              quoteDeadline: new Date('2099-09-03T10:00:00.000Z'),
              commercialTerms: 'Payment in 15 days.',
              openedAt: new Date(),
              createdByUserId: user.id,
            },
          });
          await transaction.supplierRequest.create({
            data: {
              id: grantId,
              tenantId: user.tenantId,
              requestId,
              supplierId,
              tokenDigest: randomBytes(32).toString('hex'),
              expiresAt: new Date('2099-09-03T10:00:00.000Z'),
              quoteRevisions: { v: 1, revisions: [] },
            },
          });
          if (competitor) {
            await transaction.supplier.create({ data: {
              id: competitor.supplierId, tenantId: user.tenantId,
              businessName: competitor.supplierName,
              capabilities: { v: 1, categories: [], items: [] },
              relationshipType: 'CURRENT',
              verificationStatus: 'VERIFIED',
              verifiedAt: new Date(),
              verifiedByUserId: user.id,
            } });
            await transaction.supplierRequest.create({ data: {
              id: competitor.grantId, tenantId: user.tenantId, requestId,
              supplierId: competitor.supplierId,
              tokenDigest: randomBytes(32).toString('hex'),
              expiresAt: new Date('2099-09-03T10:00:00.000Z'),
              quoteRevisions: { v: 1, revisions: [] },
            } });
          }
        });
        json(response, 201, {
          requestId,
          itemId,
          itemName,
          supplierName,
          supplierId,
          grantId,
          ...(competitor ? { competitor } : {}),
        });
        return;
      }

      if (
        url.pathname === '/__test/database/load-organizations' &&
        request.method === 'POST'
      ) {
        const organizations = [];
        const sessionSecret = process.env.NEXTAUTH_SECRET;
        if (!sessionSecret) {
          json(response, 503, { error: 'Local session secret is unavailable.' });
          return;
        }
        for (let index = 1; index <= 20; index += 1) {
          const suffix = String(index).padStart(2, '0');
          const tenantId = `load-tenant-${suffix}`;
          const userId = `load-owner-${suffix}`;
          const supplierId = `load-supplier-${suffix}`;
          const requestId = `load-request-${suffix}`;
          const itemId = `load-item-${suffix}`;
          const supplierRequestId = `load-grant-${suffix}`;
          const restaurantName = `Load Restaurant ${suffix}`;
          const rawToken = randomBytes(32).toString('base64url');
          const tokenDigest = createHash('sha256')
            .update('quoteplate:v1:supplier-request:', 'utf8')
            .update(rawToken, 'ascii')
            .digest('hex');
          await admin.$transaction(async (transaction) => {
            await transaction.tenant.create({
              data: {
                id: tenantId,
                name: restaurantName,
                addressLine: `${index} Market Road`,
                city: 'Pune',
                state: 'Maharashtra',
                pin: `4110${suffix}`,
                phone: `90000000${suffix}`,
              },
            });
            await transaction.user.create({
              data: {
                id: userId,
                tenantId,
                name: `Load Owner ${suffix}`,
                email: `load-owner-${suffix}@example.test`,
                role: 'OWNER',
              },
            });
            await transaction.supplier.create({
              data: {
                id: supplierId,
                tenantId,
                businessName: `Load Supplier ${suffix}`,
                contactName: `Supplier Contact ${suffix}`,
                phone: `91111111${suffix}`,
                capabilities: { v: 1, categories: [], items: [] },
                verificationStatus: 'VERIFIED',
                verifiedAt: new Date(),
                verifiedByUserId: userId,
              },
            });
            await transaction.procurementRequest.create({
              data: {
                id: requestId,
                tenantId,
                title: `Load produce request ${suffix}`,
                status: 'OPEN',
                version: 2,
                ...compactRequestDocuments({
                  itemId,
                  itemName: 'Tomato',
                  quantity: '10',
                  supplierId,
                }),
                deliveryDetails: {
                  addressLine: `${index} Market Road`,
                  city: 'Pune',
                  state: 'Maharashtra',
                  pin: `4110${suffix}`,
                },
                deliveryDate: new Date('2099-09-20T00:00:00.000Z'),
                quoteDeadline: new Date('2099-09-15T10:00:00.000Z'),
                commercialTerms: 'Payment in 15 days.',
                openedAt: new Date(),
                createdByUserId: userId,
              },
            });
            await transaction.supplierRequest.create({
              data: {
                id: supplierRequestId,
                tenantId,
                requestId,
                supplierId,
                tokenDigest,
                expiresAt: new Date('2099-09-15T10:00:00.000Z'),
                quoteRevisions: { v: 1, revisions: [] },
              },
            });
          });
          const sessionToken = await encode({
            secret: sessionSecret,
            token: { userId, tenantId },
            maxAge: 60 * 60,
          });
          organizations.push({
            id: `load-org-${suffix}`,
            sessionCookie: `next-auth.session-token=${sessionToken}`,
            isolationMarker: {
              path: '/api/settings',
              jsonPath: 'workspace.name',
              equals: restaurantName,
            },
            authenticatedReads: [
              { name: 'overview', path: '/api/overview' },
              { name: 'requests', path: '/api/requests?limit=5' },
            ],
            supplierQuote: {
              token: rawToken,
              isolationMarker: {
                jsonPath: 'restaurantName',
                equals: restaurantName,
              },
              submission: {
                expectedLatestRevision: 0,
                deliveryDate: '2099-09-20',
                validUntil: '2099-09-15',
                freightInr: '0',
                commercialTerms: 'Payment in 15 days.',
                notes: 'Bounded local launch load verification.',
                items: [{
                  requestItemId: itemId,
                  noQuote: false,
                  availableQuantity: '10',
                  unit: 'KILOGRAM',
                  unitRateInr: '50',
                  gstPercent: '5',
                  taxInclusive: false,
                  substitution: null,
                }],
              },
            },
          });
        }
        json(response, 201, {
          schemaVersion: 1,
          readinessPath: '/api/health/ready',
          organizations,
        });
        return;
      }

      proxyToApplication(request, response, appPort);
    } catch (error) {
      console.error(error);
      if (!response.headersSent) json(response, 500, { error: 'Test gateway failed.' });
      else response.destroy();
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(gatewayPort, '127.0.0.1', resolveListen);
  });
  return server;
}
