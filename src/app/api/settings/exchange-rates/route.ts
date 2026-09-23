import { z } from 'zod';
import { route, created } from '@/lib/api';
import { db } from '@/lib/db';
import { exchangeRates } from '@/db/schema';
import { currency, dateStr } from '@/lib/schemas';
import { getCompany } from '@/lib/settings';
import { unprocessable } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** rate = how many BASE currency units one unit of `currency` is worth, effective from a date */
export const POST = route({ perm: 'settings.manage', body: z.object({ currency, rateToBase: z.coerce.number().positive().max(1e6), effectiveOn: dateStr }) }, async ({ body, audit }) =>
  created(await db.transaction(async (tx) => {
    const base = (await getCompany(tx))?.baseCurrency ?? 'INR';
    if (body.currency === base) throw unprocessable('The base currency always has a rate of 1.', { fields: { currency: 'Is the base currency' } });
    const [r] = await tx.insert(exchangeRates).values({ currency: body.currency, rateToBase: String(body.rateToBase), effectiveOn: body.effectiveOn })
      .onConflictDoUpdate({ target: [exchangeRates.currency, exchangeRates.effectiveOn], set: { rateToBase: String(body.rateToBase) } }).returning();
    await audit(tx, { action: 'fx.set', entityType: 'exchange_rate', entityId: r.id, summary: `Set ${body.currency} = ${body.rateToBase} ${base} from ${body.effectiveOn}`, new: r });
    return r;
  })));
