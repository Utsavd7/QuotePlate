# Workspace UI verification — 8 September 2026

## Scope

The app now uses the shared gray, white and green workspace tokens across the shell, purchasing, menus, service planning, suppliers, reporting, settings, authentication, supplier-facing forms, loading and recovery. Logo copper and meaningful warning/error colors remain. The share image has a reproducible local SVG source and renderer.

## Browser coverage

`tests/e2e/workspace-polish.spec.ts` checks these 14 route patterns at 1440×900, 1366×768 and mobile Chromium: `/dashboard`, `/procurement`, `/procurement/new`, `/procurement/[id]`, `/menus`, `/menus/[id]`, `/suppliers`, `/supplier-collaboration`, `/supplier-performance`, `/service-planning`, `/history`, `/settings`, `/insights`, and `/intelligence` (redirect).

Each route checks actual content and body colors, Manrope text, visible keyboard focus, document overflow and serious/critical axe violations. Screenshots and a visible-control inventory are attached to the test report. The inventory records controls; it does not imply each one was activated.

Additional cases exercise:

- Settings invitation validation, role choices, focus wrapping, Cancel, close, Escape and scrim dismissal.
- Deactivation/revocation confirmation dismissal and focus return. Only the two extra display rows are mocked; no invitations or access changes are sent.
- All purchase filters and repeat-order dialog dismissal.
- Saved-plan choices and supplier delivery/calculation disclosures.
- All six tutorial highlights, movement and resize tracking, target clicks, keyboard collapse, skip/completion/reopen, unrelated dialogs and the short-screen mobile fallback (`tutorial-tour.spec.ts`). Tutorial progress is mocked in these positioning tests; the existing API tests cover saved progress.
- Desktop/mobile subtitle toggling and native-control synchronization, scroll playback, unmute, failure and reduced motion (`product-demo-video.spec.ts`).

Normal local authentication is reused in memory per worker. Fixture-only tests assert a local origin. The new workspace audit blocks browser API writes and fails on attempted writes. Guide positioning tests intercept tutorial updates. No production data or external supplier communications are used.

## Results and limits

The rebuilt page matrix passed all 42 route/viewport combinations. Initial failures were test setup issues: minified color spelling and repeated logins consuming the email throttle. A later filter click was covered by an active guide; control tests now explicitly collapse it after navigation. The product guide remains dismissible while in use. The final corrected control and tutorial checks are recorded by CI.

Existing suites retain the real local menu-to-request-to-supplier-quote-to-award workflow, delivery checks, restaurant saves, invitation acceptance, permission restrictions, exports and supplier portals. These do not cover every possible combination of records, permission roles, upload content, offline state or external provider response. No claim of universal button coverage or instant live loading follows from the audit. Automated axe checks complement visual inspection; they are not a full screen-reader audit.

See `performance-polish.md` for measured timings and production limitations. Screenshots and traces are produced by Playwright in its configured output directory; they are not published as marketing assets.
