import { eq, sql } from 'drizzle-orm';
import { db, type Executor } from './db';
import { company, settings } from '@/db/schema';
import { DEFAULT_THRESHOLDS, type Thresholds } from './finance/engine';
import { toMinor, type Minor } from './money';
import { DEFAULT_EMP_SETTINGS, type EmpAllocationSettings } from './finance/allocation';

export interface ApprovalRules {
  /** expense / cost above this amount needs approval (major units). 0 = off */
  expenseThreshold: number;
  /** vendor-linked expense above this needs approval (0 = off) */
  vendorExpenseThreshold: number;
  /** discount above this % of the price needs approval (0 = off) */
  discountThresholdPct: number;
  requireNewProjectApproval: boolean;
  budgetIncreaseRequiresApproval: boolean;
  cancellationRequiresApproval: boolean;
  overBudgetRequiresApproval: boolean;
}

export const NOTIFICATION_TYPES = [
  'BUDGET_WARNING', 'BUDGET_EXCEEDED', 'APPROVAL_REQUIRED', 'PAYMENT_OVERDUE', 'RETAINER_RENEWAL', 'PROJECT_ENDING', 'LOW_MARGIN', 'LARGE_EXPENSE',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationRules {
  enabled: Record<NotificationType, boolean>;
  renewalDays: number;
  endingSoonDays: number;
  /** expenses at/above this (major units) raise a LARGE_EXPENSE notification */
  largeExpense: number;
}

export interface AppSettings {
  thresholds: Thresholds;
  approvals: ApprovalRules;
  notifications: NotificationRules;
  allocation: EmpAllocationSettings;
  forecast: { horizonMonths: number };
}

export const DEFAULT_SETTINGS: AppSettings = {
  thresholds: DEFAULT_THRESHOLDS,
  approvals: {
    expenseThreshold: 25000,
    vendorExpenseThreshold: 0,
    discountThresholdPct: 15,
    requireNewProjectApproval: false,
    budgetIncreaseRequiresApproval: true,
    cancellationRequiresApproval: true,
    overBudgetRequiresApproval: true,
  },
  notifications: {
    enabled: Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, true])) as Record<NotificationType, boolean>,
    renewalDays: 30,
    endingSoonDays: 14,
    largeExpense: 100000,
  },
  allocation: DEFAULT_EMP_SETTINGS,
  forecast: { horizonMonths: 6 },
};

export const SETTING_KEYS = ['thresholds', 'approvals', 'notifications', 'allocation', 'forecast'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

let cache: { at: number; value: AppSettings } | null = null;
export const invalidateSettingsCache = () => (cache = null);

function merge<T>(base: T, over: unknown): T {
  if (over && typeof over === 'object' && !Array.isArray(over) && base && typeof base === 'object') {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
      out[k] = k in (base as object) ? merge((base as Record<string, unknown>)[k], v) : v;
    }
    return out as T;
  }
  return (over === undefined ? base : (over as T));
}

export async function getSettings(exec: Executor = db, opts: { fresh?: boolean } = {}): Promise<AppSettings> {
  if (!opts.fresh && cache && Date.now() - cache.at < 10_000) return cache.value;
  const rows = await exec.select().from(settings);
  let value = DEFAULT_SETTINGS;
  for (const r of rows) {
    if ((SETTING_KEYS as readonly string[]).includes(r.key)) value = { ...value, [r.key]: merge((DEFAULT_SETTINGS as never)[r.key], r.value) };
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function setSetting(exec: Executor, key: SettingKey, value: unknown, userId?: string) {
  await exec
    .insert(settings)
    .values({ key, value: value as never, updatedBy: userId ?? null })
    .onConflictDoUpdate({ target: settings.key, set: { value: value as never, updatedBy: userId ?? null, updatedAt: new Date() } });
  invalidateSettingsCache();
}

export const approvalThresholdMinor = (s: AppSettings): Minor => (s.approvals.expenseThreshold > 0 ? toMinor(s.approvals.expenseThreshold) : 0);

// ───────────────────────────── company ─────────────────────────────

export async function getCompany(exec: Executor = db) {
  const [c] = await exec.select().from(company).where(eq(company.id, 'singleton')).limit(1);
  return c ?? null;
}

// ───────────────────────────── atomic sequences ─────────────────────────────

/** Atomic counter (project codes, invoice numbers). Safe under concurrency. */
export async function nextSequence(exec: Executor, name: string): Promise<number> {
  const key = `seq:${name}`;
  const res = await exec.execute(sql`
    INSERT INTO settings (key, value) VALUES (${key}, '1'::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = to_jsonb(((settings.value #>> '{}')::int) + 1), updated_at = now()
    RETURNING (value #>> '{}')::int AS n`);
  const row = (res.rows as { n: number }[])[0];
  return Number(row.n);
}
