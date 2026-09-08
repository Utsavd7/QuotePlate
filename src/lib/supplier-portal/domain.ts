import { assertBoundedJson } from '@/lib/domain/postgres-json';
import { createHash } from 'node:crypto';
import type { PortalAction, PortalForecast, PortalSubmission } from './types';
export class PortalError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}
export function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== keys.length || !Object.keys(value).every(k => keys.includes(k))) throw new PortalError('Provide the expected JSON fields.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 200, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) throw new PortalError('Invalid text field.');
  return value.trim();
}
function note(value: unknown, required: boolean): string {
  if (typeof value !== 'string' || value.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (required && !value.trim())) throw new PortalError('Provide a note of up to 1,000 characters explaining the issue.');
  return value.trim();
}
function version(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2147483647) throw new PortalError('A positive expected version is required.');
  return Number(value);
}
export function parseAction(value: unknown): PortalAction {
  bounded(value, 16384);
  const action = (value as Record<string, unknown> | null)?.action;
  const b = exact(value, action === 'acknowledge' ? ['action', 'requestId', 'expectedVersion', 'status', 'note'] : ['action', 'requestId', 'expectedVersion', 'fingerprint', 'decision', 'note', 'evidenceReference']);
  const common = { requestId: text(b.requestId), expectedVersion: version(b.expectedVersion), note: note(b.note, b.status === 'needs_change' || b.decision === 'dispute') };
  if (action === 'acknowledge' && (b.status === 'confirmed' || b.status === 'needs_change')) return { ...common, action, status: b.status };
  if (action === 'delivery-response' && (b.decision === 'agree' || b.decision === 'dispute') && typeof b.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(b.fingerprint)) return { ...common, action, decision: b.decision, fingerprint: b.fingerprint, evidenceReference: text(b.evidenceReference, 200, true) };
  throw new PortalError('Invalid collaboration action.');
}
export function parseSubmission(value: unknown): PortalSubmission {
  bounded(value, 16384);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new PortalError('Provide the expected JSON fields.');
  const { portalId, ...action } = value as Record<string, unknown>;
  return { ...parseAction(action), portalId: text(portalId) };
}
export function parseDemand(value: unknown) {
  bounded(value, 16384);
  const b = exact(value, ['planId', 'expectedPlanVersion', 'itemKeys']);
  if (!Array.isArray(b.itemKeys) || !b.itemKeys.length || b.itemKeys.length > 100) throw new PortalError('Choose 1–100 shortage rows.');
  const itemKeys = b.itemKeys.map(k => text(k));
  if (new Set(itemKeys).size !== itemKeys.length) throw new PortalError('Choose each row once.');
  return { planId: text(b.planId), expectedPlanVersion: version(b.expectedPlanVersion), itemKeys };
}
export function selectDemand(rows: { itemKey: string; name: string; deficit: string; unit: string; specification: object; blocked: boolean }[], keys: string[]): PortalForecast['items'] {
  const items = keys.map(key => {
    const row = rows.find(r => r.itemKey === key);
    if (!row || row.blocked || !/^\d+(\.\d+)?$/.test(row.deficit) || Number(row.deficit) <= 0) throw new PortalError('Selected rows must be current, unblocked purchase shortages.');
    return { itemKey: row.itemKey, name: row.name, quantity: row.deficit, unit: row.unit, specification: ['description', 'preferredBrand', 'packSize', 'qualityGrade', 'notes'].map(key => (row.specification as Record<string, unknown>)[key]).filter((value): value is string => typeof value === 'string' && value.length > 0).join(' · ') };
  });
  bounded(items, 131072);
  return items;
}
export function bounded(value: unknown, max: number, status = 422) {
  try { assertBoundedJson(value, max, 'Supplier collaboration'); } catch { throw new PortalError('Content is invalid or exceeds the storage size limit.', status); }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function fingerprint(value: unknown) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
