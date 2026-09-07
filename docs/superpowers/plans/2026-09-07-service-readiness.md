# Restaurant service readiness implementation plan

**Goal:** Deliver the four user-approved improvements without adding paid services: item receiving and credits, saved portion/stock planning, explainable shortage-to-purchase recommendations, and evidence-based supplier performance.

**Architecture:** Keep the existing tenant-isolated Next.js/PostgreSQL workspace and exact decimal arithmetic. Receiving extends stored award JSON compatibly; service plans use a versioned tenant-owned record. All recommendations are deterministic and reviewable; orders remain drafts until the restaurant follows the existing approval flow.

**Tech stack:** Existing Next.js 16, React 19, Prisma/PostgreSQL, TypeScript, Jest and Playwright. No additional dependencies or metered APIs.

## Receiving and recovery
- [x] Test split allocations, cumulative partial receipts, rejected quantities, money rounding, legacy JSON, excessive credits, authorization and stale edits.
- [x] Implement bounded item-level receipt details and claimed/received/outstanding credits while preserving accepted award records.
- [x] Deliver mobile-usable controls and summaries, including explicit recording of actual arrival and incomplete deliveries.

## Daily service plans
- [x] Test recipe batch scaling, yield, shared ingredients, standard-unit conversions, missing recipes, confirmed incoming timing, and shortage calculation.
- [x] Persist tenant-scoped plans with explicit portion targets, batch servings, usable stock, incoming supply and version checks.
- [x] Expose authenticated, bounded APIs and a complete planning page.
- [x] Create reviewable procurement drafts from server-computed shortages, requiring valid sourcing and delivery details.

## Supplier evidence
- [x] Test no-data states, measured delivery sample sizes, quantity/rejection rates, incomparable units, credits and deterministic ranking.
- [x] Build tenant-isolated outcome reporting from accepted awards and saved receipts; do not equate prior awards with reliable delivery.
- [x] Show supplier evidence in a dedicated workspace and use sufficient delivery evidence to break otherwise equal supplier suggestions.

## Integration and verification
- [x] Link service planning and supplier performance from navigation and relevant existing pages.
- [x] Run scoped tests during implementation, then typecheck, lint, full unit suite, integration tests and production build.
- [x] Exercise core flows in the browser and run meaningful end-to-end tests where the local database/runtime is available.
- [x] Update README with feature boundaries, migration/deployment requirements and no-added-service-cost scope.

## Acceptance boundaries
Unknown stock, absent recipes and incompatible units must not produce false readiness. Confirmed incoming supply is explicitly entered evidence, not invented live supplier availability. Credits owed and credits received are separate facts. Suppliers with insufficient observations are labelled as such. No automated substitutions, paid integrations, synthetic savings claims, or production deployment is included.

## Website update
- [x] Explain service planning, actual receiving, credit tracking and supplier evidence on the landing page.
- [x] Extend the manual buying journey through delivery; update site metadata, privacy/terms product descriptions, workspace links and README.
- [x] Verify public journey accessibility and responsive layout in the browser.

## Verification record
- 988 unit tests across 125 suites passed.
- All 43 existing PostgreSQL integration tests passed after schema/backup/readiness updates.
- New receiving/reporting and planning persistence tests passed against real PostgreSQL, including cross-tenant access, stale edits and duplicate draft conversion.
- Typecheck, lint and production build passed. The final fresh-build browser run passed all 12 new-workflow and journey tests on desktop and phone, including accessibility. Public-site responsive checks passed 24 applicable cases (8 project-specific skips), with stale content counts and subpixel scroll tolerance corrected. Total verified: 988 unit tests, 45 PostgreSQL integration tests and 36 applicable browser tests.
