export type TradingProfileInput = {
  wholesale: 'yes' | 'no' | 'unknown';
  servedPins: string[];
  minimumOrderInr: string | null;
  orderCutoffIst: string | null;
  leadTimeDays: number | null;
  note: string | null;
};
export type TradingProfile = TradingProfileInput & { revision: number; updatedAt: string };
export type TradingProfileSubmission = { action: 'trading-profile'; portalId: string; expectedRevision: number; profile: TradingProfileInput };
export function tradingProfileIsStale(profile: TradingProfile, now = new Date()): boolean {
  return now.getTime() - Date.parse(profile.updatedAt) >= 30 * 86400000;
}
