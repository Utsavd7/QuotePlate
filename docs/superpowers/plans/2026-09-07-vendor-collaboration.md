# Vendor collaboration implementation plan

**Goal:** Give ingredient suppliers private order visibility, a way to acknowledge and discuss deliveries, and restaurant-approved demand estimates without paid services.

**Architecture:** A separate expiring supplier portal grant is scoped to exactly one active supplier and tenant. It never extends quote submission permissions. Dedicated tenant-isolated collaboration and demand-share records preserve immutable award and restaurant receiving facts. Supplier feedback is tied to the exact receiving fingerprint; changed checks require renewed confirmation. Forecasts are explicitly selected snapshots of purchase shortages, labelled estimates, with stale/withdrawn/expired handling.

**Tech stack:** Existing Next.js, Prisma/PostgreSQL, React and local tests. Supplier collaboration uses no new external service. Nearby discovery uses free public Photon and VK Maps / Overpass endpoints; no API key, paid dependency, storage or messaging service is added.

## Approved scope and decisions
- User approved the three proposed additions with “do”; proceed with normal implementation choices without another approval gate.
- A restaurant owner creates/rotates/revokes a 30-day private portal link. Copy/share is manual. No messages sent automatically.
- Public portal lists only this supplier's invited non-draft requests; own award allocations only, never competitor quotes, totals, rationale, recipes or stock.
- Statuses: awaiting_quote (open, no own quote), pending (open, quoted), selected (award contains own allocations), closed (cancelled/awarded elsewhere/deadline passed without award). Acknowledgement applies only to selected order and never changes award.
- Supplier may agree/dispute current receiving facts with a note and textual evidence reference (invoice/delivery-note/credit-note number). No attachment upload or payment verification claims.
- Restaurant retains its receiving record; discrepancies are corrected through its existing delivery check. Supplier response remains visible and becomes outdated after receiving changes.
- Owner selects a saved plan, reviews individual shortage rows, chooses a supplier and shares. Snapshot contains only chosen ingredient names/specifications, purchase quantities, units and service date. Plan name, recipes, portions, stock and prices are excluded. New plan version marks old share outdated, converted plan marks it superseded; withdrawal removes it from public view. No implicit inventory confirmation.

## Work packages
- [x] Backend: add RLS tables and minimal digest resolver, bounded inputs, grant rotation/revocation, owner controls, read-only member views, scoped order projection, acknowledgement, fingerprinted feedback and reviewed demand shares. Add failing domain/API/integration tests then implement.
- [x] Public UI: `/supplier-portal` fragment-token exchange, private cookie, order status/cards, acknowledgement and delivery response forms, estimates and accessible responsive styles. Preserve quote page behavior.
- [x] Restaurant UI: `/supplier-collaboration`, supplier selection, create/copy/revoke link, feedback visibility, reviewed plan-row sharing and withdrawal. Link from navigation.
- [x] Documentation/public site: explain vendor benefit and limitations truthfully; retain existing product film without claiming new unrecorded scenes.
- [x] Verification: unit/API tests, real PostgreSQL RLS/grant/stale concurrency tests, lint/type/build and desktop/mobile browser flows including no competitor leakage, revoked access, delivery changes, selected demand sharing and withdrawal. Review diff, fix findings, leave completed work on branch for review.

## Shared API contract
Types are in `src/lib/supplier-portal/types.ts`. Routes:
- `GET /api/suppliers/:id/portal` => RestaurantPortalView.
- `POST /api/suppliers/:id/portal` => {url,expiresAt}; owner creates/replaces token. `DELETE` revokes.
- `POST /api/suppliers/:id/portal/demand` with {planId,expectedPlanVersion,itemKeys} shares/upserts reviewed snapshot. `DELETE` with {shareId} withdraws.
- `POST /api/public/supplier-portal/access` with {token} exchanges fragment into HttpOnly cookie scoped `/api/public/supplier-portal`.
- `GET /api/public/supplier-portal` => SupplierPortalView.
- `POST /api/public/supplier-portal` with PortalAction saves acknowledgement or feedback, then returns SupplierPortalView.
- All mutations same-origin JSON bounded; errors use existing problem {detail,errors}; private no-store responses and independent client/grant limits. Token resolver exposes IDs only and every transaction rechecks current grant under lock.

## Added user priority: free automatic nearby vendor search
- Implement user-triggered Photon area lookup + Overpass category-based nearby food business results inside supplier discovery. No API key, paid subscription, background scraping or automatic supplier approval.
- Prefill restaurant area; show matched location, radius, distance, available public contact/address details and OSM attribution. Map results remain unverified; require an explicit restaurant-verification checkbox before saving through the existing manually verified supplier workflow.
- Fixed provider hosts, safe queries, bounded requests/responses, shared provider quotas and caching. Existing website searches remain as wider coverage fallback. Open-map coverage and procurement suitability are not guaranteed.
- Verify using provider fixtures in automated tests and one minimal live lookup. No public Nominatim usage.

## Completed verification
- 1,039 unit tests across 133 suites; 47 real PostgreSQL integration tests across 23 suites passed. Lint, TypeScript and the production build passed.
- The 116-case browser suite initially had 95 passes, 15 intentional skips, four failures and two serially blocked cases. After correcting test selectors, isolating the test-only shared quote-submit bucket, and fixing same-tab replacement-link navigation, all four supplier collaboration journeys and nine affected restaurant-workspace journeys passed. This accounts for all 101 runnable cases across the full run and targeted reruns; the 15 skips include the opt-in live Google check and duplicate viewport cases.
- Nearby desktop/mobile browser tests verify no external search before interaction, result review, required human verification, actual persistence and reload. Landing and supplier portal layouts were visually inspected; affected flows passed serious-accessibility and overflow checks.
- A live Andheri East, Mumbai lookup returned 25 mapped records within 2 km. Two obvious unrelated/mistagged businesses were filtered, leaving 23 unverified leads. Public OSM fixture retained with source attribution. This is evidence of working discovery, not complete coverage or verified supply capability.
- No paid dependencies, automatic outreach, deployment, or production database migration performed. Work completed on `codex/vendor-collaboration` for review.
