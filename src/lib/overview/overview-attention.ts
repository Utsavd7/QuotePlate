import { Prisma } from '@prisma/client';

export const ATTENTION_LIMIT = 8;
export type AttentionItem = {
  requestId: string;
  title: string;
  kind: 'delivery' | 'compare' | 'expired' | 'draft';
  replies: number;
  pendingDeliveries: number;
  creditRemainingPaise: string;
  dueAt: string;
};
export type OverviewAttention = { items: AttentionItem[]; hasMore: boolean };

type WorkRow = Omit<AttentionItem, 'dueAt'> & { dueAt: Date };

/** One bounded, tenant-scoped queue. Historical issue labels alone are not new work. */
export async function loadOverviewAttention(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  now: Date,
): Promise<OverviewAttention> {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const rows = await transaction.$queryRaw<WorkRow[]>(Prisma.sql`
    WITH work AS (
      SELECT request."id" AS "requestId", request."title",
        CASE WHEN request."status" = 'DRAFT' THEN 'draft'
          WHEN replies.count > 0 THEN 'compare' ELSE 'expired' END AS "kind",
        replies.count AS "replies", 0::integer AS "pendingDeliveries",
        '0'::text AS "creditRemainingPaise", request."quoteDeadline" AS "dueAt",
        CASE WHEN request."status" = 'DRAFT' THEN 3 ELSE 1 END AS priority
      FROM "ProcurementRequest" request
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::integer AS count FROM "SupplierRequest" response
        WHERE response."tenantId" = ${tenantId}
          AND response."requestId" = request."id" AND response."quoteRevision" > 0
      ) replies ON TRUE
      WHERE request."tenantId" = ${tenantId} AND (
        request."status" = 'DRAFT' OR
        (request."status" = 'OPEN' AND (replies.count > 0 OR request."quoteDeadline" <= ${now}))
      )
      UNION ALL
      SELECT request."id", request."title", 'delivery', 0::integer,
        delivery.pending, delivery.credit::text, request."deliveryDate", 0
      FROM "Award" award
      JOIN "ProcurementRequest" request ON request."id" = award."requestId"
        AND request."tenantId" = ${tenantId} AND request."status" = 'AWARDED'
      CROSS JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE
          (check_row.entry IS NULL AND supplier->>'deliveryDate' <= ${today})
          OR (check_row.entry IS NOT NULL AND check_row.entry->'details' IS NULL
            AND check_row.entry->'issueCodes' ?| ARRAY['MISSING_QUANTITY', 'WRONG_ITEM', 'QUALITY'])
          OR ((check_row.entry->>'invoiceTotalPaise')::numeric >
            COALESCE((supplier->>'freightPaise')::numeric, 0) +
            (SELECT COALESCE(SUM((line->>'totalPaise')::numeric), 0)
              FROM jsonb_array_elements(award."allocationLines"->'lines') line
              WHERE line->>'supplierId' = supplier->>'supplierId') +
            COALESCE((check_row.entry->'details'->>'creditReceivedPaise')::numeric, 0))
          OR (check_row.entry->'details' IS NOT NULL AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(award."allocationLines"->'lines') line
            LEFT JOIN LATERAL (
              SELECT item FROM jsonb_array_elements(check_row.entry->'details'->'items') item
              WHERE item->>'requestItemId' = line->>'requestItemId'
            ) received ON TRUE
            WHERE line->>'supplierId' = supplier->>'supplierId'
              AND (line->>'quantity')::numeric >
                COALESCE((received.item->>'receivedQuantity')::numeric -
                  (received.item->>'rejectedQuantity')::numeric, 0)
          ))
        )::integer AS pending,
        COALESCE(SUM(GREATEST(
          COALESCE((check_row.entry->'details'->>'creditClaimedPaise')::numeric, 0) -
          COALESCE((check_row.entry->'details'->>'creditReceivedPaise')::numeric, 0), 0
        )), 0) AS credit
        FROM jsonb_array_elements(award."supplierSnapshots"->'suppliers') supplier
        LEFT JOIN LATERAL (
          SELECT entry FROM jsonb_array_elements(
            COALESCE(award."receiving"->'suppliers', '[]'::jsonb)
          ) entry WHERE entry->>'supplierId' = supplier->>'supplierId'
        ) check_row ON TRUE
      ) delivery
      WHERE award."tenantId" = ${tenantId} AND (delivery.pending > 0 OR delivery.credit > 0)
    )
    SELECT "requestId", "title", "kind", "replies", "pendingDeliveries", "creditRemainingPaise", "dueAt"
    FROM work ORDER BY priority, "dueAt", "requestId" LIMIT ${ATTENTION_LIMIT + 1}
  `);
  return {
    items: rows.slice(0, ATTENTION_LIMIT).map(row => ({ ...row, dueAt: row.dueAt.toISOString() })),
    hasMore: rows.length > ATTENTION_LIMIT,
  };
}
