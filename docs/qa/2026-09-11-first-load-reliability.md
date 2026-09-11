# First-load reliability — 11 September 2026

Base release: `54c1cd0` (PR #37). This follow-up addresses database round trips and recovery from stalled or failed reads. It does not establish the cause of the single earlier production history timeout or promise instant first loading.

## Evidence before this change

A normal demo navigation run on the base release measured first/repeat populated controls: Settings 2,824/49 ms, Suppliers 2,847/35 ms, History 5,832/85 ms. An earlier attempt measured Settings 5,351 ms and Suppliers 2,845 ms, then timed out waiting for a history control. A fresh direct history request subsequently returned real records with HTTP 200 in about 3.3 seconds. These observations show variability; the failed run did not preserve enough diagnostics to establish its cause.

The successful Settings response reported about 3 ms for session handling and 2,156 ms for its database operation. Existing hosting metadata places functions in Ohio; saved database configuration identifies Singapore. Neither a region migration nor paid hosting changes are included.

## Database changes and proof

- Enabled the installed Prisma 5.22 `relationJoins` preview feature. This changes the default relation-loading strategy across the generated client to database joins. No package upgrade or SQL schema migration is required. The global scope requires full integration and browser checks, not just a single-page check.
- Compared both strategies with the same local PostgreSQL fixtures and restricted application role. History returned identical data in 9 database calls instead of 13; Settings returned identical data in 5 instead of 7. Counts include transaction setup/teardown and exclude the already-completed runtime-role assertion. These are call counts, not production latency measurements.
- A permanent integration regression compares the old `query` strategy with joined reads, checks equivalent results, fewer calls, tenant mismatch rejection and immediate rejection after account deactivation.
- Reproduced a rejected runtime-role assertion remaining cached after a temporary connection failure. The new regression failed before the fix and passed after it. The current request still fails closed; a later request must successfully recheck the role. A confirmed unsafe role remains cached and rejected. Concurrent requests still share one assertion.

Prisma's [relation-query documentation](https://www.prisma.io/docs/orm/v6/prisma-client/queries/relation-queries) describes the default change and its preview status. The installed client and disposable-database comparison establish behavior for this repository.

## Stalled shared reads

Shared workspace reads now have separate 15-second response-header and body-read deadlines. A stalled read reports `Loading took too long. Please try again.` through existing page error/retry controls. This does not automatically repeat writes, increase cache lifetimes or buffer entire responses. A timed-out body evicts its matching cached response and cancels its original transport; old readers cannot abort a newer replacement or its pending refresh. Normal caller cancellation still affects only that reader.

Twelve new real-Response/stream tests cover stalled headers, stalled bodies, partial streaming, manual retries, independent readers, timer cleanup, unconsumed bodies and protection of fresh/pending replacements. Seven failed before the change; all twelve plus the existing prefetch suites passed afterward (74 checks).

## Validation and release

- Joined-read and role-recovery changes: 1,891 unit/API tests and 57 PostgreSQL integration tests passed; lint and TypeScript passed.
- Independent review found no introduced tenant, role, transaction, lock or public-grant bypass in the inspected paths.
- Final combined local checks: 1,903 unit/API tests across 158 suites, lint and TypeScript passed. All 57 database integration tests passed with joined reads enabled. PR browser checks and post-deployment timings are recorded with the release.

## User-dependent validation

The [Google verification runbook](2026-09-11-google-onboarding.md) records the real authorization redirect and the remaining consenting-user signup check. The [one-restaurant trial kit](../trials/restaurant-first-purchase-trial.md) and blank observation CSV are ready. No restaurant or supplier has participated in that trial yet; no invitations were sent and no real orders were placed by this task.
