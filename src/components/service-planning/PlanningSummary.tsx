import type { computePlan } from '@/lib/service-planning/planning';
export function PlanningSummary({
  readiness
}: {
  readiness: ReturnType<typeof computePlan>;
}) {
  return <section aria-label="Service readiness">
    <h2>{readiness.ready ? 'Ready for service' : 'Needs attention'}</h2>

    <p>{readiness.allocationPolicy}</p>

    {readiness.warnings.map((w, i) => <p role="status" key={i}>{w}</p>)}

    <div role="region" aria-label="Shared ingredient requirements" tabIndex={0} style={{
      overflowX: 'auto'
    }}>
      <table>
        <caption>Shared ingredient requirements</caption>

        <thead>
          <tr>
            <th>Ingredient</th>

            <th>Required usable</th>

            <th>Usable by service</th>

            <th>Usable shortage</th>

            <th>Purchase required</th>

            <th>Evidence</th>
          </tr>
        </thead>

        <tbody>
          {readiness.ingredients.map((i, n) => <tr key={n}>
            <th>
              {i.name}

              {i.blocked ? ' — review required' : ''}

              <small>{i.unit}</small>
            </th>

            <td>
              {i.required}
            </td>

            <td>
              {i.available}
            </td>

            <td>
              {i.usableDeficit}
            </td>

            <td>
              {i.blocked ? 'Review required' : i.deficit}
            </td>

            <td>
              {i.evidence.map((e, j) => <p key={j}>{e}</p>)}
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>

    <h3>Dish readiness</h3>

    {readiness.dishes.map(d => <details key={d.dishId}>
      <summary>{d.name} · {d.portions} portions · {d.ready ? 'Ready' : 'Needs attention'}</summary>

      {d.evidence.map((e, i) => <p key={i}>{e}</p>)}
    </details>)}
  </section>;
}
