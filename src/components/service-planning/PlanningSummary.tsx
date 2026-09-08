import type { computePlan } from '@/lib/service-planning/planning';

export function PlanningSummary({
  readiness,
}: {
  readiness: ReturnType<typeof computePlan>;
}) {
  return <section aria-label="Service readiness">
    <h2>3. Review missing ingredients</h2>
    <h3>{readiness.ready ? 'Ready for service' : 'Needs attention'}</h3>
    {readiness.warnings.map((warning, index) => <p role="status" key={index}>{warning}</p>)}

    <div role="region" aria-label="Shared ingredient requirements" tabIndex={0} style={{ overflowX: 'auto' }}>
      <table>
        <caption>Ingredients to check before buying</caption>
        <thead>
          <tr>
            <th scope="col">Ingredient</th>
            <th scope="col">To buy</th>
            <th scope="col">Stock &amp; calculation</th>
          </tr>
        </thead>
        <tbody>
          {readiness.ingredients.map((ingredient, index) => <tr key={index}>
            <th scope="row">
              {ingredient.name}
              {ingredient.blocked ? ' — review required' : ''}
              <small>{ingredient.unit}</small>
            </th>
            <td>{ingredient.blocked ? 'Review required' : `${ingredient.deficit} ${ingredient.unit}`}</td>
            <td>
              <details open={ingredient.blocked}>
                <summary>Details · {ingredient.name}</summary>
                <p>Required usable: {ingredient.required} {ingredient.unit}</p>
                <p>Usable by service: {ingredient.available} {ingredient.unit}</p>
                <p>Usable shortage: {ingredient.usableDeficit} {ingredient.unit}</p>
                {ingredient.evidence.map((evidence, evidenceIndex) => <p key={evidenceIndex}>{evidence}</p>)}
              </details>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>

    <details>
      <summary>How quantities are calculated</summary>
      <p>{readiness.allocationPolicy}</p>
    </details>
    <details>
      <summary>Dish readiness</summary>
      {readiness.dishes.map(dish => <details key={dish.dishId}>
        <summary>{dish.name} · {dish.portions} portions · {dish.ready ? 'Ready' : 'Needs attention'}</summary>
        {dish.evidence.map((evidence, index) => <p key={index}>{evidence}</p>)}
      </details>)}
    </details>
  </section>;
}
