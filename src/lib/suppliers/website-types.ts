export type WebsiteContact = {
  kind: 'email' | 'phone';
  value: string;
  sourceUrl: string;
  checkedAt: string;
};

export type WebsiteContactResult = {
  status: 'found' | 'no-public-contacts' | 'unavailable';
  contacts: WebsiteContact[];
  checkedAt: string;
};

/** Apply only reviewed contacts to still-empty fields; all other draft data survives. */
export function fillReviewedWebsiteContacts<T extends { phone: string | null; email: string | null }>(
  draft: T,
  contacts: WebsiteContact[],
): T {
  const next = { ...draft };
  for (const contact of contacts) {
    if (!next[contact.kind]?.trim()) next[contact.kind] = contact.value;
  }
  return next;
}
