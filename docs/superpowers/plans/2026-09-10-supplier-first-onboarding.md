# Supplier-first onboarding implementation plan

> **For agentic workers:** Use subagent-driven-development for bounded backend and public-UI changes, with parent-owned import and discovery changes. Do not edit scripts/show-tables.sh.

**Goal:** Make real supplier onboarding and recurring participation easier without a paid service.

**Architecture:** Extend the existing trading-profile JSON and secure supplier portal; import reviewed contacts through the existing CSV transaction. Preserve existing tenant isolation, previous-price reuse and real public discovery.

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma/PostgreSQL, Jest and Playwright.

### 1. Backend confirmation contract
- [x] Add optional `businessDetails` to trading profiles and public portal initial data using the exact contract in the design.
- [x] Validate contacts with existing supplier rules and known categories, require a contact/category for new declarations, preserve old profiles, bound JSON, retain revision/grant protection. Test invalid contacts/categories, compatibility and private projection.

### 2. Supplier confirmation UI
- [x] Extend `src/components/supplier-portal/TradingProfile.tsx` and the public portal placement. Prefill existing contacts, edit categories and delivery details, explicitly save/reconfirm, display declaration date. Keep existing orders and quote paths available.
- [x] Verify on phone/laptop including keyboard and no overflow; update trading-profile browser coverage.

### 3. Restaurant contact entry
- [x] Add bounded contact-list parser/CSV builder with tests for tabs, simple comma lines, missing name/contact, invalid contacts, duplicate rows and quoted CSV output.
- [x] Add a reviewable quick-add component beside existing supplier actions. Use existing atomic `/api/suppliers/import`; keep input on error and avoid overwriting existing records. Connect supplier rows to the current private workspace.

### 4. Discovery and release
- [x] Extract valid public OSM email into result/pre-fill, retain phone/website/source and explicit review. Add parser tests.
- [x] Update README with actual onboarding behavior and limits. Run typecheck/lint/unit/integration plus targeted browser coverage including previous-price reuse.
- [ ] Review changes, create PR, complete release checks, merge and verify production.

### 5. Approved sharing and UI follow-up
- [x] Share quotation, application and workspace links through WhatsApp, Email and Copy link with labelled icons; leave Send to the user.
- [x] Align restaurant headers, content rails, sidebar/footer, forms and controls; share public supplier page structure and common font/icon tokens.
- [x] Validate populated pages at 1440px, 1180px and phone widths; verify onboarding, quoting, settings, applications and guided setup.
- [x] Refresh the 165-second native 4K film from the finalized interface, keep optional captions and publish the matching asset bundle.

Validation before release: 1,692 unit tests; 8 isolated integration tests; 21 main/supplier browser checks, plus 23 history/settings/discovery/tutorial checks (one existing desktop-only test skipped on mobile). Final media and hosted checks are recorded with the release.
