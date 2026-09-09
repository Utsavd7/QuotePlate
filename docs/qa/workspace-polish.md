# Workspace UI verification — 9 September 2026

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

The rebuilt page matrix passed all 42 route/viewport combinations. Initial failures were test setup issues: minified color spelling and repeated logins consuming the email throttle. A later filter click was covered by an active guide; control tests now explicitly collapse it after navigation. The product guide remains dismissible while in use.

The first full CI run exposed a real regression: the collapsed setup launcher covered sticky menu approval actions. The launcher now occupies normal page flow in the workspace toolbar, beside section navigation on wider screens and wrapping on phones. The mobile guide action is labelled “Show navigation” so the actual “Open navigation” button remains unambiguous. A fractional pixel tolerance (43.99 px for a 44 px target) handles browser rounding without changing the control size. The final corrected workflows and tutorial checks are recorded by CI.

Existing suites retain the real local menu-to-request-to-supplier-quote-to-award workflow, delivery checks, restaurant saves, invitation acceptance, permission restrictions, exports and supplier portals. These do not cover every possible combination of records, permission roles, upload content, offline state or external provider response. No claim of universal button coverage or instant live loading follows from the audit. Automated axe checks complement visual inspection; they are not a full screen-reader audit.

See `performance-polish.md` for measured timings and production limitations. Screenshots and traces are produced by Playwright in its configured output directory; they are not published as marketing assets.

## Follow-up: pinned navigation, immediate setup, consistent type

The workspace sidebar is fixed to the viewport. Section navigation stays at the
top of the content area, below the mobile header when present. Its measured height
is used for focused-control scroll offsets. Short-screen sidebar overflow remains
keyboard-accessible. Main pages use flex sizing instead of a percentage minimum
height that included their toolbar siblings; their content ends before the footer.
A new regression checks these bounds on five routes at both laptop sizes and mobile.

Setup steps project immediately while a serialized queue saves progress using the
server's version checks. Delayed, lost and conflicting responses do not replay an
uncertain action against a newer version. Failed saves stay visibly unsaved, with
retry or explicit reconciliation. Pointer interactions use 160ms content/progress
transitions; keyboard and reduced-motion navigation remain instant. The target
ring follows its actual control immediately. Tests cover rapid input, slow saves,
failure recovery, delayed commits, reconciliation and focus.

Manrope now supplies all interface text; the canonical Newsreader wordmark uses a
separate brand token. Shared sizes cover headings, body text, controls and labels
across public, restaurant and supplier pages. Landing and sharing assets follow
the same typography. The film is 1920×1200, matching the complete 16:10 app captures
without a decorative frame, title strip or margins. Its 164-second timeline,
approved AAC audio packets, captions and transcript are unchanged.
