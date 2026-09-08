import type { TradingProfile } from '@/lib/trading-profile/types';
export type PortalItem = { itemId: string; name: string; quantity: string; unit: string; unitPricePaise?: string };
export type PortalDelivery = {
  fingerprint: string; checkedAt: string; status: string;
  invoiceTotalPaise?: string; expectedTotalPaise?: string; issueCodes?: string[]; actualDeliveryDate?: string | null; settlementNote?: string | null;
  lines: { itemId: string; name: string; ordered: string; received: string; rejected: string; accepted: string; outstanding: string; unit: string; billedQuantity?: string | null; billedUnitRatePaise?: string | null }[];
  credit: { claimedPaise: string; receivedPaise: string; outstandingPaise: string };
  notes: string;
};
export type PortalOrder = {
  requestId: string; title: string; deliveryDate: string;
  status: 'awaiting_quote' | 'pending' | 'selected' | 'closed';
  version: number; items: PortalItem[];
  acknowledgement: { status: 'confirmed' | 'needs_change'; note: string; at: string } | null;
  delivery: PortalDelivery | null;
  response: { decision: 'agree' | 'dispute'; note: string; evidenceReference: string; at: string; fingerprint: string } | null;
  responseIsCurrent: boolean;
};
export type PortalForecast = {
  id: string; planId: string; planVersion: number; serviceAt: string; sharedAt: string; stale: boolean;
  items: { itemKey: string; name: string; quantity: string; unit: string; specification: string }[];
};
export type SupplierPortalView = { tradingProfile?: TradingProfile | null; portalId: string; restaurantName: string; supplierName: string; expiresAt: string; orders: PortalOrder[]; forecasts: PortalForecast[] };
export type RestaurantPortalView = { tradingProfile?: TradingProfile | null; supplierName: string; access: { expiresAt: string; revokedAt: string | null } | null; orders: PortalOrder[]; forecasts: PortalForecast[]; canManage: boolean };
export type PortalAction =
 | { action: 'acknowledge'; requestId: string; expectedVersion: number; status: 'confirmed' | 'needs_change'; note: string }
 | { action: 'delivery-response'; requestId: string; expectedVersion: number; fingerprint: string; decision: 'agree' | 'dispute'; note: string; evidenceReference: string };
// Request-only identity binding; saved revisions retain their existing shape.
export type PortalSubmission = PortalAction & { portalId: string };
