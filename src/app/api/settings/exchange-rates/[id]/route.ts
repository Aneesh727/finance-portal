import { eq } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { exchangeRates } from '@/db/schema';
import { notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** existing projects and costs keep the rate they stored, so removing a rate never changes history */
export const DELETE = route({ perm: 'settings.manage' }, async ({ id, audit }) =>
  db.transaction(async (tx) => {
    const [r] = await tx.delete(exchangeRates).where(eq(exchangeRates.id, id())).returning();
    if (!r) throw notFound('Exchange rate');
    await audit(tx, { action: 'fx.delete', entityType: 'exchange_rate', entityId: r.id, summary: `Removed ${r.currency} rate effective ${r.effectiveOn}`, old: r });
    return { id: r.id, deleted: true };
  }));
