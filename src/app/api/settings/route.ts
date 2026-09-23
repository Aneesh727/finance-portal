import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { company, exchangeRates, paymentTerms, taxRates } from '@/db/schema';
import { getSettings, getCompany, setSetting, NOTIFICATION_TYPES, DEFAULT_SETTINGS } from '@/lib/settings';
import { currency, gstin, optText, stateFromGstin } from '@/lib/schemas';
import { unprocessable } from '@/lib/errors';
import { diffFields } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'settings.manage' }, async () => ({
  company: await getCompany(),
  settings: await getSettings(db, { fresh: true }),
  defaults: DEFAULT_SETTINGS,
  taxRates: await db.select().from(taxRates).orderBy(taxRates.ratePct),
  paymentTerms: await db.select().from(paymentTerms).orderBy(paymentTerms.sortOrder, paymentTerms.days),
  exchangeRates: await db.select().from(exchangeRates).orderBy(exchangeRates.currency, exchangeRates.effectiveOn),
}));

const pct = z.coerce.number().min(0).max(1000);
const body = z.object({
  company: z.object({
    name: z.string().trim().min(1).max(150), legalName: optText(150), gstin, pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Invalid PAN').nullish().or(z.literal('')).transform((v) => v || null),
    address: optText(500), email: optText(200), phone: optText(40), baseCurrency: currency, fyStartMonth: z.coerce.number().int().min(1).max(12), dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']),
  }).partial().optional(),
  thresholds: z.object({ targetMarginPct: pct, criticalMarginPct: pct, budgetWarnPct: pct, budgetAlertPct: pct, overdueSharePct: pct, overdueDays: z.coerce.number().int().min(0).max(3650) }).partial().optional(),
  approvals: z.object({
    expenseThreshold: z.coerce.number().min(0).max(1e12), vendorExpenseThreshold: z.coerce.number().min(0).max(1e12), discountThresholdPct: pct.refine((v) => v <= 100, 'Max 100'),
    requireNewProjectApproval: z.boolean(), budgetIncreaseRequiresApproval: z.boolean(), cancellationRequiresApproval: z.boolean(), overBudgetRequiresApproval: z.boolean(),
  }).partial().optional(),
  notifications: z.object({ enabled: z.object(Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, z.boolean()])) as Record<(typeof NOTIFICATION_TYPES)[number], z.ZodBoolean>).partial(), renewalDays: z.coerce.number().int().min(1).max(365), endingSoonDays: z.coerce.number().int().min(1).max(365), largeExpense: z.coerce.number().min(0).max(1e12) }).partial().optional(),
  allocation: z.object({ workHoursPerMonth: z.coerce.number().min(1).max(744), workDaysPerMonth: z.coerce.number().min(1).max(31) }).partial().optional(),
  forecast: z.object({ horizonMonths: z.coerce.number().int().min(1).max(24) }).partial().optional(),
});

export const PATCH = route({ perm: 'settings.manage', body }, async ({ body, user, audit }) => {
  const cur = await getSettings(db, { fresh: true });
  await db.transaction(async (tx) => {
    if (body.company) {
      const old = await getCompany(tx);
      const set: Record<string, unknown> = { ...body.company, updatedAt: new Date() };
      if (body.company.gstin !== undefined) set.stateCode = stateFromGstin(body.company.gstin);
      if (body.company.baseCurrency && old && body.company.baseCurrency !== old.baseCurrency) {
        const [{ n }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM projects`)).rows as { n: number }[];
        if (n > 0) throw unprocessable('The base currency cannot be changed once projects exist, because every stored total is in that currency.', { fields: { baseCurrency: 'Locked' } });
      }
      await tx.update(company).set(set).where(eq(company.id, 'singleton'));
      await audit(tx, { action: 'settings.company', entityType: 'company', entityId: 'singleton', summary: 'Updated company profile', old: diffFields((old ?? {}) as never, set as never, Object.keys(body.company)).old, new: body.company });
    }
    for (const key of ['thresholds', 'approvals', 'notifications', 'allocation', 'forecast'] as const) {
      const v = body[key];
      if (!v) continue;
      const merged = { ...(cur[key] as object), ...(v as object), ...(key === 'notifications' && (v as { enabled?: object }).enabled ? { enabled: { ...cur.notifications.enabled, ...(v as { enabled: object }).enabled } } : {}) };
      if (key === 'thresholds') {
        const t = merged as typeof cur.thresholds;
        if (t.criticalMarginPct > t.targetMarginPct) throw unprocessable('The critical margin cannot be higher than the target margin.', { fields: { criticalMarginPct: 'Above target' } });
        if (t.budgetWarnPct > t.budgetAlertPct) throw unprocessable('The budget warning % cannot be higher than the alert %.', { fields: { budgetWarnPct: 'Above alert' } });
      }
      await setSetting(tx, key, merged, user.id);
      await audit(tx, { action: `settings.${key}`, entityType: 'settings', entityId: key, summary: `Updated ${key} settings`, old: cur[key], new: merged });
    }
  });
  return { ok: true };
});
