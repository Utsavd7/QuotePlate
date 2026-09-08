// Next's page params can retain URL escaping during client navigation. Normalize
// before the client builds an API URL, so IDs containing ':' are encoded once.
export function pageRecordId(value: string): string {
  try { return decodeURIComponent(value); }
  catch { return value; }
}
