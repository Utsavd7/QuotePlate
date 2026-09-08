# Procurement edge implementation plan

**Goal:** Improve actionable supplier sourcing, repeat quote entry and purchase accountability using real saved records, without paid services.

**Architecture:** Extend existing tenant-scoped supplier collaboration and private quote workflows. Keep supplier declarations distinct from restaurant verification; keep historical prices distinct from current quotes. Derive reporting from saved award/receiving snapshots without recording invented payments or allocating order-level credits to unrelated ingredients.

**Tech stack:** Next.js 16, React 19, Prisma/PostgreSQL, existing bigint money calculations and isolated tests.

## Supplier trading information
- [x] Add a bounded optional supplier trading profile with versioned updates, service PINs, minimum order, cutoff, lead time and wholesale status. Supplier declarations carry server timestamps; no automated certification or guaranteed availability claim.
- [x] Allow the current private supplier portal to update its own profile with identity/version checks and show the profile to restaurant users. Keep unrelated supplier/tenant records private; unknown and stale information must be visible.
- [x] Use an additive migration and preserve old records; verify validation, isolation and UI submission.

## Repeat quote entry
- [x] Find only the same supplier's prior valid quote under the authenticated private request grant, matching item identity, unit and specification.
- [x] Offer an explicit review-and-reuse action; never auto-submit, assume stock, or carry over delivery/availability. Display historical date and require normal current quote validation.
- [x] Test cross-supplier privacy, changed specifications, absent history and existing revisions.

## Receiving accountability
- [x] Derive per-item billed cost per accepted unit where both billed quantity and rate are recorded. Label tax/freight and order-level credit exclusions; do not claim cash paid or realised savings.
- [x] Show open credits and partial delivery follow-up links with recorded dates, amounts and evidence limits, using the existing bounded reporting sample.
- [x] Verify rounding, compatible units, missing invoice input, zero accepted quantities and correction deduplication.

## Integration and delivery
- [x] Update product copy and README to match completed features, preserving the 2:29 video.
- [ ] Run type/lint, unit and relevant database/browser checks; review diff and address failures.
- [x] Create a reviewable PR.
- [ ] Publish only after required release checks and migrations succeed.

## User-requested internal demo login
- [ ] Run production setup to seed a separate real tenant and owner account using an operator-only workflow and password secret; no public preview or shared credentials in source.
- [x] Populate actual menus, suppliers, quotes, orders, delivery checks, credits and service plans with coherent fictional records.
- [x] Identify the fixed demo workspace with a persistent sample-data banner inside the actual app. Normal tenant authorization applies; no demo bypass.
- [x] Validate seeded records through actual workflows and verify no changes to other tenants. Repeat seeding preserves demo edits and fails on identity mismatch.
