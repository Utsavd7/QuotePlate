import { bounded, exact, PortalError, text } from '@/lib/supplier-portal/domain';
import type { TradingProfile, TradingProfileInput, TradingProfileSubmission } from './types';
export { tradingProfileIsStale } from './types';
export function parseTradingProfile(value: unknown): TradingProfileInput {
  bounded(value, 8192);
  const b = exact(value, ['wholesale', 'servedPins', 'minimumOrderInr', 'orderCutoffIst', 'leadTimeDays', 'note']);
  if (b.wholesale !== 'yes' && b.wholesale !== 'no' && b.wholesale !== 'unknown') throw new PortalError('Choose yes, no or unknown for wholesale supply.');
  if (!Array.isArray(b.servedPins) || b.servedPins.length > 100 || b.servedPins.some(p => typeof p !== 'string' || !/^[1-9][0-9]{5}$/.test(p)) || new Set(b.servedPins).size !== b.servedPins.length) throw new PortalError('Provide up to 100 distinct six-digit Indian PINs.');
  if (b.minimumOrderInr !== null && (typeof b.minimumOrderInr !== 'string' || !/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?$/.test(b.minimumOrderInr))) throw new PortalError('Minimum order must be INR 0–999999999.99, with up to two decimal places, or unknown.');
  if (b.orderCutoffIst !== null && (typeof b.orderCutoffIst !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(b.orderCutoffIst))) throw new PortalError('Use HH:mm for the order cutoff in IST, or leave it unknown.');
  if (b.leadTimeDays !== null && (!Number.isInteger(b.leadTimeDays) || Number(b.leadTimeDays) < 0 || Number(b.leadTimeDays) > 365)) throw new PortalError('Lead time must be 0–365 whole days, or unknown.');
  return { wholesale: b.wholesale, servedPins: b.servedPins as string[], minimumOrderInr: b.minimumOrderInr as string | null, orderCutoffIst: b.orderCutoffIst as string | null, leadTimeDays: b.leadTimeDays as number | null, note: b.note === null ? null : text(b.note, 500, true) || null };
}
export function readTradingProfile(value: unknown): TradingProfile | null {
  if (value === null || value === undefined) return null;
  try {
    bounded(value, 8192);
    const b = exact(value, ['wholesale', 'servedPins', 'minimumOrderInr', 'orderCutoffIst', 'leadTimeDays', 'note', 'revision', 'updatedAt']);
    const { revision, updatedAt, ...input } = b;
    if (!Number.isSafeInteger(revision) || Number(revision) < 1 || Number(revision) > 2147483647 || typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt)) || new Date(updatedAt).toISOString() !== updatedAt) throw new Error();
    return { ...parseTradingProfile(input), revision: Number(revision), updatedAt };
  } catch { throw new PortalError('Stored trading profile is invalid.', 503); }
}
export function parseTradingProfileSubmission(value: unknown): TradingProfileSubmission {
  bounded(value, 16384);
  const b = exact(value, ['action', 'portalId', 'expectedRevision', 'profile']);
  if (b.action !== 'trading-profile' || !Number.isSafeInteger(b.expectedRevision) || Number(b.expectedRevision) < 0 || Number(b.expectedRevision) >= 2147483647) throw new PortalError('Provide the current trading profile revision.');
  return { action: 'trading-profile', portalId: text(b.portalId), expectedRevision: Number(b.expectedRevision), profile: parseTradingProfile(b.profile) };
}
