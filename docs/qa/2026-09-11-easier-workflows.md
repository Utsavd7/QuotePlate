# Easier procurement workflows — 11 September 2026

Base: de29816 (PR #38). This report records technical validation; it is not a real restaurant trial or a measured competitive advantage.

## Behavior under validation

- Account bootstrap is uncached and bounded across headers and JSON reading to 15 seconds. Discarding the layout cancels the request; old responses cannot redirect or update a replacement layout. The signal bridge does not require AbortSignal.any. Non-success response bodies are cancelled and status still drives sign-in/retry behavior.
- Settings shows its page heading while private data loads. After the same current active-user/tenant authorization, one query obtains active members and live invitations instead of two. Member ordering remains in PostgreSQL; invitations remain newest-first with a stable identifier tie break. No credential fields are selected.
- Supplier quoting counts incomplete requested item rows and can focus the first unfinished field in either all-item or guided mode. It reuses existing quantity, price and GST validation, including zero rates and unavailable items. Final delivery/total review and explicit submission remain required.
- Saved-contact warnings compare normalized phone/email against only loaded supplier records, including filters/pagination limitations. Shared contacts remain advisory; existing server save constraints are unchanged. Website dedup retains the first original spelling, citation and check time. No new provider, source scraping surface or automatic verification was added.
- Shopping/invoice and supplier price-list intake show the selected on-device photo throughout text/row review. Preview URLs are cleaned up. The native menu OCR worker is owned before initialization, terminated on cancellation/failure and bounded to 120 seconds for startup and each photo. The Tesseract 7 worker protocol and local assets are pinned and need rechecking when upgrading.

## Reproductions and checks

The new single-list regression initially observed two list calls. The heading regression initially rendered only a skeleton. The old menu reader failed cancellation-during-initialization cleanup; the new source-preview assertion also failed before implementation. These failures were reproduced before their corresponding fixes.

- Parent focused tests cover account header/body deadlines, manual retry, caller cancellation, lack of AbortSignal.any, invalid JSON and authorization status handling.
- Actual PostgreSQL Settings/reporting checks passed: two business User reads (actor + combined people list), expected current-tenant results, expired/revoked/accepted invitation exclusion, active-account rejection and isolation. Existing joined-query equivalence checks also pass.
- Supplier progress tests cover both entry modes, focused fields, manual edits, zero/partial quantities and unavailable rows, previous/prepared price application and unchanged final payload.
- Source contact tests cover local/international formatting duplicates within/across pages, original citation retention, shared contact warnings and explicit use without extra network/save requests.
- Photo tests include worker initialization/read cancellation, stale messages, timeouts, local preview cleanup and a real bundled-Tesseract loopback run with only local GET requests.
- Full unit/API suite: 1,943 tests across 161 suites passed. Browser component suite: 25 passed, including actual engine initialization/recognition. Two pre-existing planning tests were updated to open the existing disclosure before using its controls; all component suites are now included in CI.

The integrated laptop/mobile subset initially passed 30 of 32 checks. Two mobile timing failures (unavailable-item selection and a stalled account reload) both passed an isolated rerun in 23.3 seconds without application changes; the initial failures are retained as limitations, and the full CI browser suite remains the release gate. All 57 database tests across 27 suites passed. Final media and exact release verification are recorded with the PR after completion. The original public film remains active until its replacement is reviewed.

## Limits

First loading is not promised instant. Production timing must be observed after deployment. Recognition remains intended for printed English; source previews do not establish OCR accuracy on restaurant handwriting or regional languages. The selected preview may represent only the latest photo when text has earlier appended content. No messages, real orders, Google consent or actual restaurant trial were performed. No new paid service was added.
