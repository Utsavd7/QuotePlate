/**
 * SYNTHETIC DEMO ONLY. Monsoon Table and every supplier/person are fictional.
 * Fixed snapshot, not live inventory, a tax invoice, a seed, or an account record.
 * Test-support only: do not import from public routes. JSON-serializable data; no auth, persistence, clock or random IDs.
 * Money is unsigned integer paise text; quantities are decimal text (<= 3 places).
 * Rates are illustrative final rates, with zero separately modelled tax/freight.
 * This simplification is NOT a statement about applicable GST classifications.
 */
import { buildSupplierPerformance, type SupplierObservation } from '@/lib/reporting/supplier-performance';
import { computePlan, type PlanInput } from '@/lib/service-planning/planning';
import type { MenuDocumentV1 } from '@/lib/menu/menu-document';
import type { ProcurementCategory } from '@/lib/domain/procurement-categories';

export type DemoPaise = string;
export type DemoQuantity = string;
export type DemoUnit = 'KILOGRAM' | 'LITRE';
export type DemoSupplier = {
  id: string; name: string; fictional: true; contactName: string; email: string;
  phone: null; categories: ProcurementCategory[]; paymentTermsDays: number;
  status: 'ACTIVE' | 'INVITED' | 'PAUSED'; locality: string; deliveryNote: string;
};
export type DemoIngredient = {
  id: string; name: string; unit: DemoUnit; category: ProcurementCategory;
  referenceRatePaise: DemoPaise; usableStock: DemoQuantity; yieldPercent: string;
};
export type DemoPurchaseLine = {
  id: string; itemKey: string; quantity: DemoQuantity; unit: DemoUnit;
};
export type DemoQuoteLine = DemoPurchaseLine & { unitRatePaise: DemoPaise; totalPaise: DemoPaise };
export type DemoQuote = {
  id: string; requestId: string; supplierId: string; submittedAt: string;
  validUntil: string; paymentTermsDays: number; lines: DemoQuoteLine[];
  subtotalPaise: DemoPaise; gstPaise: DemoPaise; freightPaise: DemoPaise; totalPaise: DemoPaise;
};
export type DemoPurchaseRequest = {
  id: string; reference: string; title: string; category: 'GROCERY' | 'DAIRY' | 'VEGETABLES';
  status: 'DRAFT' | 'SENT' | 'COMPARING' | 'AWARDED' | 'PARTIALLY_RECEIVED' | 'RECEIVED';
  createdAt: string; neededBy: string; quoteDeadline: string; notes: string;
  lines: DemoPurchaseLine[]; invitedSupplierIds: string[]; quoteIds: string[]; awardIds: string[];
};
export type DemoAward = {
  id: string; requestId: string; quoteId: string; supplierId: string;
  promisedDate: string; lines: DemoQuoteLine[]; totalPaise: DemoPaise; rationale: string;
};
export type DemoReceivingLine = {
  itemKey: string; unit: DemoUnit; receivedQuantity: DemoQuantity; rejectedQuantity: DemoQuantity;
  acceptedQuantity: DemoQuantity; billedQuantity: DemoQuantity; billedUnitRatePaise: DemoPaise;
  billedPaise: DemoPaise; acceptedValuePaise: DemoPaise; invoiceDifferencePaise: string;
  creditClaimedPaise: DemoPaise; creditReceivedPaise: DemoPaise;
};
export type DemoReceipt = {
  id: string; awardId: string; checkedAt: string; deliveredAt: string; invoiceReference: string;
  closesDelivery: boolean; issueCodes: string[]; note: string; lines: DemoReceivingLine[];
  billedPaise: DemoPaise; acceptedValuePaise: DemoPaise; creditClaimedPaise: DemoPaise;
  creditReceivedPaise: DemoPaise; creditOutstandingPaise: DemoPaise;
};
export type DemoDish = {
  id: string; name: string; section: 'Starters' | 'Mains' | 'Breads & rice' | 'Sides & sweets';
  sellingPricePaise: DemoPaise; batchServings: string; plannedPortions: string; vegetarian: true;
};

const id = (kind: string, key: string | number) => `demo-mt-${kind}-${key}`;
const sum = (values: string[]) => values.reduce((total, value) => total + BigInt(value), BigInt(0)).toString();
const milli = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, '0'));
};
const quantity = (value: bigint) => `${value / BigInt(1000)}.${(value % BigInt(1000)).toString().padStart(3, '0')}`;
const cost = (qty: string, rate: string) => ((milli(qty) * BigInt(rate) + BigInt(500)) / BigInt(1000)).toString();
const difference = (a: string, b: string) => (BigInt(a) - BigInt(b)).toString();

export const demoRestaurantProfile = {
  id: id('restaurant', 1), name: 'Monsoon Table', label: 'Synthetic restaurant demo', synthetic: true,
  city: 'Pune', neighbourhood: 'Kothrud', timezone: 'Asia/Kolkata', currency: 'INR',
  cuisine: 'Vegetarian Maharashtrian and North Indian neighbourhood kitchen',
  seats: 48, typicalDailyCovers: 110, ownerName: 'Anaya Deshmukh (fictional)',
  procurementLead: 'Kabir Joshi (fictional)', email: 'monsoon-table@example.com', phone: null,
  asOf: '2026-09-08T10:00:00+05:30', serviceAt: '2026-09-09T19:00:00+05:30',
  receivingWindow: '07:00–10:00 IST',
  disclaimer: 'All names, orders, recipes, stock counts and financial records are synthetic. No messages or orders have been sent.',
} as const;

const supplierSeeds: [string, string, ProcurementCategory[], number, DemoSupplier['status'], string][] = [
  ['sahyadri', 'Sahyadri Basket', ['VEGETABLES'], 7, 'ACTIVE', 'Early morning produce; reusable crates'],
  ['pavana', 'Pavana Fresh', ['VEGETABLES'], 7, 'ACTIVE', 'Backup produce; next-day supply'],
  ['dew', 'Deccan Dew Dairy', ['DAIRY'], 7, 'ACTIVE', 'Chilled dairy before 09:00'],
  ['mogra', 'Mogra Milk Works', ['DAIRY'], 14, 'ACTIVE', 'Chilled dairy; split delivery available'],
  ['grain', 'Amber Grain House', ['GRAINS_PULSES', 'FLOUR_BAKERY'], 15, 'ACTIVE', 'Dry staples twice weekly'],
  ['pantry', 'Copper Pot Pantry', ['GRAINS_PULSES', 'OILS_FATS', 'SPICES_SEASONINGS', 'DRY_GOODS', 'FLOUR_BAKERY'], 14, 'ACTIVE', 'Consolidated pantry orders'],
  ['spice', 'Rainleaf Spice Co.', ['SPICES_SEASONINGS'], 0, 'INVITED', 'Catalogue review pending'],
  ['reserve', 'Hillshade Provisions', ['GRAINS_PULSES', 'DRY_GOODS'], 7, 'PAUSED', 'Paused during fictional warehouse refit'],
];
export const demoSuppliers: DemoSupplier[] = supplierSeeds.map(([key, name, categories, terms, status, note], index) => ({
  id: id('supplier', key), name: `${name} (fictional)`, fictional: true,
  contactName: `Demo supplier contact ${index + 1}`, email: `${key}@example.com`, phone: null,
  categories, paymentTermsDays: terms, status, locality: 'Pune demo supply area', deliveryNote: note,
}));

const ingredientSeeds: [string, string, DemoUnit, ProcurementCategory, string, string, string][] = [
  ['tomato', 'Ripe tomato', 'KILOGRAM', 'VEGETABLES', '4000', '2', '95'],
  ['onion', 'Red onion', 'KILOGRAM', 'VEGETABLES', '3200', '3', '90'],
  ['potato', 'Potato', 'KILOGRAM', 'VEGETABLES', '2800', '2', '85'],
  ['spinach', 'Spinach leaves', 'KILOGRAM', 'VEGETABLES', '6000', '0.5', '80'],
  ['cauliflower', 'Cauliflower', 'KILOGRAM', 'VEGETABLES', '5000', '1', '65'],
  ['peas', 'Shelled green peas', 'KILOGRAM', 'VEGETABLES', '12000', '0.5', '100'],
  ['coriander', 'Coriander leaves', 'KILOGRAM', 'VEGETABLES', '10000', '0.15', '80'],
  ['ginger', 'Ginger', 'KILOGRAM', 'VEGETABLES', '14000', '0.4', '90'],
  ['garlic', 'Peeled garlic', 'KILOGRAM', 'VEGETABLES', '18000', '0.4', '100'],
  ['paneer', 'Fresh paneer', 'KILOGRAM', 'DAIRY', '32000', '0.5', '100'],
  ['curd', 'Plain curd', 'KILOGRAM', 'DAIRY', '8000', '1', '100'],
  ['milk', 'Whole milk', 'LITRE', 'DAIRY', '6000', '1', '100'],
  ['ghee', 'Ghee', 'KILOGRAM', 'DAIRY', '60000', '0.5', '100'],
  ['rice', 'Basmati rice', 'KILOGRAM', 'GRAINS_PULSES', '9500', '4', '100'],
  ['dal', 'Toor dal', 'KILOGRAM', 'GRAINS_PULSES', '14000', '1', '100'],
  ['chickpea', 'Dried chickpeas', 'KILOGRAM', 'GRAINS_PULSES', '10000', '1', '100'],
  ['matki', 'Dried matki beans', 'KILOGRAM', 'GRAINS_PULSES', '12000', '1', '100'],
  ['atta', 'Whole wheat atta', 'KILOGRAM', 'FLOUR_BAKERY', '4500', '3', '100'],
  ['besan', 'Besan', 'KILOGRAM', 'FLOUR_BAKERY', '9000', '0.5', '100'],
  ['oil', 'Sunflower oil', 'LITRE', 'OILS_FATS', '13000', '2', '100'],
  ['spices', 'House spice blend', 'KILOGRAM', 'SPICES_SEASONINGS', '45000', '0.4', '100'],
  ['salt', 'Salt', 'KILOGRAM', 'SPICES_SEASONINGS', '2000', '1', '100'],
  ['sugar', 'Sugar', 'KILOGRAM', 'DRY_GOODS', '4400', '0.5', '100'],
  ['cucumber', 'Cucumber', 'KILOGRAM', 'VEGETABLES', '4000', '0.5', '90'],
];
export const demoIngredients: DemoIngredient[] = ingredientSeeds.map(([key, name, unit, category, rate, stock, yieldPercent]) => ({
  id: key, name, unit, category, referenceRatePaise: rate, usableStock: stock, yieldPercent,
}));
const ingredient = (key: string) => {
  const found = demoIngredients.find(item => item.id === key);
  if (!found) throw new Error(`Unknown demo ingredient: ${key}`);
  return found;
};

// Usable recipe quantities per TEN portions, including base seasoning; water is not procured.
// Dry pulses are weighed before soaking/sprouting. Oil includes the recipe's frying allowance.
const dishSeeds: [string, DemoDish['section'], string, string, [string, string][]][] = [
  ['Kothimbir vadi', 'Starters', '16000', '20', [['besan','0.6'],['coriander','0.3'],['oil','0.15'],['spices','0.03'],['salt','0.015']]],
  ['Batata bhaji', 'Mains', '18000', '20', [['potato','1.5'],['onion','0.3'],['oil','0.1'],['spices','0.04'],['salt','0.02']]],
  ['Matki usal', 'Mains', '19000', '20', [['matki','0.6'],['onion','0.4'],['tomato','0.4'],['oil','0.1'],['spices','0.05'],['salt','0.02']]],
  ['Paneer masala', 'Mains', '28000', '30', [['paneer','1.2'],['tomato','0.8'],['onion','0.5'],['curd','0.2'],['ginger','0.04'],['garlic','0.04'],['oil','0.1'],['spices','0.06'],['salt','0.02']]],
  ['Palak paneer', 'Mains', '28000', '20', [['paneer','1'],['spinach','1.5'],['onion','0.3'],['garlic','0.04'],['ghee','0.08'],['spices','0.04'],['salt','0.02']]],
  ['Chole', 'Mains', '22000', '20', [['chickpea','0.8'],['tomato','0.5'],['onion','0.5'],['ginger','0.04'],['garlic','0.04'],['oil','0.1'],['spices','0.06'],['salt','0.02']]],
  ['Dal tadka', 'Mains', '20000', '30', [['dal','0.7'],['tomato','0.3'],['onion','0.2'],['garlic','0.04'],['ghee','0.1'],['spices','0.04'],['salt','0.02']]],
  ['Vegetable pulao', 'Breads & rice', '21000', '20', [['rice','0.9'],['cauliflower','0.4'],['peas','0.25'],['onion','0.2'],['ghee','0.08'],['spices','0.04'],['salt','0.02']]],
  ['Steamed basmati rice', 'Breads & rice', '12000', '30', [['rice','0.8'],['salt','0.01']]],
  ['Phulka pair', 'Breads & rice', '5000', '40', [['atta','0.7'],['oil','0.02'],['salt','0.005']]],
  ['Cucumber raita', 'Sides & sweets', '9000', '20', [['curd','0.8'],['cucumber','0.5'],['spices','0.015'],['salt','0.01']]],
  ['Rice kheer', 'Sides & sweets', '13000', '20', [['rice','0.15'],['milk','1.5'],['sugar','0.25']]],
];
export const demoDishes: DemoDish[] = dishSeeds.map(([name, section, price, portions], index) => ({
  id: id('dish', index + 1), name, section, sellingPricePaise: price,
  batchServings: '10', plannedPortions: portions, vegetarian: true,
}));
export const demoMenu: MenuDocumentV1 = {
  v: 1, source: { kind: 'MANUAL', canonicalUrl: null, permissionConfirmed: true },
  dishes: dishSeeds.map(([, , , , recipe], index) => ({
    id: demoDishes[index].id, name: demoDishes[index].name, position: index,
    ingredients: recipe.map(([key, qty], line) => ({
      id: id('recipe', `${index + 1}-${line + 1}`), itemKey: key, name: ingredient(key).name,
      quantity: qty, unit: ingredient(key).unit, specification: { v: 1, category: ingredient(key).category },
    })),
  })),
};

type PurchaseSeed = {
  title: string; category: DemoPurchaseRequest['category']; status: DemoPurchaseRequest['status'];
  day: string; needed: string; suppliers: string[]; items: [string, string][]; note: string;
};
const purchaseSeeds: PurchaseSeed[] = [
  { title: 'Weekly grains', category: 'GROCERY', status: 'RECEIVED', day: '01', needed: '02', suppliers: ['grain','pantry'], items: [['rice','25'],['dal','10']], note: 'All bags accepted; invoice matched.' },
  { title: 'Opening-week vegetables', category: 'VEGETABLES', status: 'PARTIALLY_RECEIVED', day: '02', needed: '03', suppliers: ['sahyadri','pavana'], items: [['tomato','20'],['onion','15']], note: 'Two kg tomato rejected; credit received in full. Accepted quantity remains short; no replacement confirmed.' },
  { title: 'Dairy replenishment', category: 'DAIRY', status: 'PARTIALLY_RECEIVED', day: '03', needed: '04', suppliers: ['dew','mogra'], items: [['paneer','8'],['curd','10']], note: 'One kg paneer rejected; credit partly settled. Accepted quantity remains short; no replacement confirmed.' },
  { title: 'Weekend pantry', category: 'GROCERY', status: 'RECEIVED', day: '04', needed: '05', suppliers: ['pantry','grain'], items: [['atta','20'],['chickpea','10']], note: 'Closed one day late; all quantities accepted.' },
  { title: 'Monday vegetables', category: 'VEGETABLES', status: 'RECEIVED', day: '05', needed: '07', suppliers: ['pavana','sahyadri'], items: [['potato','20'],['cauliflower','10']], note: 'All produce accepted.' },
  { title: 'Milk and curd split delivery', category: 'DAIRY', status: 'PARTIALLY_RECEIVED', day: '06', needed: '09', suppliers: ['mogra','dew'], items: [['milk','20'],['curd','10']], note: 'Half received 8 September; confirmed balance due 9 September morning.' },
  { title: 'Wednesday service produce', category: 'VEGETABLES', status: 'AWARDED', day: '07', needed: '09', suppliers: ['sahyadri','pavana'], items: [['tomato','10'],['spinach','5']], note: 'Split by line: Sahyadri tomato; Pavana spinach. Arrival after tomorrow lunch, before dinner.' },
  { title: 'Midweek staples comparison', category: 'GROCERY', status: 'COMPARING', day: '07', needed: '10', suppliers: ['grain','pantry'], items: [['rice','25'],['matki','8']], note: 'Two complete quotes ready to compare; no award yet.' },
  { title: 'Fresh paneer top-up', category: 'DAIRY', status: 'SENT', day: '08', needed: '10', suppliers: ['dew','mogra'], items: [['paneer','8']], note: 'Awaiting both supplier replies.' },
  { title: 'Oil and seasoning draft', category: 'GROCERY', status: 'DRAFT', day: '08', needed: '11', suppliers: [], items: [['oil','15'],['spices','2'],['salt','5']], note: 'Draft only; invitations not sent.' },
];
export const demoQuotes: DemoQuote[] = [];
export const demoAwards: DemoAward[] = [];
export const demoPurchases: DemoPurchaseRequest[] = purchaseSeeds.map((seed, index) => {
  const requestId = id('request', index + 1);
  const lines = seed.items.map(([key, qty], line) => ({ id: id('line', `${index + 1}-${line + 1}`), itemKey: key, quantity: qty, unit: ingredient(key).unit }));
  const quotes: DemoQuote[] = index < 8 ? seed.suppliers.map((key, supplierIndex) => {
    const supplier = demoSuppliers.find(s => s.id === id('supplier', key))!;
    const quoteLines = lines.map(line => {
      // Second offer is 2 INR/unit higher, allowing an explicit cold-chain/availability tradeoff.
      const rate = (BigInt(ingredient(line.itemKey).referenceRatePaise) + BigInt(supplierIndex * 200)).toString();
      return { ...line, unitRatePaise: rate, totalPaise: cost(line.quantity, rate) };
    });
    const total = sum(quoteLines.map(line => line.totalPaise));
    return { id: id('quote', `${index + 1}-${supplierIndex + 1}`), requestId, supplierId: supplier.id,
      submittedAt: `2026-09-${seed.day}T09:00:00+05:30`, validUntil: `2026-09-${seed.needed}T18:00:00+05:30`,
      paymentTermsDays: supplier.paymentTermsDays, lines: quoteLines, subtotalPaise: total,
      gstPaise: '0', freightPaise: '0', totalPaise: total };
  }) : [];
  demoQuotes.push(...quotes);
  const awards: DemoAward[] = index < 7 ? (index === 6 ? quotes : quotes.slice(0, 1)).map((quote, awardIndex) => {
    const awardedLines = index === 6 ? [quote.lines[awardIndex]] : quote.lines;
    return { id: id('award', `${index + 1}-${awardIndex + 1}`), requestId, quoteId: quote.id, supplierId: quote.supplierId,
      promisedDate: `2026-09-${seed.needed}`, lines: awardedLines, totalPaise: sum(awardedLines.map(line => line.totalPaise)),
      rationale: index === 6 ? 'Split by ingredient for confirmed fresh-stock availability; second supplier costs more per kg.' : 'Complete coverage and lower quoted total; delivery slot confirmed.' };
  }) : [];
  demoAwards.push(...awards);
  return { id: requestId, reference: `MT-2026-${String(index + 1).padStart(3, '0')}`, title: seed.title,
    category: seed.category, status: seed.status, createdAt: `2026-09-${seed.day}T08:00:00+05:30`,
    neededBy: `2026-09-${seed.needed}T18:00:00+05:30`, quoteDeadline: `2026-09-${seed.day}T17:00:00+05:30`,
    notes: seed.note, lines, invitedSupplierIds: seed.suppliers.map(key => id('supplier', key)),
    quoteIds: quotes.map(q => q.id), awardIds: awards.map(a => a.id) };
});

export const demoReceiving: DemoReceipt[] = demoAwards.slice(0, 6).map((award, index) => {
  const day = ['02','03','04','06','07','08'][index];
  const lines: DemoReceivingLine[] = award.lines.map((line, lineIndex) => {
    const received = index === 5 ? quantity(milli(line.quantity) / BigInt(2)) : line.quantity;
    const rejected = lineIndex === 0 ? (index === 1 ? '2' : index === 2 ? '1' : '0') : '0';
    const accepted = quantity(milli(received) - milli(rejected));
    const billedPaise = cost(received, line.unitRatePaise);
    const acceptedValuePaise = cost(accepted, line.unitRatePaise);
    const claimed = difference(billedPaise, acceptedValuePaise);
    const settled = index === 2 ? (BigInt(claimed) / BigInt(2)).toString() : claimed;
    return { itemKey: line.itemKey, unit: line.unit, receivedQuantity: received, rejectedQuantity: rejected,
      acceptedQuantity: accepted, billedQuantity: received, billedUnitRatePaise: line.unitRatePaise,
      billedPaise, acceptedValuePaise, invoiceDifferencePaise: '0', creditClaimedPaise: claimed, creditReceivedPaise: settled };
  });
  const claimed = sum(lines.map(line => line.creditClaimedPaise));
  const settled = sum(lines.map(line => line.creditReceivedPaise));
  return { id: id('receipt', index + 1), awardId: award.id, checkedAt: `2026-09-${day}T09:30:00+05:30`,
    deliveredAt: `2026-09-${day}T08:30:00+05:30`, invoiceReference: `DEMO-INV-${index + 1}`,
    closesDelivery: index !== 1 && index !== 2 && index !== 5, issueCodes: index === 1 || index === 2 ? ['QUALITY'] : index === 3 ? ['LATE'] : [],
    note: demoPurchases[index].notes, lines, billedPaise: sum(lines.map(line => line.billedPaise)),
    acceptedValuePaise: sum(lines.map(line => line.acceptedValuePaise)), creditClaimedPaise: claimed,
    creditReceivedPaise: settled, creditOutstandingPaise: difference(claimed, settled) };
});

export type DemoScheduledDelivery = {
  id: string; awardId: string; arrivesAt: string; confirmed: true;
  lines: { itemKey: string; quantity: string; unit: DemoUnit }[]; evidence: string;
};
export const demoUpcomingDeliveries: DemoScheduledDelivery[] = demoAwards.slice(5).map((award, index) => ({
  id: id('delivery', index + 1), awardId: award.id,
  arrivesAt: index === 0 ? '2026-09-09T08:00:00+05:30' : '2026-09-09T16:00:00+05:30', confirmed: true,
  lines: award.lines.map(line => ({ itemKey: line.itemKey, unit: line.unit,
    quantity: index === 0 ? quantity(milli(line.quantity) / BigInt(2)) : line.quantity })),
  evidence: `Synthetic confirmation for ${award.id}; remaining quantity only.`,
}));

// One cumulative observation per award. Never feed split receipt events as separate awards.
export const demoSupplierObservations: SupplierObservation[] = demoAwards.map(award => {
  const receipts = demoReceiving.filter(receipt => receipt.awardId === award.id);
  const latest = receipts.at(-1);
  return { awardId: award.id, requestId: award.requestId, supplierId: award.supplierId,
    supplierName: demoSuppliers.find(s => s.id === award.supplierId)!.name,
    promisedDate: award.promisedDate, checkedAt: latest?.checkedAt ?? null,
    actualDeliveryDate: latest?.closesDelivery ? latest.deliveredAt.slice(0, 10) : null,
    complete: latest?.closesDelivery ?? false, issueCodes: [...new Set(receipts.flatMap(r => r.issueCodes))],
    invoiceDifferencePaise: latest ? difference(sum(receipts.map(r => r.billedPaise)), award.totalPaise) : '0',
    creditClaimedPaise: sum(receipts.map(r => r.creditClaimedPaise)),
    creditReceivedPaise: sum(receipts.map(r => r.creditReceivedPaise)),
    lines: award.lines.map(line => {
      const checked = receipts.flatMap(r => r.lines.filter(item => item.itemKey === line.itemKey));
      const totalQty = (field: 'receivedQuantity' | 'rejectedQuantity' | 'billedQuantity') => quantity(checked.reduce((total, item) => total + milli(item[field]), BigInt(0)));
      return { itemKey: line.itemKey, itemName: ingredient(line.itemKey).name, unit: line.unit,
        orderedQuantity: line.quantity, receivedQuantity: totalQty('receivedQuantity'), rejectedQuantity: totalQty('rejectedQuantity'),
        billedQuantity: latest ? totalQty('billedQuantity') : null,
        billedUnitRatePaise: latest ? line.unitRatePaise : null, gstBasisPoints: 0, taxInclusive: false };
    }) };
});
export const demoSupplierPerformance = buildSupplierPerformance(demoSupplierObservations);

export const demoServicePlanInput: PlanInput = {
  name: 'Wednesday dinner · 110 expected covers', serviceAt: demoRestaurantProfile.serviceAt,
  dishes: demoDishes.map(dish => ({ dishId: dish.id, batchServings: dish.batchServings, portions: dish.plannedPortions })),
  inventory: demoIngredients.map(item => ({ itemKey: item.id, unit: item.unit, stock: item.usableStock,
    yieldPercent: item.yieldPercent,
    incoming: demoUpcomingDeliveries.flatMap(delivery => delivery.lines.filter(line => line.itemKey === item.id).map(line => ({
      // Planning expects usable incoming, so apply prep yield to the purchased quantity.
      quantity: quantity(milli(line.quantity) * BigInt(item.yieldPercent) / BigInt(100)),
      arrivesAt: delivery.arrivesAt, confirmed: true as const, evidence: `${delivery.evidence} Usable quantity after ${item.yieldPercent}% prep yield.`,
    }))),
  })),
};
export const demoServicePlan = computePlan(demoMenu, demoServicePlanInput);

export const demoFinance = {
  currency: 'INR',
  awardedPaise: sum(demoAwards.map(award => award.totalPaise)),
  billedPaise: sum(demoReceiving.map(receipt => receipt.billedPaise)),
  acceptedValuePaise: sum(demoReceiving.map(receipt => receipt.acceptedValuePaise)),
  creditClaimedPaise: sum(demoReceiving.map(receipt => receipt.creditClaimedPaise)),
  creditReceivedPaise: sum(demoReceiving.map(receipt => receipt.creditReceivedPaise)),
  creditOutstandingPaise: sum(demoReceiving.map(receipt => receipt.creditOutstandingPaise)),
  netBilledAfterReceivedCreditPaise: difference(sum(demoReceiving.map(r => r.billedPaise)), sum(demoReceiving.map(r => r.creditReceivedPaise))),
  note: 'Line invoice difference compares billed gross with physically received quantity at agreed rate. Performance invoice difference compares cumulative invoices with the whole award, so a partial invoice can be negative. Quality credits equal billed rejected stock. Net billed is not a payment balance: payments are not modelled. Performance cost per accepted unit uses gross invoices before credits.',
};
export const demoDashboard = {
  requestCount: demoPurchases.length,
  activeRequestCount: demoPurchases.filter(r => r.status !== 'RECEIVED').length,
  requestsAwaitingQuotes: demoPurchases.filter(r => r.status === 'SENT').length,
  requestsReadyToCompare: demoPurchases.filter(r => r.status === 'COMPARING').length,
  upcomingDeliveryCount: demoUpcomingDeliveries.length,
  ingredientShortageCount: demoServicePlan.ingredients.filter(item => item.usableDeficit !== '0').length,
  plannedDishPortions: demoDishes.reduce((total, dish) => total + Number(dish.plannedPortions), 0),
  expectedCovers: 110,
};

export const demoRestaurant = {
  profile: demoRestaurantProfile, suppliers: demoSuppliers, ingredients: demoIngredients,
  dishes: demoDishes, menu: demoMenu, purchases: demoPurchases, quotes: demoQuotes, awards: demoAwards,
  receiving: demoReceiving, upcomingDeliveries: demoUpcomingDeliveries,
  supplierObservations: demoSupplierObservations, supplierPerformance: demoSupplierPerformance,
  servicePlanInput: demoServicePlanInput, servicePlan: demoServicePlan,
  finance: demoFinance, dashboard: demoDashboard,
  inventoryNote: 'Usable stock is a synthetic physical count at the snapshot, after prior service consumption. It is not inferred by summing historical receipts. Recipes plan 290 dish portions across 110 covers.',
};
export type DemoRestaurant = typeof demoRestaurant;
export type DemoServicePlan = typeof demoServicePlan;
export type DemoFinance = typeof demoFinance;
export type DemoDashboard = typeof demoDashboard;

/** Seed adapter guidance: these are source records, not Prisma create inputs.
 * The database has ONE Award per request; demoAwards are supplier allocations.
 * Preserve supplier-level receiving checks within that single Award document.
 * REJECTED units keep delivery incomplete even after a credit is settled.
 * Rebase every timestamp consistently if the parent needs dates relative to login.
 * Tenant/user IDs, credentials and invitation tokens belong to the seed workflow.
 */
export const demoSeedMapping = {
  requestStatus: {
    DRAFT: 'DRAFT', SENT: 'OPEN', COMPARING: 'OPEN', AWARDED: 'AWARDED',
    PARTIALLY_RECEIVED: 'AWARDED', RECEIVED: 'AWARDED',
  },
  supplierLifecycle: {
    ACTIVE: { relationshipType: 'CURRENT', verificationStatus: 'UNVERIFIED', isActive: true },
    INVITED: { relationshipType: 'SELECTED_NEW', verificationStatus: 'UNVERIFIED', isActive: true },
    PAUSED: { relationshipType: 'CURRENT', verificationStatus: 'UNVERIFIED', isActive: false },
  },
  awardGroups: demoPurchases.filter(request => request.awardIds.length > 0).map(request => ({
    id: id('db-award', request.reference), requestId: request.id,
    supplierAllocationIds: request.awardIds,
    totalPaise: sum(demoAwards.filter(award => award.requestId === request.id).map(award => award.totalPaise)),
  })),
} as const;
export type DemoSeedMapping = typeof demoSeedMapping;
