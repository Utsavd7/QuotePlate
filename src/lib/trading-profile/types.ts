import type { ProcurementCategory } from '@/lib/domain/procurement-categories';

export type SupplierBusinessDetails = {
  contactName: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  categories: ProcurementCategory[];
};

export type TradingProfileInput = {
  businessDetails?: SupplierBusinessDetails;
  wholesale: 'yes' | 'no' | 'unknown';
  servedPins: string[];
  minimumOrderInr: string | null;
  orderCutoffIst: string | null;
  leadTimeDays: number | null;
  note: string | null;
};
export type TradingProfile = TradingProfileInput & { revision: number; updatedAt: string; businessDetailsConfirmedAt?: string };
export type TradingProfileSubmission = { action: 'trading-profile'; portalId: string; expectedRevision: number; profile: TradingProfileInput };
/** Legacy business declarations used updatedAt before a separate confirmation date existed. */
export function businessDetailsConfirmationDate(profile: TradingProfile): string | null {
  return profile.businessDetails ? profile.businessDetailsConfirmedAt ?? profile.updatedAt : null;
}
export function tradingProfileIsStale(profile: TradingProfile, now = new Date()): boolean {
  return now.getTime() - Date.parse(businessDetailsConfirmationDate(profile) ?? profile.updatedAt) >= 30 * 86400000;
}
