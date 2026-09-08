import {
  latestQuoteRevision,
  PublicQuoteStorageCorruptionError,
  type QuoteRequestItem,
  validateQuoteRevisionsDocument,
} from './quote-revisions';

export type PreviousQuotePrices = {
  submittedAt: string;
  items: Array<{
    requestItemId: string;
    unitRatePaise: string;
    gstBasisPoints: number;
    taxInclusive: boolean;
  }>;
};

/** Exact specification comparison, including reference images and optional fields. */
function specificationKey(item: QuoteRequestItem) {
  return JSON.stringify(Object.entries(item.specification).sort(([a], [b]) => a.localeCompare(b)));
}

export function matchingPreviousPrices(
  currentItems: QuoteRequestItem[],
  previousItems: QuoteRequestItem[],
  storedQuotes: unknown,
  storedRevision: number,
): PreviousQuotePrices | null {
  const document = validateQuoteRevisionsDocument(storedQuotes, previousItems);
  if (storedRevision !== document.revisions.length) throw new PublicQuoteStorageCorruptionError();
  const latest = latestQuoteRevision(document);
  if (!latest) return null;
  const items = currentItems.flatMap((current) => {
    const matches = previousItems.filter((previous) =>
      previous.itemKey === current.itemKey && previous.unit === current.unit &&
      specificationKey(previous) === specificationKey(current));
    if (matches.length !== 1) return [];
    const line = latest.items.find((item) => item.requestItemId === matches[0]!.id);
    // Qualified offers may price a different product even when the request matches.
    if (!line || line.noQuote || line.unitRatePaise === null || line.gstBasisPoints === null ||
      line.substitution || line.suppliedBrand || line.suppliedPackSize || line.suppliedQualityGrade) return [];
    return [{ requestItemId: current.id, unitRatePaise: line.unitRatePaise,
      gstBasisPoints: line.gstBasisPoints, taxInclusive: line.taxInclusive }];
  });
  return items.length ? { submittedAt: latest.submittedAt, items } : null;
}
