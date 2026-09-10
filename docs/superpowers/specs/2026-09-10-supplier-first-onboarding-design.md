# Supplier-first onboarding

The user approved bringing existing restaurant suppliers into QuotePlate, collecting a one-time supplier confirmation, simplifying repeat quotes, and expanding with confirmed local contacts. Existing CSV imports, private supplier workspaces, trading declarations, previous-price reuse and nearby discovery are retained.

## Agreed communication approach

After reviewing official and unofficial automated WhatsApp options, the user approved manually sharing private quotation links through the restaurant's existing WhatsApp account on laptop or phone. QuotePlate collects the submitted quotes; no email account is required for suppliers. Do not add a Cloud API, central sender, unofficial WhatsApp gateway, paid messaging subscription or automatic outbound messages in this change. Opening WhatsApp must not be treated as delivery. The request page should explain that suppliers must submit through the link and that chat-only replies remain outside QuotePlate.

## Experience

- Private quote links, supplier workspaces and supplier application links expose the same labelled WhatsApp, Email and Copy link controls. WhatsApp uses its web/app handoff; Email opens the configured mail handler with a prepared draft. Copy link remains available when an app is not configured. Neither action claims that a message was sent.
- Restaurants can paste a small contact list into a reviewable table (business name, phone and email), correct it, and explicitly import it using the existing tenant-scoped atomic CSV endpoint. No contacts or messages are sent automatically. Existing manual entry and CSV tools stay available.
- The supplier page provides clear access to a supplier's private workspace. The public workspace brings business confirmation forward, with existing contact details prefilled. Suppliers confirm contact details, product categories and delivery terms. Existing saved profiles remain readable.
- Store supplier-confirmed contacts/categories as an optional `businessDetails` object in the existing bounded trading-profile JSON. They are declarations, not independently verified contacts, consent to marketing, or changes to the restaurant's address book. Existing quotes and other tenants' data remain private. The existing grant, revision, expiry and audit checks apply.
- Repeat quoting continues using existing matched previous prices, quantity review, photo/text assistance, delivery review and explicit Send. Verify this path while shipping the onboarding improvements.
- Nearby discovery retains real public sources and explicit restaurant review. Include public email when valid and available; preserve source links. Do not infer contacts or promise complete coverage.

## Contract

`SupplierBusinessDetails` contains `contactName`, `phone`, `whatsappNumber`, `email` (nullable strings) and `categories` (known procurement category keys). A declaration requires at least one valid contact and one category. `TradingProfileInput.businessDetails` is optional for backwards compatibility. Public portal views provide optional `businessDetails` containing only that supplier's address-book contact fields/categories for initial prefilling. The saved profile wins on subsequent visits. Supplier self-confirmation never changes restaurant verification flags.

## Validation

Cover malformed and duplicate pasted rows, no automatic save, atomic import failures, contact normalization and category validation, old JSON compatibility, cross-tenant/grant/revision protection, privacy of the public projection, responsive phone/laptop UI, keyboard access, repeat-quote preservation and source-email parsing. Run typecheck, lint, relevant unit/integration/browser tests and release checks. Review and deploy under the user's existing PR/merge authorization.
