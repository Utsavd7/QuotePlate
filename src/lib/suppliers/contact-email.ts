const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TOP_LEVEL_DOMAIN = /^(?:[a-z]{2,63}|xn--[a-z0-9](?:[a-z0-9-]{0,57}[a-z0-9])?)$/i;

/** One bounded ASCII mailbox, without display names, URI prefixes or recipient lists. */
export function normalizeSupplierContactEmail(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 320) return null;
  const mailbox = value.trim();
  // Check ASCII before lowercasing: Unicode case folding can turn invalid input into ASCII.
  if (!mailbox || mailbox.length > 254 || /[^\u0020-\u007e]/.test(mailbox)) return null;
  const parts = mailbox.split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (local.length > 64 || !LOCAL_PART.test(local)) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label => !DOMAIN_LABEL.test(label)) || !TOP_LEVEL_DOMAIN.test(labels[labels.length - 1])) return null;
  return mailbox.toLowerCase();
}
