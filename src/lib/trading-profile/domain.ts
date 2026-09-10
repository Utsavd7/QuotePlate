import { bounded, exact, PortalError, text } from '@/lib/supplier-portal/domain';
import { SupplierValidationError, validateSupplierUpdateInput } from '@/lib/suppliers/supplier-schema';
import { normalizeSupplierContactEmail } from '@/lib/suppliers/contact-email';
import type { SupplierBusinessDetails, TradingProfile, TradingProfileInput, TradingProfileSubmission } from './types';
export { businessDetailsConfirmationDate, tradingProfileIsStale } from './types';

const PROFILE_FIELDS = ['wholesale', 'servedPins', 'minimumOrderInr', 'orderCutoffIst', 'leadTimeDays', 'note'];
function profileFields(value: unknown): string[] {
  return value !== null && typeof value === 'object' && Object.hasOwn(value, 'businessDetails')
    ? [...PROFILE_FIELDS, 'businessDetails'] : PROFILE_FIELDS;
}
function parseBusinessDetails(value: unknown): SupplierBusinessDetails {
  const b = exact(value, ['contactName', 'phone', 'whatsappNumber', 'email', 'categories']);
  if (!Array.isArray(b.categories) || b.categories.length === 0) throw new PortalError('Choose at least one supported category.');
  try {
    const supplier = validateSupplierUpdateInput({
      contactName: b.contactName, phone: b.phone, whatsappNumber: b.whatsappNumber, email: b.email,
      capabilities: {
        v: 1,
        categories: b.categories.map((category, index) => ({ category, tier: 'CAPABLE', rank: index + 1 })),
        items: [],
      },
    });
    const email = normalizeSupplierContactEmail(b.email);
    if (supplier.email && !email) throw new PortalError('Use a single valid email address.');
    if (!supplier.phone && !supplier.whatsappNumber && !email) throw new PortalError('Provide a phone, WhatsApp number, or email address.');
    return {
      contactName: supplier.contactName ?? null, phone: supplier.phone ?? null,
      whatsappNumber: supplier.whatsappNumber ?? null, email,
      categories: supplier.capabilities!.categories.map(({ category }) => category),
    };
  } catch (error) {
    if (error instanceof SupplierValidationError) throw new PortalError(Object.values(error.errors).flat().join(' '));
    throw error;
  }
}
export function parseTradingProfile(value: unknown): TradingProfileInput {
  bounded(value, 8192);
  const b = exact(value, profileFields(value));
  if (b.wholesale !== 'yes' && b.wholesale !== 'no' && b.wholesale !== 'unknown') throw new PortalError('Choose yes, no or unknown for wholesale supply.');
  if (!Array.isArray(b.servedPins) || b.servedPins.length > 100 || b.servedPins.some(p => typeof p !== 'string' || !/^[1-9][0-9]{5}$/.test(p)) || new Set(b.servedPins).size !== b.servedPins.length) throw new PortalError('Provide up to 100 distinct six-digit Indian PINs.');
  if (b.minimumOrderInr !== null && (typeof b.minimumOrderInr !== 'string' || !/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?$/.test(b.minimumOrderInr))) throw new PortalError('Minimum order must be INR 0–999999999.99, with up to two decimal places, or unknown.');
  if (b.orderCutoffIst !== null && (typeof b.orderCutoffIst !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(b.orderCutoffIst))) throw new PortalError('Use HH:mm for the order cutoff in IST, or leave it unknown.');
  if (b.leadTimeDays !== null && (!Number.isInteger(b.leadTimeDays) || Number(b.leadTimeDays) < 0 || Number(b.leadTimeDays) > 365)) throw new PortalError('Lead time must be 0–365 whole days, or unknown.');
  return { wholesale: b.wholesale, servedPins: b.servedPins as string[], minimumOrderInr: b.minimumOrderInr as string | null, orderCutoffIst: b.orderCutoffIst as string | null, leadTimeDays: b.leadTimeDays as number | null, note: b.note === null ? null : text(b.note, 500, true) || null,
    ...(Object.hasOwn(b, 'businessDetails') ? { businessDetails: parseBusinessDetails(b.businessDetails) } : {}),
  };
}
function canonicalTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function readTradingProfile(value: unknown): TradingProfile | null {
  if (value === null || value === undefined) return null;
  try {
    bounded(value, 8192);
    const hasConfirmationDate = typeof value === 'object' && Object.hasOwn(value, 'businessDetailsConfirmedAt');
    const b = exact(value, [...profileFields(value), 'revision', 'updatedAt', ...(hasConfirmationDate ? ['businessDetailsConfirmedAt'] : [])]);
    const { revision, updatedAt, businessDetailsConfirmedAt, ...input } = b;
    if (!Number.isSafeInteger(revision) || Number(revision) < 1 || Number(revision) > 2147483647 || !canonicalTimestamp(updatedAt)) throw new Error();
    if (hasConfirmationDate && (!Object.hasOwn(input, 'businessDetails') || !canonicalTimestamp(businessDetailsConfirmedAt) || Date.parse(businessDetailsConfirmedAt) > Date.parse(updatedAt))) throw new Error();
    return { ...parseTradingProfile(input), revision: Number(revision), updatedAt,
      ...(hasConfirmationDate ? { businessDetailsConfirmedAt: businessDetailsConfirmedAt as string } : {}),
    };
  } catch { throw new PortalError('Stored trading profile is invalid.', 503); }
}
export function parseTradingProfileSubmission(value: unknown): TradingProfileSubmission {
  bounded(value, 16384);
  const b = exact(value, ['action', 'portalId', 'expectedRevision', 'profile']);
  if (b.action !== 'trading-profile' || !Number.isSafeInteger(b.expectedRevision) || Number(b.expectedRevision) < 0 || Number(b.expectedRevision) >= 2147483647) throw new PortalError('Provide the current trading profile revision.');
  return { action: 'trading-profile', portalId: text(b.portalId), expectedRevision: Number(b.expectedRevision), profile: parseTradingProfile(b.profile) };
}
