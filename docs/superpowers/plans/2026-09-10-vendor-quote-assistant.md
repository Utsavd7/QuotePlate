# Vendor Quote Assistant Implementation Plan

**Goal:** Let a vendor prepare and confirm a quotation on the hosted phone website with minimal typing.

**Architecture:** A lazy browser photo/text assistant proposes prices to the existing quote form. The form remains the owner of all business values and sends only through existing access-scoped APIs. The assistant cannot submit or change tax, quantity or delivery fields.

**Tech Stack:** Next.js client components, TypeScript, existing Tesseract.js assets, exact decimal helpers, Jest and Playwright.

- [x] Build `src/lib/quotes/price-list.ts` with bounded line extraction, conservative item matches and explicit unresolved rows; add parser tests.
- [x] Build `src/lib/quotes/price-list-ocr.ts` using raw Tesseract lines, preserving prices that the menu-specific cleaner removes; test cancellation and limits.
- [x] Build `src/app/quote/QuotePriceAssistant.tsx` and its CSS. Contract: `items: {id,name,unit}[]`, `disabled: boolean`, `onApply: (prices: {requestItemId,rateInr}[]) => {applied:number,skipped:number}`. Explicit review calls this callback; no network writes originate here. English first, as selected by the user.
- [x] Extend `SupplierQuoteForm.tsx` with optional guided entry and the assistant. Guard its callback against disabled rows and all existing values. Keep current review and revision semantics.
- [x] Exercise the assistant with printed photo and text fixtures, mobile/laptop layouts, changing modes, late cancellation and preserved user edits. Keep existing quote workflow tests meaningful.
- Release gate: review the change, run lint/type/unit/browser/build checks, open and merge the PR only on green release checks, then verify deployment.

Parser and OCR work can run independently of form integration; separate file ownership prevents conflicting edits. UI integration and final browser verification remain coordinated in this task.

## Local verification

1,354 unit/API checks and 26 laptop/phone browser checks passed. Browser checks used real bundled OCR assets, including successful printed-photo extraction, repeated language-download failures, cancellation and subsequent text entry. Independent review findings for long pastes, startup cleanup and premature delivery validation were addressed.

The photo reader owns the native worker from creation and uses the pinned Tesseract.js 7 protocol. Keep the real OCR and failure/retry browser checks when upgrading that dependency. Photos remain on the device; this release does not configure a WhatsApp bot.
