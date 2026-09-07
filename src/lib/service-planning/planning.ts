import { MAX_DECIMAL_18_3_SCALED } from '@/lib/domain/validation';
import { normalizeUnit, type ProcurementUnit } from '@/lib/domain/quantity';
import type { MenuDocumentV1 } from '@/lib/menu/menu-document';
export class PlanningError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}
export type PlanInput = {
  name: string;
  serviceAt: string;
  dishes: {
    dishId: string;
    batchServings: string;
    portions: string;
  }[];
  inventory: {
    itemKey: string;
    unit: string;
    yieldPercent: string;
    stock: string;
    incoming: {
      quantity: string;
      arrivesAt: string;
      confirmed: true;
      evidence: string;
    }[];
  }[];
};
const fail = (message: string): never => {
  throw new PlanningError(message);
};
function decimal(value: unknown, zero = false): bigint {
  if (typeof value !== 'string' || !/^\d{1,12}(\.\d{1,3})?$/.test(value)) return fail('Use decimal text with at most three decimal places.');
  const [a, b = ''] = value.split('.');
  const n = BigInt(a) * BigInt(1000) + BigInt(b.padEnd(3, '0'));
  if (!zero && n === BigInt(0)) fail('Quantity must be positive.');
  return n;
}
const text = (v: unknown): string => typeof v === 'string' && v.trim().length > 0 && v.length <= 200 ? v.trim() : fail('A bounded text field is required.');
function date(v: unknown) {
  const s = text(v);
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(s) || !Number.isFinite(Date.parse(s))) fail('Provide a timestamp including timezone.');
  return new Date(s).toISOString();
}
export function validatePlanInput(value: unknown): PlanInput {
  try {
    return parsePlanInput(value);
  } catch (error) {
    if (error instanceof PlanningError) throw error;
    throw new PlanningError('Invalid plan field: check inventory, recipe servings and units.');
  }
}
function parsePlanInput(value: unknown): PlanInput {
  if (!value || typeof value !== 'object') return fail('Provide a plan.');
  const v = value as PlanInput;
  if (!Array.isArray(v.dishes) || !v.dishes.length || v.dishes.length > 100 || !Array.isArray(v.inventory) || v.inventory.length > 500) fail('Select 1–100 dishes and at most 500 inventory entries.');
  const dishes = v.dishes.map(d => {
    const dishId = text(d.dishId);
    const portions = decimal(d.portions, true);
    if (portions > BigInt(0)) decimal(d.batchServings);
    else if (d.batchServings !== undefined && d.batchServings !== '') decimal(d.batchServings);
    return {
      dishId,
      batchServings: d.batchServings ?? '',
      portions: d.portions
    };
  });
  const inventory = v.inventory.map(i => {
    const itemKey = text(i.itemKey);
    const unit = normalizeUnit(text(i.unit));
    const y = decimal(i.yieldPercent);
    if (y > BigInt(100000)) fail('Yield must be above 0 and at most 100%.');
    decimal(i.stock, true);
    if (!Array.isArray(i.incoming) || i.incoming.length > 50) fail('Too many incoming entries.');
    return {
      itemKey,
      unit,
      yieldPercent: i.yieldPercent,
      stock: i.stock,
      incoming: i.incoming.map(n => {
        decimal(n.quantity);
        if (n.confirmed !== true) fail('Incoming stock must be explicitly confirmed.');
        return {
          quantity: n.quantity,
          arrivesAt: date(n.arrivesAt),
          confirmed: true as const,
          evidence: text(n.evidence)
        };
      })
    };
  });
  if (new Set(dishes.map(d => d.dishId)).size !== dishes.length || new Set(inventory.map(i => i.itemKey)).size !== inventory.length) fail('Duplicate dish or inventory key.');
  return {
    name: text(v.name),
    serviceAt: date(v.serviceAt),
    dishes,
    inventory
  };
}
const fmt = (n: bigint) => {
  if (n < BigInt(0) || n > MAX_DECIMAL_18_3_SCALED) fail('Computed quantity exceeds supported precision range.');
  return `${n / BigInt(1000)}.${(n % BigInt(1000)).toString().padStart(3, '0')}`.replace(/\.?0+$/, '');
};
const ceil = (n: bigint, d: bigint) => (n + d - BigInt(1)) / d;
function unit(u: string): {
  unit: ProcurementUnit;
  factor: bigint;
  pack: boolean;
} {
  const v = normalizeUnit(u);
  return {
    unit: v === 'GRAM' ? 'KILOGRAM' : v === 'MILLILITRE' ? 'LITRE' : v,
    factor: v === 'GRAM' || v === 'MILLILITRE' ? BigInt(1000) : BigInt(1),
    pack: ['PACK', 'CASE', 'CRATE'].includes(v)
  };
}
const gcd = (a: bigint, b: bigint): bigint => b === BigInt(0) ? a : gcd(b, a % b);
type Fraction = {
  n: bigint;
  d: bigint;
};
function add(a: Fraction, b: Fraction): Fraction {
  const n = a.n * b.d + b.n * a.d,
    d = a.d * b.d,
    g = gcd(n, d);
  return {
    n: n / g,
    d: d / g
  };
}
function subtract(a: Fraction, b: Fraction): Fraction {
  return add(a, {
    n: -b.n,
    d: b.d
  });
}
function less(a: Fraction, b: Fraction) {
  return a.n * b.d < b.n * a.d;
}
function formatFraction(value: Fraction) {
  const micro = value.n * BigInt(1000) / value.d;
  if (micro < BigInt(0) || micro > MAX_DECIMAL_18_3_SCALED * BigInt(1000)) fail('Computed quantity exceeds supported precision range.');
  return `${micro / BigInt(1000000)}.${(micro % BigInt(1000000)).toString().padStart(6, '0')}`.replace(/\.?0+$/, '');
}
export function computePlan(menu: MenuDocumentV1, input: PlanInput) {
  const warnings: string[] = [];
  const signature = (item: MenuDocumentV1['dishes'][number]['ingredients'][number]) => JSON.stringify([unit(item.unit).unit, Object.fromEntries(Object.entries(item.specification).sort(([a], [b]) => a.localeCompare(b)))]);
  const variants = new Map<string, Set<string>>();
  for (const d of menu.dishes.filter(d => input.dishes.some(s => s.dishId === d.id && decimal(s.portions, true) > BigInt(0)))) for (const i of d.ingredients) {
    const set = variants.get(i.itemKey) ?? new Set<string>();
    set.add(signature(i));
    variants.set(i.itemKey, set);
  }
  const ambiguous = new Set([...variants].filter(([, s]) => s.size > 1).map(([k]) => k));
  for (const k of ambiguous) warnings.push(`${k}: different specifications or units; shown separately, stock is not assigned, procurement blocked. Resolve in the menu and create a new plan.`);
  const groups = new Map<string, {
    item: MenuDocumentV1['dishes'][number]['ingredients'][number];
    unit: ProcurementUnit;
    demand: Fraction;
    available: Fraction;
    allocated: Fraction;
    blocked: boolean;
    evidence: string[];
  }>();
  const dishes = input.dishes.map(selection => {
    const dish = menu.dishes.find(d => d.id === selection.dishId);
    if (!dish) return fail('Selected dish does not exist in the approved menu snapshot.');
    let ready = true;
    const evidence: string[] = [];
    if (decimal(selection.portions, true) === BigInt(0)) return {
      dishId: dish.id,
      name: dish.name,
      portions: selection.portions,
      ready: true,
      evidence: ['Zero portions: excluded from requirements.']
    };
    if (!dish.ingredients.length) {
      ready = false;
      warnings.push(`${dish.name}: recipe has no ingredients. Complete the approved recipe before planning service.`);
      evidence.push('Incomplete recipe: no ingredient quantities.');
    }
    for (const item of dish.ingredients) {
      const u = unit(item.unit),
        inv = input.inventory.find(i => i.itemKey === item.itemKey),
        key = item.itemKey + signature(item);
      let g = groups.get(key);
      if (!g) {
        let available = {
          n: BigInt(0),
          d: BigInt(1)
        };
        const ev: string[] = [];
        let blocked = u.pack || ambiguous.has(item.itemKey) || !inv;
        if (!inv) warnings.push(`${item.name}: usable stock and yield are unknown. Enter explicit values before procurement.`);
        if (inv && !ambiguous.has(item.itemKey)) {
          const iu = unit(inv.unit);
          if (iu.unit !== u.unit || iu.pack) {
            warnings.push(`${item.name}: incompatible stock unit; no stock credited.`);
            blocked = true;
          } else {
            available = {
              n: decimal(inv.stock, true),
              d: iu.factor
            };
            ev.push(`Current usable stock: ${inv.stock} ${inv.unit}.`);
            for (const arrival of inv.incoming) {
              if (Date.parse(arrival.arrivesAt) <= Date.parse(input.serviceAt)) {
                available = add(available, {
                  n: decimal(arrival.quantity),
                  d: iu.factor
                });
                ev.push(`Confirmed incoming ${arrival.quantity} ${inv.unit} at ${arrival.arrivesAt}: ${arrival.evidence}`);
              } else ev.push(`Excluded late incoming at ${arrival.arrivesAt}: ${arrival.evidence}`);
            }
          }
        }
        if (u.pack) warnings.push(`${item.name}: pack unit needs an explicit standard-unit recipe conversion before procurement.`);
        g = {
          item,
          unit: u.unit,
          demand: {
            n: BigInt(0),
            d: BigInt(1)
          },
          available,
          allocated: {
            n: BigInt(0),
            d: BigInt(1)
          },
          blocked,
          evidence: ev
        };
        groups.set(key, g);
      }
      if (g.unit !== u.unit || signature(g.item) !== signature(item)) {
        g.blocked = true;
        warnings.push(`${item.name}: shared ingredient has incompatible units or specifications.`);
      }
      const demand = {
        n: decimal(item.quantity) * decimal(selection.portions, true),
        d: decimal(selection.batchServings) * u.factor
      };
      g.demand = add(g.demand, demand);
      const remaining = subtract(g.available, g.allocated);
      const allocated = less(remaining, demand) ? remaining : demand;
      g.allocated = add(g.allocated, allocated);
      if (less(allocated, demand) || g.blocked) ready = false;
      evidence.push(`${item.name}: ${item.quantity} ${item.unit} per ${selection.batchServings} batch servings × ${selection.portions} portions usable demand; allocated ${formatFraction(allocated)} ${g.unit}.`);
    }
    return {
      dishId: dish.id,
      name: dish.name,
      portions: selection.portions,
      ready,
      evidence
    };
  });
  const ingredients = [...groups].map(([, g]) => {
    const required = ceil(g.demand.n, g.demand.d);
    const shortage = less(g.demand, g.available) ? {
      n: BigInt(0),
      d: BigInt(1)
    } : subtract(g.demand, g.available);
    const inv = input.inventory.find(i => i.itemKey === g.item.itemKey);
    const usableDeficit = ceil(shortage.n, shortage.d);
    const purchase = inv ? ceil(shortage.n * BigInt(100000), shortage.d * decimal(inv.yieldPercent)) : BigInt(0);
    return {
      itemKey: g.item.itemKey,
      name: g.item.name,
      unit: g.unit,
      specification: g.item.specification,
      required: fmt(required),
      available: formatFraction(g.available),
      usableDeficit: fmt(usableDeficit),
      deficit: inv ? fmt(purchase) : '0',
      yieldPercent: inv?.yieldPercent ?? null,
      blocked: g.blocked,
      evidence: [...g.evidence, inv ? `Purchase shortage = remaining usable shortage ÷ ${inv.yieldPercent}% yield, rounded up to 0.001 ${g.unit}.` : 'Purchase quantity unknown until usable stock and yield are entered.']
    };
  });
  return {
    ready: dishes.every(d => d.ready),
    dishes,
    ingredients,
    warnings,
    allocationPolicy: 'Usable stock is allocated once in selected dish order. Recipe quantities describe usable ingredient requirements per batch. Confirmed incoming counts only when due by service. Purchase quantity is the remaining usable shortage divided by yield, rounded upward to 0.001 standard units. Missing stock or yield blocks procurement.'
  };
}
