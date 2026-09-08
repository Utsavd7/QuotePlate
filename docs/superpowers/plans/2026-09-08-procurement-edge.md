# Procurement edge implementation plan

**Goal:** Improve actionable supplier sourcing, repeat quote entry and purchase accountability using real saved records, without paid services.

**Architecture:** Extend existing tenant-scoped supplier collaboration and private quote workflows. Keep supplier declarations distinct from restaurant verification; keep historical prices distinct from current quotes. Derive reporting from saved award/receiving snapshots without recording invented payments or allocating order-level credits to unrelated ingredients.

**Tech stack:** Next.js 16, React 19, Prisma/PostgreSQL, existing bigint money calculations and isolated tests.

## Supplier trading information
- [ ] Add a bounded optional supplier trading profile with versioned updates, service PINs, minimum order, cutoff, lead time and wholesale status. Supplier declarations carry server timestamps; no automated certification or guaranteed availability claim.
- [ ] Allow the current private supplier portal to update its own profile with identity/version checks and show the profile to restaurant users. Keep unrelated supplier/tenant records private; unknown and stale information must be visible.
- [ ] Use an additive migration and preserve old records; verify validation, isolation and UI submission.

## Repeat quote entry
- [ ] Find only the same supplier's prior valid quote under the authenticated private request grant, matching item identity, unit and specification.
- [ ] Offer an explicit review-and-reuse action; never auto-submit, assume stock, or carry over delivery/availability. Display historical date and require normal current quote validation.
- [ ] Test cross-supplier privacy, changed specifications, absent history and existing revisions.

## Receiving accountability
- [ ] Derive per-item billed cost per accepted unit where both billed quantity and rate are recorded. Label tax/freight and order-level credit exclusions; do not claim cash paid or realised savings.
- [ ] Show open credits and partial delivery follow-up links with recorded dates, amounts and evidence limits, using the existing bounded reporting sample.
- [ ] Verify rounding, compatible units, missing invoice input, zero accepted quantities and correction deduplication.

## Integration and delivery
- [ ] Update product copy and README to match completed features, preserving the 2:29 video.
- [ ] Run type/lint, unit and relevant database/browser checks; review diff and address failures.
- [ ] Create a reviewable PR. Publish only after required release checks and migrations succeed.
