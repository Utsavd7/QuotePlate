# Procurement gap validation — 11 September 2026

Working revision: `codex/close-procurement-gaps`, based on `f9a2ab6`. This is an implementation/validation record, not a real-user trial or competitor performance claim. Release status will be recorded after deployment.

## Performance method and baseline

Normal internal-demo sign-in in a fresh Chromium context at 1440 × 900. Measure navigation to visible populated controls, then repeat the same navigation within the existing workspace cache lifetime. A fresh browser does not guarantee a cold server. History timing includes Purchases → Past purchases. One baseline run; network and hosting variability apply.

| Page | Production first navigation | Production repeated navigation |
| --- | ---: | ---: |
| Settings | 2,837 ms | 52 ms |
| Suppliers | 3,840 ms | 36 ms |
| Past purchases | 6,658 ms | 83 ms |

Baseline collected at 2026-09-11T07:42:33Z on the existing live release. Settings, Suppliers, History, Insights and Requests list GET handlers now use signed actor IDs followed by their service's current active-user/active-tenant database check. This removes a duplicate account transaction; it does not introduce a cross-user cache or bypass current permissions. Tests cover revoked accounts and unauthenticated access.

Netlify's site/account metadata reports the Free plan and Ohio (`us-east-2`) functions. Saved local production database configuration identifies pooled Neon in Singapore (`ap-southeast-1`); the hosting API masks its database value, so the saved configuration is not independent runtime confirmation. Netlify documents function-region selection for Pro/Enterprise. No paid upgrade or database migration was made. Database distance and first fetches can still produce visible waits; instant first loading is not claimed.

## Checks

- All 27 database integration suites passed: 56 tests against disposable local databases.
- Focused API/service regression checks preserve tenant isolation and current account permissions.
- Production dependency audit: no vulnerabilities reported.
- Public copy checks: 28 passed, covering current signup/landing/legal wording.
- All 157 unit/API suites passed: 1,889 tests.
- Initial browser batch: 48 passed, four breakpoint-specific skips. Two website test failures were incorrect Notes labels; after correcting the test locator, all four website review/save cases passed on laptop and phone.
- All six new intake E2E cases passed on laptop/phone: real local database list-only purchase → public supplier quote → award → checked billed invoice suggestions → explicit delivery save/reload; supplied-approved-menu boundary; real bundled OCR on a synthetic printed-English PNG.
- All eight mounted browser component checks passed, including cancellation, preserving manual values and protecting pending edits while changing sources. Real vendor-photo/handwriting accuracy is not established.
- Final visual/setup/public batch: 65 passed; 15 intentional device-matrix skips. Covers all 14 workspace route patterns at 1440/1366 laptop and phone widths, internal demo edits, pinned layout, responsive public pages, setup-guide rapid navigation/recovery and supplier-contact save.
- Live-network check in the visible browser: explicit lookup of `https://www.shubhamtradingco.in/contact` returned its published sales email with that source and a check time. Selected Use this email, then closed the form without saving or messaging; field preservation and persistence are separately covered by the four browser cases. This verifies one actual website, not broad coverage or delivery capability.
- TypeScript, full lint and whitespace checks passed.
- All 12 laptop/phone video-player cases are covered: ten playback/size/caption/replay cases passed in the final batch, and two transcript recovery cases passed after updating their old narration expectations. Captions default off; scroll playback remains muted until the viewer unmutes.
- The production-mode signup form was independently checked in the browser: one enabled Google button, no password field and no email-only workspace creation button. This checks the actual rendered form, not an external Google authentication journey.
- Final corrected film verified: 165.000 seconds, 4,950 frames, native 3840 × 2400, audio peak −4.9 dBFS, full decode and matching MP4/poster/captions/transcript/credits. Google-only opening and final contact sheet independently inspected. MP4 SHA-256: `03a82e26ef8f7ac07ba7fa575b14bbc30b50c8695249a6d8914ed22bef29abda`.
- Deployed-revision results: pending release.

## Independent review findings

- Tightened loopback-only test signup: remote DNS names beginning with `127.` must not qualify as a loopback address.
- Website lookup review identified malformed-HTML parsing, adjacent prose digits in phone extraction and bare-CR robots rules; all three fixes independently passed re-review and 146 focused tests; the original 1 MB malformed input is rejected in 15 ms.
- Intake review identified corrected rows being discarded when a new photo/source is read; pending review now hides/disables source changes and requires explicit discard before replacement; all eight component regressions and independent re-review preserve edited/manual rows and applied values.
- The PR credential scanner mistook the URL credential-rejection condition for a generic password. The condition was split into a separate rejection statement with identical behavior; 118 website checks and lint passed afterward. There was no credential value in that code. This server-only clarification does not change the recorded UI.

## Remaining external evidence

No unaided restaurant-employee or supplier study has been run. The linked research/trial protocol defines tasks and measures without inventing completion times or savings. Website contacts are sourced leads requiring review, and nearby map coverage is incomplete. Supplier messaging remains manual WhatsApp/Email/Copy; opening a message handler is not sending or receiving a quote. Public Google configuration must be validated with an external Google account and the live Console audience.
