# QuotePlate

QuotePlate is a procurement workspace for restaurants in India. It turns menus into ingredient requests, collects private supplier quotes, compares landed cost, records the restaurant's choice, checks each delivery and entered invoice total, and starts the next buying cycle from saved history.

Live product: [quoteplate.netlify.app](https://quoteplate.netlify.app)

Built by [Utsav Doshi](https://github.com/Utsavd7).

## Product demo

[![Watch the QuotePlate product demo — 3 minutes 45 seconds](public/media/quoteplate-product-film.jpg)](https://quoteplate.netlify.app/#watch-demo)

[Watch the video on the website](https://quoteplate.netlify.app/#watch-demo) · 3:45 · 2560 × 1440 QHD

Follow a fictional restaurant in Pune from a menu photo through supplier discovery, private quotes, cost comparison and a purchase decision. Updated application footage demonstrates item-level receiving, partial deliveries, credits claimed and received, supplier performance, portion and yield planning, and a shortage-only purchase draft. Routine actions are condensed; the narration explains the inputs and review steps.

[Transcript](public/media/quoteplate-product-film.txt) · [English captions](public/media/quoteplate-product-film.vtt) · [Media credits](public/media/credits.txt)

## Product

The current release supports:

- create a menu by typing dish names, uploading up to ten photos from the current device, scanning a QR code to send up to ten original phone photos at a time, or importing a menu page you have permission to use;
- scan menu photos in the browser, review the detected text, remove unwanted dishes together, delete unused menus, and approve the final dishes and ingredients;
- organise ingredients using categories familiar to Indian restaurants;
- find potential suppliers by ingredient and area using external Google Maps, Google, Justdial, IndiaMART, TradeIndia, ExportersIndia, Kompass and go4WorldBusiness searches, then review and add them manually without a search API or billing account;
- keep existing suppliers, choose more than one sourcing route, or accept applications from new suppliers and then approve or reject them;
- send each supplier a private quote link with no supplier account required;
- collect quantities, rates, GST, freight, availability, delivery, substitutions, and payment terms;
- compare complete and incomplete quotes while keeping the final decision with the restaurant;
- award the full request to one supplier or split items across suppliers;
- check each winning supplier delivery, record problems, and automatically flag any difference between the entered invoice total and the accepted total;
- record received, rejected and billed quantities against each supplier's awarded allocation, keep partial deliveries open, and track credits claimed, received and still owed;
- save daily portion plans from approved recipe snapshots, enter batch servings, usable stock, expected yield and confirmed incoming supplies, then calculate shared ingredient shortages;
- turn calculated shortages into an editable procurement draft, and repeat a daily plan while clearing stock and arrival assumptions;
- compare suppliers using recorded fulfilment, rejection, completed delivery dates and credit balances; use established on-time evidence to break equally capable supplier suggestions;
- see counts of deliveries waiting for a check and unresolved problems on the restaurant home page;
- download request, comparison, award, accounting, QR, supplier, and purchase order records;
- keep delivery check totals and problem counts in history, repeat a completed awarded request into a new draft, and use prior buying facts as guidance;
- manage restaurant details, roles, invitations, Google sign in, sign out, and an optional six step setup guide;
- use the public site and product workspace on phones, tablets, and laptops.

The landing page includes a three-minute-forty-five-second product film with captions and a transcript. It uses condensed recordings of the actual app with fictional restaurant data in an isolated environment. Media is served from `public/media` and the video loads only when played; no external video service is required. The buying journey uses compact, manually selected stages on desktop and phones, with one step counter and no automatic movement. Old `/product` bookmarks redirect to this journey on the homepage.

The product does not introduce suppliers and then disappear from the workflow. Its value is the reusable request, quote, decision, purchase order, and price history for every buying cycle.

### Daily planning and delivery evidence

Open **Plan today’s service** to select an approved menu and enter the number of servings produced by each recipe batch. Recipe quantities represent usable ingredient requirements. Stock and confirmed arrivals must also be usable quantities. The planner subtracts available stock before dividing the remaining shortage by yield: 10 kg needed, 4 kg usable stock and 80% yield means purchasing 7.5 kg. Shared stock is allocated once, in dish order. Missing recipes, unknown stock, incompatible specifications and unsupported pack conversions block procurement rather than imply readiness. The restaurant records arrival confirmations; there is no live inventory or supplier availability integration.

Saved plans preserve their approved recipe version. Optimistic version checks prevent stale edits, and procurement conversion creates one reviewable draft without contacting suppliers. After conversion, repeat the plan to make a new daily record with fresh stock inputs.

Delivery details use cumulative received and rejected quantities, including replacements. Credit balances are restaurant-entered records, not verified bank transactions. **Supplier performance** reads the latest 100 awards; suggestion ranking uses its bounded recent award sample and requires at least three dated, completed deliveries before on-time evidence affects otherwise equal capability matches. Missing checks do not count as successful deliveries.

These features add no dependencies, subscriptions or metered AI services. Existing hosting, database and storage usage still applies. Their practical advantage is connecting portion requirements, purchasing, actual receipts and money recovery in one workflow; competitive uniqueness and business results require validation with restaurants.

## Safety and privacy

- Your recipes, menus, supplier prices, and purchase records stay private to your restaurant. Other restaurants cannot see them.
- Each supplier link has a unique secret key. The key itself is not stored, works for only one request, expires, and can be replaced or revoked.
- Award records preserve the accepted prices, quantities, supplier facts, and delivery terms used for the decision.
- Owner only actions protect restaurant settings, team access, supplier verification, and awards.
- The production service refuses to start when required security settings are missing.
- Rate limits cover account creation, invitations, supplier access, supplier submissions, and applications.
- Browser security rules stop other sites from placing QuotePlate inside a hidden frame, reduce information shared through links, and limit unnecessary device access.
- Phone photos travel as temporary encrypted copies. The decryption key stays in the QR link, and retrieved originals are kept only in that restaurant workspace on the current browser.
- Backup and restore tools are included for the operator.

## Run locally

Requirements: Node.js 24 and PostgreSQL 16.

```bash
npm install
cp .env.sample .env
npx prisma migrate deploy
npm run dev
```

Replace the placeholders in `.env` with your own values and never commit that file. The application accepts up to twenty approved pilot owner emails.

For optional combined supplier results, create a free ad-supported [Google Programmable Search Engine](https://programmablesearchengine.google.com/controlpanel/all) using **Sites to search**: `justdial.com`, `indiamart.com`, `tradeindia.com`, `exportersindia.com`, `in.kompass.com`, and `go4worldbusiness.com`. Set its public `cx` ID as `NEXT_PUBLIC_SUPPLIER_SEARCH_ENGINE_ID` before building, then rebuild when it changes. Use the Search Element, not the paid JSON API or an ad-free plan; no API key or billing account is needed. Google supports [up to 50 configured domains](https://programmablesearchengine.googleblog.com/2026/01/updates-to-our-web-search-products.html) on this free option. Results load only after the user submits a search, in an isolated frame without access to restaurant data or QuotePlate browser storage. Search terms go to Google, ads may appear, and Google controls index coverage. Google Maps and individual website searches remain available externally; without a configured engine, only those external searches are shown.

## Production setup

1. Configure the values documented in `.env.sample` on the hosting service.
2. Apply the committed migrations before the first deployment.
3. Add the production address and Google callback address to the OAuth client.
4. Check the live and readiness endpoints before inviting a restaurant.

For upgrades, apply `20260907000100_service_planning` before deploying this version, then regenerate the Prisma client during installation/build. It adds tenant-isolated service plans and immutable plan revisions, and increases the bounded receiving document capacity. Existing award and legacy delivery records remain readable. The readiness and restore checks require the updated schema. Local test migrations do not update the production database.

## Verification

```bash
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

The checks cover access control, workspace isolation, authentication, menu intake, OCR boundaries, supplier workflow, quote integrity, landed cost calculations, awards, delivery and invoice checks, repeat ordering, exports, responsive layouts, accessibility, migrations, and a bounded twenty restaurant load profile.

## Project references

- [Brand assets and usage](docs/brand/README.md)
- [India restaurant procurement review](docs/research/india-restaurant-procurement-competitive-review.md)

Repository: [github.com/Utsavd7/QuotePlate](https://github.com/Utsavd7/QuotePlate)
