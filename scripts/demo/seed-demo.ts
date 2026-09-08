/** Operator-only create-once fixture. Never import this module into an app route. */
import { randomBytes, createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type Supplier } from '@prisma/client';
import { DEMO_TENANT_ID, DEMO_OWNER_ID, DEMO_OWNER_EMAIL } from '../../src/lib/demo/identity';
import { createPasswordRecord, verifyPassword } from '../../src/lib/password';
import { assertRuntimeDatabaseRole } from '../../src/lib/db/runtime-role';
import { validateMenuDocument } from '../../src/lib/menu/menu-document';
import { validateRequestDocuments } from '../../src/lib/procurement/request-document';
import { appendQuoteRevision, type QuoteRevisionsV1 } from '../../src/lib/quotes/quote-revisions';
import { validateAwardDocuments, type AwardAllocationLinesV1, type AwardSupplierSnapshotsV1 } from '../../src/lib/awards/award-document';
import { buildReceivingSummary, validateStoredReceiving } from '../../src/lib/receiving/receiving-document';
import { validateReceivingDetails } from '../../src/lib/receiving/receiving-details';
import { validateSupplierCapabilities } from '../../src/lib/suppliers/supplier-capabilities';
import { validateSupplierLifecycleState } from '../../src/lib/suppliers/supplier-schema';
import { readTradingProfile } from '../../src/lib/trading-profile/domain';
import { computePlan, validatePlanInput } from '../../src/lib/service-planning/planning';
import { TUTORIAL_LAST_STEP } from '../../src/lib/tutorial/tutorial-state';
import { demoRestaurant, demoSeedMapping } from '../../test-support/demo-restaurant-data';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const recordId = (sourceId: string) => `${DEMO_TENANT_ID}:${sourceId}`;
const dayMs = 86_400_000;
const sum = (values: string[]) => values.reduce((total, value) => total + BigInt(value), BigInt(0)).toString();
const rupees = (paise: string) => `${BigInt(paise) / BigInt(100)}.${(BigInt(paise) % BigInt(100)).toString().padStart(2, '0')}`;
const fictional = 'Fictional internal demo; no real supplier, order, invoice or payment.';

export type DemoSeedResult = {
  tenantId: string;
  email: string;
  counts: { users: number; menus: number; suppliers: number; requests: number; supplierRequests: number; awards: number; servicePlans: number };
};

async function result(tx: Prisma.TransactionClient): Promise<DemoSeedResult> {
  const where = { tenantId: DEMO_TENANT_ID };
  return {
    tenantId: DEMO_TENANT_ID, email: DEMO_OWNER_EMAIL,
    counts: {
      users: await tx.user.count({ where }), menus: await tx.menu.count({ where }),
      suppliers: await tx.supplier.count({ where }), requests: await tx.procurementRequest.count({ where }),
      supplierRequests: await tx.supplierRequest.count({ where }), awards: await tx.award.count({ where }),
      servicePlans: await tx.servicePlan.count({ where }),
    },
  };
}

/** Local operator command: supports the restricted app role or an admin fixture client.
 * The app role uses normal forced RLS scoped only to the fixed demo tenant.
 * Existing identity + matching password => read-only no-op, even after restaurant edits.
 * Conflicts, validation failures and creation errors roll back the entire transaction.
 */
export async function seedDemoRestaurant(client: PrismaClient, password: string, now: Date = new Date()): Promise<DemoSeedResult> {
  if (typeof password !== 'string' || password.length < 16 || password.trim().length < 16) {
    throw new Error('Demo password must contain at least 16 non-padding characters.');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('A valid seed date is required.');
  const seedNow = new Date(now);
  const offset = seedNow.getTime() - Date.parse(demoRestaurant.profile.asOf);
  const shifted = (source: string) => new Date(Date.parse(source.length === 10 ? `${source}T12:00:00+05:30` : source) + offset);
  const iso = (source: string) => shifted(source).toISOString();
  const dateOnly = (source: string) => shifted(source).toISOString().slice(0, 10);

  return client.$transaction(async tx => {
    const roles = await tx.$queryRaw<Array<{ allowed: boolean; role: string }>>`
      SELECT (rolsuper OR rolbypassrls) AS allowed, current_user::TEXT AS role FROM pg_roles WHERE rolname = current_user
    `;
    if (roles[0]?.role === 'autorfp_app') await assertRuntimeDatabaseRole(tx);
    else if (roles[0]?.allowed !== true) throw new Error('Demo seeding requires the restricted app role or an admin fixture role.');
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${DEMO_TENANT_ID}, true)`;
    // Serializes concurrent create-once runs without locking or touching another tenant.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${DEMO_TENANT_ID}))`;
    const tenant = await tx.tenant.findUnique({ where: { id: DEMO_TENANT_ID } });
    const identities = await tx.user.findMany({ where: { OR: [{ id: DEMO_OWNER_ID }, { email: { equals: DEMO_OWNER_EMAIL, mode: 'insensitive' } }] } });
    if (tenant || identities.length) {
      const owner = identities[0];
      if (!tenant || identities.length !== 1 || owner.id !== DEMO_OWNER_ID || owner.email !== DEMO_OWNER_EMAIL || owner.tenantId !== DEMO_TENANT_ID || owner.role !== 'OWNER' || !owner.isActive || owner.accountState !== 'ACTIVE' || !tenant.isActive || !(await verifyPassword(password, owner.passwordHash))) {
        throw new Error('Existing demo identity or password does not match. No records were changed.');
      }
      return result(tx);
    }

    const passwordRecord = await createPasswordRecord(password);
    const address = { addressLine: 'Fictional kitchen · Kothrud', city: 'Pune', state: 'Maharashtra', pin: '411038' };
    // Illustrative restaurant-only number, accepted by the normal settings form.
    // Supplier contact numbers remain null; this is not a real contact record.
    const buyer = { name: 'DEMO · Monsoon Table', ...address, phone: '9000000000', gstin: null };
    const deliveryDetails = { ...address, instructions: `${fictional} Receiving 07:00–10:00 IST unless a later slot is confirmed.` };
    await tx.tenant.create({ data: { id: DEMO_TENANT_ID, ...buyer, timezone: 'Asia/Kolkata', createdAt: seedNow } });
    await tx.user.create({ data: {
      id: DEMO_OWNER_ID, tenantId: DEMO_TENANT_ID, email: DEMO_OWNER_EMAIL,
      name: demoRestaurant.profile.ownerName, ...passwordRecord, role: 'OWNER', accountState: 'ACTIVE', isActive: true,
      tutorialVersion: 1, tutorialStep: TUTORIAL_LAST_STEP, tutorialCompletedAt: seedNow, createdAt: seedNow,
    } });

    const menuDocument = validateMenuDocument(demoRestaurant.menu);
    const menuId = recordId('menu-1');
    await tx.menu.create({ data: {
      id: menuId, tenantId: DEMO_TENANT_ID, name: 'DEMO · Monsoon Table kitchen recipes', status: 'APPROVED', version: 1,
      document: json(menuDocument), sourceText: `${fictional} Quantities are usable ingredients per ten portions. Dry pulses are weighed before soaking.`,
      approvedAt: seedNow, approvedByUserId: DEMO_OWNER_ID, createdByUserId: DEMO_OWNER_ID, createdAt: seedNow,
    } });

    const suppliers = new Map<string, Supplier>();
    for (const source of demoRestaurant.suppliers) {
      const capabilities = validateSupplierCapabilities({ v: 1, categories: source.categories.map((category, index) => ({ category, tier: 'CAPABLE', rank: index + 1 })), items: [] });
      const lifecycle = {
        relationshipType: source.status === 'INVITED' ? 'SELECTED_NEW' as const : 'CURRENT' as const,
        verificationStatus: 'VERIFIED' as const, applicationRequestId: null,
        verifiedAt: seedNow, verifiedByUserId: DEMO_OWNER_ID, isActive: source.status !== 'PAUSED',
      };
      validateSupplierLifecycleState(lifecycle);
      const tradingProfile = readTradingProfile({
        wholesale: 'yes', servedPins: [address.pin], minimumOrderInr: '0', orderCutoffIst: '17:00', leadTimeDays: 1,
        note: `${fictional} ${source.deliveryNote}. Payment terms: ${source.paymentTermsDays} days.`, revision: 1, updatedAt: seedNow.toISOString(),
      });
      const supplier = await tx.supplier.create({ data: {
        id: recordId(source.id), tenantId: DEMO_TENANT_ID, businessName: source.name,
        contactName: `${source.contactName} (fictional)`, email: `${source.id}@supplier.example`, phone: null, whatsappNumber: null,
        ...address, addressLine: 'Fictional supplier · Pune demo supply area',
        notes: `${fictional} Verification is a seeded demo state, not real-world verification. ${source.deliveryNote}.`,
        ...lifecycle, capabilities: json(capabilities), tradingProfile: json(tradingProfile), createdAt: seedNow,
      } });
      suppliers.set(source.id, supplier);
    }

    for (const source of demoRestaurant.purchases) {
      const requestId = recordId(source.id);
      const status = demoSeedMapping.requestStatus[source.status];
      // An unsent draft still needs eligible sourcing so it can be edited/opened normally.
      const sourcingSupplierIds = source.invitedSupplierIds.length ? source.invitedSupplierIds : demoRestaurant.suppliers
        .filter(supplier => supplier.status === 'ACTIVE' && source.lines.some(line => supplier.categories.includes(demoRestaurant.ingredients.find(item => item.id === line.itemKey)!.category)))
        .map(supplier => supplier.id);
      const documents = validateRequestDocuments({ v: 1, items: source.lines.map(line => {
        const ingredient = demoRestaurant.ingredients.find(item => item.id === line.itemKey)!;
        return { id: line.id, itemKey: line.itemKey, name: ingredient.name, quantity: line.quantity, unit: line.unit,
          specification: { v: 1, category: ingredient.category, qualityGrade: 'Kitchen grade', notes: fictional }, sourcingOverride: null };
      }) }, { v: 1, default: { v: 1, modes: ['CURRENT'], currentSupplierIds: sourcingSupplierIds.map(recordId), selectedNewSupplierIds: [], acceptVerifiedApplications: false } });
      const createdAt = shifted(source.createdAt);
      const quoteDeadline = status === 'OPEN' || status === 'DRAFT'
        ? new Date(Math.max(shifted(source.quoteDeadline).getTime(), seedNow.getTime() + 2 * dayMs))
        : shifted(source.quoteDeadline);
      const deliveryDate = status === 'OPEN' || status === 'DRAFT'
        ? new Date(Math.max(shifted(source.neededBy).getTime(), quoteDeadline.getTime() + 2 * dayMs)).toISOString().slice(0, 10)
        : dateOnly(source.neededBy);
      const commercialTerms = `${fictional} Illustrative final rates; no separately modelled GST or freight. Not a tax invoice.`;
      await tx.procurementRequest.create({ data: {
        id: requestId, tenantId: DEMO_TENANT_ID, title: `DEMO · ${source.title}`, status, menuId,
        items: json(documents.items), sourcing: json(documents.sourcing), deliveryDetails: json(deliveryDetails),
        deliveryDate: new Date(deliveryDate), quoteDeadline, commercialTerms,
        createdByUserId: DEMO_OWNER_ID, createdAt, openedAt: status === 'DRAFT' ? null : createdAt,
        awardedAt: status === 'AWARDED' ? shifted(demoRestaurant.quotes.find(quote => quote.requestId === source.id)!.submittedAt) : null,
      } });
      const grants = new Map<string, { id: string; document: QuoteRevisionsV1 }>();
      for (const sourceSupplierId of source.invitedSupplierIds) {
        const supplier = suppliers.get(sourceSupplierId)!;
        const quote = demoRestaurant.quotes.find(entry => entry.requestId === source.id && entry.supplierId === sourceSupplierId);
        const grantId = recordId(`${source.id}-${sourceSupplierId}`);
        const validUntil = status === 'OPEN' ? new Date(quoteDeadline.getTime() + dayMs).toISOString().slice(0, 10) : quote ? dateOnly(quote.validUntil) : deliveryDate;
        const document = quote ? appendQuoteRevision({ v: 1, revisions: [] }, {
          deliveryDate, validUntil, minimumOrder: null, freightInr: '0',
          commercialTerms: `${fictional} Payment within ${quote.paymentTermsDays} days.`, notes: source.notes,
          items: quote.lines.map(line => ({
            requestItemId: line.id, noQuote: false, availableQuantity: line.quantity, unit: line.unit,
            unitRateInr: rupees(line.unitRatePaise), gstPercent: '0', taxInclusive: false,
            suppliedBrand: null, suppliedPackSize: line.unit === 'KILOGRAM' ? 'Bulk by kg' : 'Bulk by litre', suppliedQualityGrade: 'Kitchen grade', substitution: null,
          })),
        }, { requestItems: documents.items.items, expectedLatestRevision: 0, storedLatestRevision: 0, databaseNow: shifted(quote.submittedAt) }) : { v: 1 as const, revisions: [] };
        await tx.supplierRequest.create({ data: {
          id: grantId, tenantId: DEMO_TENANT_ID, requestId, supplierId: supplier.id,
          // The raw random invitation token is deliberately discarded, never returned or logged.
          tokenDigest: createHash('sha256').update(randomBytes(32)).digest('hex'),
          expiresAt: new Date(Math.max(quoteDeadline.getTime(), shifted(source.neededBy).getTime()) + dayMs),
          quoteRevision: document.revisions.length, quoteRevisions: json(document), createdAt,
          viewedAt: quote ? shifted(quote.submittedAt) : null,
        } });
        grants.set(sourceSupplierId, { id: grantId, document });
      }

      const group = demoSeedMapping.awardGroups.find(entry => entry.requestId === source.id);
      if (!group) continue;
      const allocations = demoRestaurant.awards.filter(award => group.supplierAllocationIds.includes(award.id));
      const allocationLines: AwardAllocationLinesV1 = { v: 1, lines: allocations.flatMap(allocation => allocation.lines.map(line => ({
        requestItemId: line.id, supplierRequestId: grants.get(allocation.supplierId)!.id, supplierId: suppliers.get(allocation.supplierId)!.id,
        quoteRevision: 1, quantity: line.quantity, unit: line.unit, unitRatePaise: line.unitRatePaise,
        gstBasisPoints: 0, subtotalPaise: line.totalPaise, gstPaise: '0', totalPaise: line.totalPaise,
      }))) };
      const supplierSnapshots: AwardSupplierSnapshotsV1 = { v: 1, suppliers: allocations.map(allocation => {
        const supplier = suppliers.get(allocation.supplierId)!;
        const grant = grants.get(allocation.supplierId)!;
        const quote = grant.document.revisions[0];
        return {
          supplierId: supplier.id, supplierRequestId: grant.id, quoteRevision: 1, supplierName: supplier.businessName,
          contactName: supplier.contactName, phone: null, whatsappNumber: null, email: supplier.email,
          addressLine: supplier.addressLine, city: supplier.city, state: supplier.state, pin: supplier.pin, gstin: null,
          submittedAt: quote.submittedAt, deliveryDate: quote.deliveryDate, validUntil: quote.validUntil,
          minimumOrder: quote.minimumOrder, freightPaise: quote.freightPaise, commercialTerms: quote.commercialTerms, notes: quote.notes,
          // Snapshot totals retain the complete offer, even where only one line was awarded.
          subtotalPaise: quote.subtotalPaise, gstPaise: quote.gstPaise, totalPaise: quote.totalPaise,
          lines: allocation.lines.map(line => {
            const requested = documents.items.items.find(item => item.id === line.id)!;
            const offered = quote.items.find(item => item.requestItemId === line.id)!;
            return { requestItemId: line.id, itemKey: line.itemKey, itemName: requested.name,
              requestedQuantity: requested.quantity, requestedUnit: requested.unit, requestedSpecification: requested.specification,
              taxInclusive: offered.taxInclusive, suppliedBrand: offered.suppliedBrand, suppliedPackSize: offered.suppliedPackSize,
              suppliedQualityGrade: offered.suppliedQualityGrade, substitution: offered.substitution };
          }),
        };
      }) };
      const deliverySnapshot = { v: 1 as const, requestTitle: `DEMO · ${source.title}`, requestedDeliveryDate: deliveryDate, deliveryDetails, commercialTerms, buyer };
      const totalPaise = sum(allocationLines.lines.map(line => line.totalPaise));
      if (totalPaise !== group.totalPaise) throw new Error('Demo award totals do not reconcile.');
      const validated = validateAwardDocuments({ allocationLines, supplierSnapshots, deliverySnapshot, totalPaise: BigInt(totalPaise) });
      const receiving = validateStoredReceiving({ v: 1, suppliers: allocations.flatMap(allocation => {
        const receipt = demoRestaurant.receiving.find(entry => entry.awardId === allocation.id);
        if (!receipt) return [];
        const details = validateReceivingDetails({
          items: receipt.lines.map(line => ({ requestItemId: allocation.lines.find(item => item.itemKey === line.itemKey)!.id,
            receivedQuantity: line.receivedQuantity, rejectedQuantity: line.rejectedQuantity, billedQuantity: line.billedQuantity, billedUnitRatePaise: line.billedUnitRatePaise })),
          actualDeliveryDate: receipt.closesDelivery ? dateOnly(receipt.deliveredAt) : null,
          creditClaimedPaise: receipt.creditClaimedPaise, creditReceivedPaise: receipt.creditReceivedPaise,
          settlementNote: `${receipt.invoiceReference} (fictional). ${receipt.note}`,
        });
        return [{ supplierId: suppliers.get(allocation.supplierId)!.id, outcome: receipt.issueCodes.length ? 'ISSUES' : 'MATCHED',
          invoiceTotalPaise: receipt.billedPaise, issueCodes: receipt.issueCodes, note: `${fictional} ${receipt.note}`, checkedAt: iso(receipt.checkedAt), details }];
      }) });
      // Validates quantities against exactly the selected supplier lines before any award write.
      buildReceivingSummary({ ...validated, receiving });
      await tx.award.create({ data: {
        id: recordId(group.id), tenantId: DEMO_TENANT_ID, requestId, awardedByUserId: DEMO_OWNER_ID,
        rationale: `${fictional} ${allocations.map(allocation => allocation.rationale).filter((value, index, values) => values.indexOf(value) === index).join(' ')}`,
        allocationLines: json(validated.allocationLines), supplierSnapshots: json(validated.supplierSnapshots), deliverySnapshot: json(validated.deliverySnapshot),
        receiving: json(receiving), totalPaise: BigInt(validated.totalPaise), createdAt: new Date(supplierSnapshots.suppliers[0].submittedAt),
      } });
    }

    for (const [index, label] of ['Dinner · 110 expected covers', 'Lunch · 70 expected covers'].entries()) {
      const serviceAt = new Date(shifted(demoRestaurant.profile.serviceAt).getTime() - index * 6 * 3_600_000).toISOString();
      const input = validatePlanInput({
        ...demoRestaurant.servicePlanInput, name: `DEMO · ${label}`, serviceAt,
        dishes: demoRestaurant.servicePlanInput.dishes.map(dish => ({ ...dish, portions: index === 0 ? dish.portions : String(Math.round(Number(dish.portions) * 70 / 110)) })),
        inventory: demoRestaurant.servicePlanInput.inventory.map(item => ({ ...item, incoming: item.incoming.map(incoming => ({ ...incoming, arrivesAt: iso(incoming.arrivesAt) })) })),
      });
      computePlan(menuDocument, input);
      const planId = recordId(`plan-${index + 1}`);
      await tx.servicePlan.create({ data: {
        id: planId, tenantId: DEMO_TENANT_ID, name: input.name, serviceAt: new Date(input.serviceAt), menuId, menuVersion: 1,
        menuSnapshot: json(menuDocument), document: json(input), createdByUserId: DEMO_OWNER_ID, createdAt: seedNow,
      } });
      await tx.servicePlanRevision.create({ data: { id: recordId(`plan-revision-${index + 1}`), tenantId: DEMO_TENANT_ID, planId, version: 1, document: json(input), createdAt: seedNow } });
    }
    await tx.auditEvent.create({ data: {
      id: recordId('seed-v1'), tenantId: DEMO_TENANT_ID, actorUserId: DEMO_OWNER_ID, action: 'demo.seeded', entityType: 'Tenant', entityId: DEMO_TENANT_ID,
      metadata: { fictional: true, version: 1, note: 'Operator-created internal demo. No external messages sent. Subsequent runs preserve edits.' }, createdAt: seedNow,
    } });
    return result(tx);
  }, { maxWait: 30_000, timeout: 60_000 });
}
