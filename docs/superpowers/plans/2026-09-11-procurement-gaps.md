# Procurement gaps implementation plan

> **For agentic workers:** Use subagent-driven-development and dispatching-parallel-agents for disjoint subsystems. Parent owns performance, integration, QA, media and release. Do not change `scripts/show-tables.sh`.

**Goal:** Complete the implementable gaps approved in the conversation audit and make remaining external validation explicit.

**Architecture:** Extend current forms and isolated server operations. Reuse browser OCR and safe website-fetch code. Public signup uses verified Google identities; private purchase data remains tenant-scoped. Manual WhatsApp/Email/Copy handoffs remain the communication model.

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma/PostgreSQL, Tesseract.js, Jest and Playwright.

## Parent: performance and integration
- [x] Record fresh production first/repeat data-ready timings; validate changed reads in the disposable local production build. See the QA report for the measured baseline and method.
- [x] Trace account, Settings and transaction queries; test redundant-work hypotheses before changing implementation.
- [x] Implement bounded improvements without weakening per-request authorization or tenant isolation; run meaningful focused tests.
- [x] Review each worker's contract, changes and tests, then run combined lint/typecheck/unit/integration/browser checks.

## Worker: public owner onboarding
Write scope: `src/lib/auth` signup/pilot/identity modules, `src/components/auth`, `src/app/start`, related auth tests, `.env.sample`, and narrowly required runtime policy checks. Do not touch current-user loading, Prisma or account operations owned by parent. Coordinate any shared-file need first.
- [x] Test new verified Google owner onboarding without allowlist, invalid/unverified identities, duplicate identity and existing invitation behavior.
- [x] Implement production self-service Google onboarding; retain email/password login and local fixture signup, rate limits and explicit workspace creation.
- [x] Make auth messaging describe the actual flow; report any landing/docs changes parent must make.

## Worker: reviewed photo/text intake
Write scope: new shopping-list/invoice parsing and UI helpers, `NewRequestForm`, receiving form integration, related parser/UI tests. Reuse existing OCR without changing shared OCR contracts or dependencies.
- [x] Test names, quantities, supported units, ambiguous/missing values, duplicate/mismatched invoice items and preservation of entered values.
- [x] Add shopping list source/review/apply flow inside New purchase.
- [x] Add invoice source/review/apply flow inside existing receiving checks; only explicitly confirmed billed fields may change.
- [x] Test cancellation, correction, empty/unreadable input and phone controls.

## Worker: supplier website contact discovery
Write scope: new `src/lib/suppliers/website-*`, new authenticated supplier contact lookup API, suppliers UI integration and tests. Reuse safe fetch primitives; do not alter shared security modules without coordination.
- [x] Test public HTTPS, redirect/DNS/private-address blocking, time/size/crawl limits, robots exclusion and no guessed contacts.
- [x] Add explicit website lookup, source/date and review-before-save UI to the existing supplier workflow.
- [x] Verify unavailable/no-contact states preserve manual entry and existing records.

## Worker: current competitor evidence
Write scope: `docs/research/india-restaurant-procurement-competitive-review.md` and new dated trial/cost research notes only; no application changes or README edits.
- [x] Open current primary pages for The Right Vendor, Hospiverse, Workwise Hospitality, RestoX, BirchStreet and emerging HorecaShip; include previously researched secondary benchmarks where useful.
- [x] Map the live QuotePlate baseline plus clearly labelled pending additions to evidence-backed overlap and defensible differentiation.
- [x] Write a short unaided-user pilot protocol and no-paid-integration operating assumptions with explicit provider limits.

## Parent: release closure
- [x] Walk the complete fictional restaurant-to-supplier purchase, sharing and recovery flows on laptop/phone; record exact coverage.
- [x] Update README/landing claims and current research/plan status.
- [x] Refresh final 4K 165-second film and supporting assets after UI verification; preserve all agreed player behavior.
- [ ] Review changes, open PR, finish CI, merge, verify deployed revision and assets, and report measurements plus genuine remaining external dependencies.
