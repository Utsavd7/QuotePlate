# Public Google onboarding verification — 2026-09-11

**Result: production OAuth initiation verified; full public signup NOT verified.** Reviewed checkout `54c1cd0` (PR #37 merged, per task context). The deployed commit was not independently established. No confirmed application defect was found in the reviewed boundaries.

## Observed production evidence

At `2026-09-11T10:36:31Z`, a fresh Playwright Chromium browser/context opened [production sign-in](https://quoteplate.netlify.app/signin), received HTTP 200, and clicked **Continue with Google**. No browser profile, existing cookies, account selection, identity entry, or consent was used. The browser was closed afterward.

| Check | Observed result |
| --- | --- |
| Authorization endpoint | `https://accounts.google.com/o/oauth2/v2/auth` |
| Requested redirect URI | `https://quoteplate.netlify.app/api/auth/callback/google` |
| Scope | `openid email profile` |
| Response type | `code` |
| OAuth state | Present; value not recorded |
| PKCE | Challenge present, method `S256`; values not recorded |
| Client ID | Present; value not recorded |
| Google landing | `accounts.google.com/v3/signin/identifier`, title **Sign in - Google Accounts** |
| Initial provider errors | No `redirect_uri_mismatch`, `invalid_client`, or **Access blocked** text observed at this pre-authentication boundary |
| QuotePlate cookies | CSRF, callback URL, state, and PKCE verifier cookies all `Secure`, `HttpOnly`, `SameSite=Lax`, path `/`; values not recorded |

The button was initially disabled at DOM readiness; its normal click subsequently succeeded after hydration. `src/components/auth/AuthForm.tsx` explicitly disables it until hydration. This was not a persistent disabled-button failure. The Google identifier input had not appeared in the immediate DOM sample; no assertion about later Google page usability is made.

The sandbox initially prevented Chromium launch; the authorized isolated-browser retry succeeded. That was a local execution limitation, not a production error.

## External configuration: evidence and limits

- Connected Chrome and Codex in-app browser tab listings contained no Google Cloud Console page. Chrome's existing user-owned tabs were also checked. No personal mailbox was opened, and no Google Console navigation, login, or changes were attempted.
- The redirect establishes that production supplies a Google client ID and initiates the expected authorization flow. Code enables that provider only when both Google client settings are nonempty. It does **not** validate the client secret at token exchange, public audience eligibility, database credentials, or successful callback handling.
- Production-only Google/session/database environment scoping and preview authentication being disabled are supplied task context, not independently inspected deployment settings. No environment values were read or changed.
- An operator still needs to inspect the matching Google OAuth web client: exact authorized redirect URI above; audience **External**; actual publishing status; configured scopes and any verification/restriction notices. Confirm client and production environment correspondence without copying secrets. Record results before asserting public availability.
- **Testing does not automatically block public access.** Google's [OAuth app state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) (checked 2026-09-11) explicitly exempts External/Testing apps requesting only `openid`, `email`, and `profile` from the test-user allowlist requirement: users outside the list can access, with a testing warning. The observed QuotePlate request uses exactly those scopes, so Testing alone would not establish an onboarding blocker. Google Workspace administrator restrictions can still prevent access regardless of publishing status. Actual Console settings and a consenting external user's completed flow remain unverified.

## Code and test findings

- `src/lib/auth/start-handler.ts`: production Google signup has no pilot-email allowlist; password-only owner creation is rejected. Same-origin JSON, body size, rate limits, configuration checks, and encrypted onboarding cookies guard the start handler. Tests cover absent and nonmatching legacy allowlists, 403/415/413/429 responses, missing configuration, and safe errors. **No production signup POST was submitted.**
- `src/lib/auth/google-identity.ts`: requires canonical matching provider subject, literal `email_verified === true`, and an email matching onboarding before owner creation. Standalone sign-in cannot create an unknown owner. Existing password/invited emails cannot be silently linked or converted into owners; inactive users/tenants are rejected. Duplicate callback races and safe database-error mapping are tested.
- `src/lib/auth/oauth-start.ts` and `request-options.ts`: encrypted ten-minute onboarding data is bound to the signup flow and OAuth state; callback cookies are isolated between requests and cleared on callback. Tests cover expiry, tampering, oversized cookies, abandoned signup state, and out-of-order callbacks. `src/lib/auth.ts` retains only stable user/tenant IDs in application JWTs.
- `src/lib/members/invitations.ts` and `invitation-handlers.ts`: invitation acceptance remains a separate token-and-matching-email/password flow. Tests cover owner authorization, one-time digest handling, unavailable/replayed/mismatched links, throttling, request boundaries, and private error responses. Google verification of a new owner does not establish that invitation recipients underwent Google verification.

Fresh verification: **12 suites, 111 tests passed, zero failures**; exit 0. Reproduce from the repository root:

```sh
npm test -- --runTestsByPath \
  __tests__/auth/google-oauth.test.ts \
  __tests__/auth/options.test.ts \
  __tests__/auth/request-options.test.ts \
  __tests__/auth/oauth-start.test.ts \
  __tests__/auth/pilot-access.test.ts \
  __tests__/auth/google-client.test.ts \
  __tests__/auth/client-errors.test.ts \
  __tests__/api/auth-start.test.ts \
  __tests__/api/invitations.test.ts \
  __tests__/api/invitation-handlers.test.ts \
  __tests__/api/invitation-route-privacy.test.ts \
  __tests__/security/invitation-origin.test.ts --no-cache
```

These are isolated tests, not production database proof. The existing `auth-rls-bootstrap` and `member-invitations` integration tests were reviewed for database bootstrap and atomic lifecycle coverage but **not run**. No database/performance/client changes were made. `tests/e2e/google-live.spec.ts` is credential-gated and checks only provider navigation; it was not run or treated as full signup evidence.

## Recorded check output

The following sanitized results were captured during the verification above. No separate HAR, screenshot or browser trace was saved. The exact test command is provided under Code and test findings.

Captured test summary from that run (not a new run):

```text
Test Suites: 12 passed, 12 total
Tests:       111 passed, 111 total
Snapshots:   0 total
Time:        1.174 s
```

Sanitized browser-output excerpt from that run:

```json
{"host":"accounts.google.com","path":"/o/oauth2/v2/auth","redirect_uri":"https://quoteplate.netlify.app/api/auth/callback/google","scope":"openid email profile","response_type":"code","state_present":true,"pkce_method":"S256","pkce_present":true,"client_id_present":true}
```

## Remaining person-required verification

1. An authorized operator records the external configuration checks above and confirms the deployed revision and production environment scopes.
2. A real consenting restaurant owner, using a verified Google account with no existing QuotePlate user or pending invitation, enters their real restaurant details through **Get started**, selects that same Google email, and personally completes authorization. For evidence of public access, use an eligible external account outside any configured test-user list.
3. Verify return to QuotePlate and access to the new workspace. Through authorized inspection, confirm exactly one active tenant/OWNER identity, correct restaurant details, successful sign-out/returning sign-in, and no duplicate workspace. Record date, deployed revision, outcome, and any sanitized error; omit emails, tokens, cookies, secrets, and authorization codes.

To repeat the consent-free check, use a fresh headless context on `/signin`, wait for the Google button to enable, click once, and stop at the first Google sign-in page. Record only the allowlisted redirect fields in the table. Never use the restaurant signup form, select an account, or grant consent for this probe. Reaching Google alone must not be reported as successful new-user onboarding.
