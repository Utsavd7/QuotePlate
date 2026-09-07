import { computePlan, validatePlanInput } from '@/lib/service-planning/planning';
const ingredient = {
  id: 'i',
  itemKey: 'rice',
  name: 'Rice',
  quantity: '1',
  unit: 'KILOGRAM',
  specification: {
    v: 1,
    category: 'OTHER'
  }
};
export const menu = {
  v: 1,
  source: {
    kind: 'MANUAL',
    canonicalUrl: null,
    permissionConfirmed: false
  },
  dishes: ['a', 'b'].map(id => ({
    id,
    name: id,
    position: 0,
    ingredients: [ingredient]
  }))
};
export const input = {
  name: 'Lunch',
  serviceAt: '2026-09-10T07:00:00Z',
  dishes: ['a', 'b'].map(dishId => ({
    dishId,
    batchServings: '10',
    portions: '5'
  })),
  inventory: [{
    itemKey: 'rice',
    unit: 'KILOGRAM',
    yieldPercent: '100',
    stock: '0.6',
    incoming: []
  }]
};
it('aggregates shared ingredients and allocates stock once', () => {
  const result = computePlan(menu as never, validatePlanInput(input));
  expect(result.ingredients[0]).toMatchObject({
    required: '1',
    deficit: '0.4',
    available: '0.6'
  });
  expect(result.dishes.map(d => d.ready)).toEqual([true, false]);
});
it('uses explicit batch servings and yield; ignores late incoming', () => {
  const result = computePlan(menu as never, validatePlanInput({
    ...input,
    inventory: [{
      ...input.inventory[0],
      yieldPercent: '50',
      incoming: [{
        quantity: '9',
        arrivesAt: '2026-09-11T00:00:00Z',
        evidence: 'Vendor confirmed by phone',
        confirmed: true
      }]
    }]
  }));
  expect(result.ingredients[0].deficit).toBe('0.8');
});
it('rounds total rational demand upward only after aggregation', () => {
  const result = computePlan(menu as never, validatePlanInput({
    ...input,
    dishes: input.dishes.map(d => ({
      ...d,
      batchServings: '3',
      portions: '1'
    })),
    inventory: []
  }));
  expect(result.ingredients[0].required).toBe('0.667');
});
it('flags incompatible inventory units without crediting stock', () => {
  const result = computePlan(menu as never, validatePlanInput({
    ...input,
    inventory: [{
      ...input.inventory[0],
      unit: 'PACK',
      stock: '100'
    }]
  }));
  expect(result.ingredients[0].deficit).toBe('1');
  expect(result.warnings.join(' ')).toMatch(/unit/i);
});
it('requires explicit batch servings and disallows duplicate stock keys and unconfirmed arrivals', () => {
  expect(() => validatePlanInput({
    ...input,
    dishes: [{
      dishId: 'a',
      portions: '5'
    }]
  })).toThrow();
  expect(() => validatePlanInput({
    ...input,
    inventory: [input.inventory[0], input.inventory[0]]
  })).toThrow();
  expect(() => validatePlanInput({
    ...input,
    inventory: [{
      ...input.inventory[0],
      incoming: [{
        quantity: '5',
        confirmed: false
      }]
    }]
  })).toThrow();
});
it('does not combine different specifications for the same ingredient key', () => {
  const changed = JSON.parse(JSON.stringify(menu));
  changed.dishes[1].ingredients[0].specification = {
    v: 1,
    category: 'OTHER',
    notes: 'different grade'
  };
  const result = computePlan(changed, validatePlanInput(input));
  expect(result.ingredients).toHaveLength(2);
  expect(result.ingredients.every(i => i.blocked)).toBe(true);
  expect(result.ready).toBe(false);
});
it('subtracts usable stock before adjusting the purchase shortage for yield', () => {
  const result = computePlan(menu as never, validatePlanInput({
    ...input,
    dishes: [{
      dishId: 'a',
      batchServings: '1',
      portions: '10'
    }],
    inventory: [{
      ...input.inventory[0],
      stock: '4',
      yieldPercent: '80'
    }]
  }));
  expect(result.ingredients[0]).toMatchObject({
    required: '10',
    available: '4',
    usableDeficit: '6',
    deficit: '7.5'
  });
});
it('blocks unknown inventory and incomplete recipes; skips zero portions', () => {
  const unknown = computePlan(menu as never, validatePlanInput({
    ...input,
    inventory: []
  }));
  expect(unknown.ready).toBe(false);
  expect(unknown.ingredients.every(i => i.blocked)).toBe(true);
  const empty = JSON.parse(JSON.stringify(menu));
  empty.dishes[0].ingredients = [];
  expect(computePlan(empty, validatePlanInput(input)).ready).toBe(false);
  const zero = computePlan(menu as never, validatePlanInput({
    ...input,
    dishes: input.dishes.map(d => ({
      ...d,
      portions: '0'
    }))
  }));
  expect(zero.ingredients).toEqual([]);
});
it('rejects requirements outside supported quantity precision', () => {
  expect(() => computePlan(menu as never, validatePlanInput({
    ...input,
    dishes: [{
      dishId: 'a',
      batchServings: '0.001',
      portions: '999999999999'
    }],
    inventory: [{
      ...input.inventory[0],
      yieldPercent: '0.001'
    }]
  }))).toThrow(/quantity|precision|range/i);
});
it('keeps sub-milligram normalized stock exact until calculating the final shortage', () => {
  const tiny = JSON.parse(JSON.stringify(menu));
  tiny.dishes[0].ingredients[0].quantity = '0.5';
  tiny.dishes[0].ingredients[0].unit = 'GRAM';
  const result = computePlan(tiny, validatePlanInput({
    ...input,
    dishes: [{
      dishId: 'a',
      batchServings: '1',
      portions: '1'
    }],
    inventory: [{
      ...input.inventory[0],
      unit: 'GRAM',
      stock: '0.5'
    }]
  }));
  expect(result.ingredients[0].deficit).toBe('0');
  expect(result.ready).toBe(true);
  expect(result.ingredients[0].available).toBe('0.0005');
});
it('returns validation errors for malformed nested fields', () => {
  expect(() => validatePlanInput({
    ...input,
    inventory: [null]
  })).toThrow(/plan|inventory|field/i);
});
it('allows omitted dishes to have no batch assumption', () => {
  expect(() => validatePlanInput({ ...input, dishes: [{ dishId: 'a', portions: '0', batchServings: '' }] })).not.toThrow();
});
