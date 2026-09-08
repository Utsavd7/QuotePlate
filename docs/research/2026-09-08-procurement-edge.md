# QuotePlate competitive direction — 8 September 2026

Reviewed against current code and public competitor pages. Published features are vendor claims, not hands-on verification. No industry-first or savings guarantee is supported by this review.

## Where competition is strongest

- [Petpooja Purchase Manager](https://blog.petpooja.com/industry-business-guides/petpooja-purchase-manager-features-setup/) advertises a free POSS add-on with connected platform prices, uploaded local rates and inventory sync. QuotePlate should make repeat supplier entry easier while preserving explicit current confirmation.
- [Hospiverse](https://www.hospiverse.in/for-restaurants) advertises assisted sourcing and screened suppliers. A real map listing does not establish wholesale supply, delivery coverage or stock. QuotePlate should separate discovery, supplier declarations and restaurant verification.
- [Workwise](https://hospitality.letsworkwise.com/) presents multi-property contracts, masked evaluation and negotiations. QuotePlate is presently better scoped to independent restaurant procurement than enterprise tender management.
- [SupplyNote](https://supplynote.in/ims) advertises inventory, PO/GRN, supplier ledgers, production and payments. [Restroworks](https://www.restroworks.com/restaurant-supply-chain-management-software/) advertises connected purchasing and outlet transfers. QuotePlate does not replace these broader platforms.
- [BirchStreet](https://birchstreetai.com/products/recipe-management/) connects recipes, requisitions and inventory; recipe-driven purchasing is not a unique invention. [RestoX](https://www.quantbit.io/solutions/restox/restaurant-procurement-software) advertises broad receipt/invoice/approval controls requiring implementation verification.
- [The Right Vendor](https://therightvendor.com/) closely overlaps in requests, bids and selection. [HorecaShip](https://www.horecaship.com/) still labels procurement as coming in 2026. [HorecaBid](https://www.horecabid.com/) advertises automatic supplier discovery; Indian availability was not established.

## Implemented response in this branch

1. Supplier-declared trading profile with service PINs, wholesale status, minimum order, cutoff, lead time, a server timestamp and stale-data messaging. The declaration is tenant-private, versioned and scoped to the current supplier portal. It does not certify the vendor or claim current stock.
2. Explicit reuse of matching earlier prices in the supplier's own quote form. Historical data is labelled; current quantities and availability are not inferred and nothing submits automatically.
3. Billed cost per accepted unit using recorded line billing and accepted quantities, preserving unit/specification distinctions. The view states GST assumptions and excludes order credits/freight; it is not cash paid.
4. Delivery/credit follow-up list derived from the same bounded award sample, linking to unresolved purchases without inventing deadlines or settlements.

## What still needs business validation

The potential advantage is less repeated entry and clearer accountability across local suppliers. Demonstrate time to first quote, repeat quote completion, percentage of supplier profiles confirmed, delivery issues resolved and restaurant-recorded credits recovered. Do not publish numerical benefits before genuine pilot evidence supports them. No POS, perpetual inventory, bank settlement or physical delivery integration is introduced by this upgrade.
