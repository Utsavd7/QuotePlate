# Workspace performance polish — 8 September 2026

## Environment and method

Measured against the parent's existing local production-mode harness at
`http://127.0.0.1:52560`, with fixture service on port `52562`. The parent seeded
the isolated internal-demo tenant. Checks signed in through the normal email and
password UI using the repository's local test fixture credentials; no credentials
or session state are included in this report. No fixture reseeding, server restart,
production-data access, or external messages were performed by these checks.

Before: parent's main build. After: parent's rebuilt workspace-polish build.
Measurements used separate headless Chromium contexts at 1440×900. The setup guide
was collapsed through its normal UI where visible. Navigation timings include the
browser click/navigation and waiting for the indicated visible element. Settings
API timings include reading the response body. These are local samples on a shared,
already-running server, not cold production/serverless measurements.

## Measured results

| Scenario | Before | After |
| --- | ---: | ---: |
| Open purchase: heading visible, normal network | 122 ms | 67 ms |
| Open purchase: heading visible, comparison artificially delayed 900 ms | 1,334 ms | 84 ms |
| New purchase: Save draft button visible | 76 ms | 117 ms |
| Purchases sidebar: heading visible | 34 ms | 31 ms |
| Suppliers sidebar: heading visible | 42 ms | 42 ms |
| Menu sidebar: heading visible | 37 ms | 37 ms |
| Reports sidebar: heading visible | 28 ms | 83 ms |
| Today sidebar: heading visible | 56 ms | 119 ms |
| Settings: form ready, three navigations | 96 / 53 / 94 ms | 45 / 97 / 43 ms |
| Settings: direct authenticated API reads, three calls | 7 / 6 / 6 ms | 7 / 6 / 5 ms |

The controlled comparison delay demonstrates the targeted improvement: purchase
facts no longer wait for supplier prices. It does **not** show that comparison
processing became faster. Normal-network and sidebar values are single samples;
several increased after the rebuild. They do not establish an app-wide speedup.
Sidebar heading visibility is not full-data readiness. The scripts' `settledMs`
fields must not be used as SPA network-idle measurements; late requests can cross
navigation boundaries.

All measured Settings API responses were 200 with `Cache-Control: private,
no-store`. The reported live Today-to-Settings wait exceeding 20 seconds was not
reproduced locally and remains unexplained. Live route/RSC, account and Settings
request timings are needed to locate that delay. New purchase still issues its own
account read after the shell's account read; no account caching was introduced.

## Change and correctness protections

Purchase details now publish authenticated request facts before awaiting the
status-dependent comparison. Prices have an explicit loading state instead of
showing a false empty result during that wait. Draft and cancelled requests do not
request comparisons. An app-route loading boundary provides navigation feedback;
it does not bypass the shell's account gate or accelerate backend work.

Prior comparisons are cleared **before** publishing newly loaded facts. Purchase
content is keyed by request ID so route changes reset its local state. Superseded
loads and unmounts abort requests; abort checks after body parsing reject late
results even when a fetch implementation ignores cancellation. Comparison epochs
protect against older refreshes overwriting an award, and initial comparison loading
pauses automatic quote polling. No private-response cache, cross-tenant cache,
authorization relaxation, RLS change, or mutation change was added.

Validation: 18 focused tests passed, covering staged timing, status-dependent
requests, authorization failures, clearing stale comparisons, late aborted response
bodies, route keys, and the award/refresh race. A server-confirmed award is retained
separately for the same request ID across failed refreshes, keeping the decision
record and purchase-order downloads available without restoring old quotes. Both
request-reload and comparison-reload failures after a successful award are covered. Scoped ESLint and full
TypeScript checking passed. A separate follow-up browser check intended to verify
loading-state-to-prices completion stopped at a sign-in navigation timeout; it is
not counted as passing. The successful before/after runs above are separate from
that incomplete check. Parent owns broader browser/button coverage.

## Evidence

Local evidence directory: `/tmp/quoteplate-speed-review/`.

- `baseline.json` and `settings-baseline.json`: original before measurements.
- `after.json` and `settings-after.json`: separate rebuilt-harness measurements.
- `baseline-hashes.json`: original hashes; both before files were verified unchanged.
- `baseline.cjs`, `after.cjs`, `settings.cjs`, `settings-after.cjs`: measurement scripts.

Temporary evidence is not committed or a permanent artifact archive. This report
preserves the measured results for release review. No claim of instant live loading
or complete app-wide button verification follows from these measurements.

## Live follow-up

A normal internal-demo sign-in and read-only Today → Settings navigation on the
existing live deployment measured 6,344 ms to the settings form. The settings API
itself took 6,212 ms; a second navigation used the existing workspace memory cache
and rendered in 43 ms. This locates that sample's delay in the first server request,
not CSS or rendering. It does not identify whether cold startup, connection setup,
or database work caused the server delay. Production readiness returned `ready`.

Settings and secondary navigation now start the same existing, workspace-scoped
prefetch on pointer entry or keyboard focus as the five main navigation links.
This gives requested data a head start; it adds no new cache policy or automatic
background fetch of every page. It cannot guarantee instant first server responses.
