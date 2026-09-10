# Hosted vendor quote assistant

The vendor opens the existing private quote link on a phone, prepares prices from an existing quote or a clear printed price list, reviews the result and sends it. This implements the user's approved prepare–review–send flow for vendors with limited technical experience. It runs on the public hosted product and never depends on the owner's laptop or a paid model service.

## Experience

Preserve the existing full price table, taxes, partial supply, unavailable items, delivery, terms, revisions and final review. Add an optional guided item-by-item view with large next/back controls. Keep the table available. The user selected English first. Use short English labels; item names and restaurant-supplied content remain verbatim.

A collapsed price-list assistant offers camera, photo selection and pasted text. Read one bounded JPEG/PNG/WebP image using the already bundled browser OCR engine. Keep the source photo on the device. Show extracted item/rate suggestions for explicit review before filling only blank, enabled price fields. Never replace an entered price, infer availability, change tax settings, submit a quote or save a photo. Ambiguous rows remain unresolved and the source text stays editable. Explain that clear printed English works best; do not promise handwriting recognition.

## Boundaries

Use deterministic extraction and existing decimal helpers. Match item names conservatively and require the supplied price unit to match the request unit; no implicit unit conversions. Duplicate, multi-price, malformed and unknown rows must not silently become accepted prices. Page text is data, never instructions. Limit file bytes/pixels and text rows/length. Cancel OCR on close and unmount; ignore late results. Add no external model endpoints, database migrations or privileged worker credentials.

## Hosted operation

All assets and code are served from QuotePlate. Browser OCR is lazy-loaded after a vendor chooses a photo. Private requests and final quote submission continue through the existing scoped, validated server routes. A hosted browser feature has no new API subscription; existing hosting usage and device resources still apply. OCR errors and unavailable camera support retain text/manual entry.

## Validation

Test ambiguous amounts, unit mismatch, duplicate matches, zero and decimal prices, limits and cancellation. Browser checks cover real OCR of a generated printed fixture, text import, explicit fill, preserving edits, no submission before review, unavailable rows, revisions and mobile geometry. Run existing supplier quote and tenant-isolation suites, production build and full release checks. Publish through a reviewed PR and verify public assets and the private quote flow without modifying real restaurant records.
