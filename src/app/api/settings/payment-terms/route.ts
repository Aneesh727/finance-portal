import { z } from 'zod';
import { route, created } from '@/lib/api';
import { db } from '@/lib/db';
import { paymentTerms } from '@/db/schema';
import { optText, reqText } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: 'settings.manage', body: z.object({ name: reqText(60), days: z.coerce.number().int().min(0).max(365), description: optText(200) }) }, async ({ body, audit }) =>
  created(await db.transaction(async (tx) => {
    const [r] = await tx.insert(paymentTerms).values(body).returning();
    await audit(tx, { action: 'paymentterm.create', entityType: 'payment_term', entityId: r.id, summary: `Added payment term ${r.name} (${r.days} days)`, new: r });
    return r;
  })));
