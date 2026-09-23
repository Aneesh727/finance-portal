import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { taxRates } from '@/db/schema';
import { notFound, unprocessable } from '@/lib/errors';
import { reqText } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/** rates are never deleted (existing projects reference the % they were created with); deactivate instead */
export const PATCH = route({ perm: 'settings.manage', body: z.object({ name: reqText(60).optional(), ratePct: z.coerce.number().min(0).max(100).optional(), isDefault: z.boolean().optional(), active: z.boolean().optional() }) }, async ({ id, body, audit }) =>
  db.transaction(async (tx) => {
    const [old] = await tx.select().from(taxRates).where(eq(taxRates.id, id())).limit(1);
    if (!old) throw notFound('Tax rate');
    if (body.active === false && (body.isDefault ?? old.isDefault)) throw unprocessable('The default tax rate cannot be deactivated. Choose another default first.');
    if (body.isDefault) await tx.update(taxRates).set({ isDefault: false }).where(eq(taxRates.isDefault, true));
    const set: Record<string, unknown> = { ...body };
    if (body.ratePct !== undefined) set.ratePct = String(body.ratePct);
    const [r] = await tx.update(taxRates).set(set).where(eq(taxRates.id, old.id)).returning();
    await audit(tx, { action: 'taxrate.update', entityType: 'tax_rate', entityId: r.id, summary: `Updated tax rate ${old.name}`, old, new: r });
    return r;
  }));
