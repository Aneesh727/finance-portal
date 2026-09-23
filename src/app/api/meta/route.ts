import { and, eq } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { categories, exchangeRates, paymentTerms, taxRates } from '@/db/schema';
import { getCompany, getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/** reference data every form needs (any signed-in user) */
export const GET = route({}, async ({ user }) => {
  const c = await getCompany();
  const s = await getSettings();
  const cats = await db.select().from(categories).where(eq(categories.active, true)).orderBy(categories.sortOrder, categories.name);
  const rates = await db.select({ currency: exchangeRates.currency }).from(exchangeRates);
  return {
    company: c ? { name: c.name, baseCurrency: c.baseCurrency, fyStartMonth: c.fyStartMonth, dateFormat: c.dateFormat, stateCode: c.stateCode } : null,
    categories: { service: cats.filter((x) => x.kind === 'SERVICE'), cost: cats.filter((x) => x.kind === 'COST'), expense: cats.filter((x) => x.kind === 'EXPENSE') },
    taxRates: await db.select().from(taxRates).where(eq(taxRates.active, true)).orderBy(taxRates.ratePct),
    paymentTerms: await db.select().from(paymentTerms).where(and(eq(paymentTerms.active, true))).orderBy(paymentTerms.sortOrder, paymentTerms.days),
    currencies: [...new Set([c?.baseCurrency ?? 'INR', ...rates.map((r) => r.currency)])],
    thresholds: s.thresholds,
    approvals: user.perms.has('settings.manage') ? s.approvals : { expenseThreshold: s.approvals.expenseThreshold },
  };
});
