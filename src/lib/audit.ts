import { auditLogs } from '@/db/schema';
import type { Executor } from './db';
import { formatMoney, toMinor } from './money';

export interface Actor {
  userId?: string | null;
  email?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry {
  action: string; // e.g. project.update, cost.create, payment.record
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  summary?: string;
  old?: unknown;
  new?: unknown;
}

const SECRET_KEY = /password|token|secret|hash/i;

function redact(v: unknown): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (Array.isArray(v)) return v.map(redact);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(val);
    return out;
  }
  if (typeof v === 'bigint') return v.toString();
  return v;
}

/** Append an audit record. Pass the SAME transaction as the change so both commit or roll back together. */
export async function audit(exec: Executor, actor: Actor, e: AuditEntry) {
  await exec.insert(auditLogs).values({
    userId: actor.userId ?? null,
    userEmail: actor.email ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    projectId: e.projectId ?? null,
    summary: e.summary ?? null,
    oldValue: redact(e.old) as never,
    newValue: redact(e.new) as never,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent?.slice(0, 300) ?? null,
  });
}

// ───────────────────────────── diff helpers ─────────────────────────────

const NUMERIC = /^-?\d+(\.\d+)?$/;
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'string' && typeof b === 'string' && NUMERIC.test(a) && NUMERIC.test(b)) return Number(a) === Number(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffFields<T extends Record<string, unknown>>(oldRow: T, newRow: Partial<T>, fields?: string[]) {
  const oldV: Record<string, unknown> = {};
  const newV: Record<string, unknown> = {};
  const changed: string[] = [];
  const keys = fields ?? Object.keys(newRow);
  for (const k of keys) {
    if (!(k in newRow)) continue;
    if (!same(oldRow[k], newRow[k])) {
      changed.push(k);
      oldV[k] = oldRow[k] ?? null;
      newV[k] = newRow[k] ?? null;
    }
  }
  return { old: oldV, new: newV, changed };
}

const MONEY_FIELDS = new Set([
  'sellingPrice', 'discount', 'budget', 'amount', 'monthlyFee', 'setupFee', 'price', 'cost', 'subtotal', 'total', 'taxAmount',
  'hourlyCost', 'dailyCost', 'monthlyCost', 'billingRate', 'costRate', 'paidAmount', 'tdsAmount', 'originalAmount',
]);
const LABELS: Record<string, string> = {
  sellingPrice: 'price', discount: 'discount', budget: 'budget', amount: 'amount', monthlyFee: 'monthly fee', setupFee: 'setup fee',
  taxRatePct: 'tax rate', name: 'name', status: 'status', clientId: 'client', serviceId: 'service', managerId: 'manager', startDate: 'start date',
  endDate: 'end date', description: 'description', priority: 'priority', taxMode: 'tax mode', costRate: 'cost rate', billingRate: 'billing rate',
  actualHours: 'actual hours', plannedHours: 'planned hours', hourlyCost: 'hourly cost', monthlyCost: 'monthly cost', dailyCost: 'daily cost',
  categoryId: 'category', kind: 'kind', date: 'date', dueDate: 'due date', role: 'role', active: 'active', roleId: 'role', email: 'email',
};

function show(field: string, v: unknown, currency: string): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (MONEY_FIELDS.has(field) && (typeof v === 'string' || typeof v === 'number') && NUMERIC.test(String(v))) {
    try {
      return formatMoney(toMinor(v as string), currency);
    } catch {
      /* fall through */
    }
  }
  return String(v);
}

/** "Ansh changed project price from ₹2,00,000 to ₹2,50,000" style summary. */
export function changeSummary(entityLabel: string, changes: { old: Record<string, unknown>; new: Record<string, unknown>; changed: string[] }, currency = 'INR'): string {
  if (!changes.changed.length) return `${entityLabel}: no changes`;
  const parts = changes.changed.slice(0, 4).map((f) => `${LABELS[f] ?? f} from ${show(f, changes.old[f], currency)} to ${show(f, changes.new[f], currency)}`);
  const more = changes.changed.length > 4 ? ` (+${changes.changed.length - 4} more)` : '';
  return `${entityLabel} ${parts.join('; ')}${more}`;
}
