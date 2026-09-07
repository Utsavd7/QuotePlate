# Service planning contract

Page: `/service-planning`. All endpoints authenticate an ACTIVE account within an active tenant, run tenant-scoped transactions, return private/no-store responses, and guard browser JSON mutations with the existing same-origin protection.

- `GET /api/service-planning`: `{ plans, menus, deliveryDetails }` (100 recent plans and approved menus).
- `POST /api/service-planning`: `{ menuId, document }`; snapshots the approved menu and its version. Returns the saved plan with computed `readiness`.
- `GET /api/service-planning/:id`: saved plan, approved menu snapshot, readiness, and matching saved supplier capabilities labeled unconfirmed.
- `PUT /api/service-planning/:id`: `{ expectedVersion, document }`; atomic compare-and-update, inserts an immutable revision. Returns 409 on stale or procurement-frozen plans.
- `POST /api/service-planning/:id/repeat`: `{ expectedVersion, serviceAt }`; new saved plan using the original recipe snapshot and portion choices, with inventory and request link cleared.
- `POST /api/service-planning/:id/procurement`: `{ expectedVersion, deliveryDate: 'YYYY-MM-DD', quoteDeadline: ISO timestamp, deliveryDetails: { addressLine, city, state, pin } }`. Creates a real DRAFT atomically with the version claim and returns `{ requestId, reviewUrl: '/procurement/:id', version }`. Repeated conversion is rejected. Existing procurement validators enforce delivery/deadline and document/sourcing rules. Initial sourcing accepts verified supplier applications; users review and edit sourcing before opening it.

`document`:

```json
{
  "name": "Lunch service",
  "serviceAt": "2026-09-10T07:00:00Z",
  "dishes": [{ "dishId": "dish-id", "batchServings": "10", "portions": "20" }],
  "inventory": [{
    "itemKey": "rice",
    "unit": "KILOGRAM",
    "yieldPercent": "80",
    "stock": "4",
    "incoming": [{
      "quantity": "1",
      "arrivesAt": "2026-09-10T06:00:00Z",
      "confirmed": true,
      "evidence": "Supplier phone confirmation, order 123; not included in current stock"
    }]
  }]
}
```

Decimal quantities are strings, up to three input decimal places. Batch servings are explicit: source menu quantities are never presumed per portion. Zero-portion dishes need no batch assumption and contribute no demand. Recipe quantities are usable ingredient amounts per batch. Inventory and incoming are already usable; required purchase = max(0, total usable demand − usable stock − eligible confirmed usable incoming) / yield. All calculations use exact rational BigInt arithmetic. Only the final purchase rounds upward to 0.001 normalized standard units. Available stock is displayed exactly to six decimals where grams/ml normalization requires it. Overflow is rejected.

`readiness.ingredients` fields: `required` (usable demand rounded up for display), `available` (usable by service), `usableDeficit`, `deficit` (purchase quantity), `yieldPercent`, `blocked`, and `evidence`. A blocked quantity is not procurement-ready, even if its placeholder deficit is zero. Unknown inventory, empty recipes, incompatible units, and same-key/different specifications block procurement. Different specifications remain separate rows and receive no ambiguous shared stock credit. Pack/case/crate conversions must be explicitly corrected in the recipe; no pack-size inference. Shared stock is allocated once in selected dish order.

UI labels for browser tests: "Start from an approved menu", "Plan name", "Service date and time (your local timezone)", "Batch servings for <dish-id>", "Desired portions for <dish-id>", "Current usable stock", "Usable yield %", "Save and calculate readiness", "Required delivery date", "Quote deadline (local time)", "Create procurement draft", "New service date and time", "Repeat for another day". Stock and yield start blank; untouched blank rows are saved as unknown, never zero. After save, results represent the last persisted version. Loading or repeating fills missing inventory rows with blank fields for explicit entry.

Migration `20260907000100_service_planning` adds ServicePlan and ServicePlanRevision, FORCE RLS, role-specific tenant policies, composite tenant foreign keys, JSON bounds and explicit backup SELECT grants. It also raises the existing Award receiving JSON bound to 1 MiB at the receiving owner's request. No migration is applied by this implementation.

Automated tests in `__tests__/service-planning/` cover the engine, transaction-service behavior via mocks, HTTP security/errors, and server-rendered evidence UI. Real PostgreSQL coverage in `__tests__/integration/service-planning.test.ts` verifies persistence, immutable recipe snapshots, tenant boundaries, stale edits, repeat plans and concurrent draft conversion. `tests/e2e/service-readiness.spec.ts` exercises the actual UI on desktop and phone. Supplier suggestions use saved capabilities only; they do not claim current quote availability or price. Budget estimation is not included.
