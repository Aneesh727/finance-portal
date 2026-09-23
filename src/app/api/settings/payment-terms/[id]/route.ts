import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { paymentTerms } from '@/db/schema';
import { notFound } from '@/lib/errors';
import { optText, reqText } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const PATCH = route({ perm: 'settings.manage', body: z.object({ name: reqText(60).optional(), days: z.coerce.number().int().min(0).max(365).optional(), description: optText(200).optional(), active: z.boolean().optional() }) }, async ({ id, body, audit }) =>
  db.transaction(async (tx) => {
    const [old] = await tx.select().from(paymentTerms).where(eq(paymentTerms.id, id())).limit(1);
    if (!old) throw notFound('Payment term');
    const [r] = await tx.update(paymentTerms).set(body).where(eq(paymentTerms.id, old.id)).returning();
    await audit(tx, { action: 'paymentterm.update', entityType: 'payment_term', entityId: r.id, summary: `Updated payment term ${old.name}`, old, new: r });
    return r;
  }));
