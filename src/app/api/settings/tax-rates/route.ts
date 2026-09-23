import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { route, created } from '@/lib/api';
import { db } from '@/lib/db';
import { taxRates } from '@/db/schema';
import { reqText } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: 'settings.manage', body: z.object({ name: reqText(60), ratePct: z.coerce.number().min(0).max(100), isDefault: z.boolean().default(false) }) }, async ({ body, audit }) =>
  created(await db.transaction(async (tx) => {
    if (body.isDefault) await tx.update(taxRates).set({ isDefault: false }).where(eq(taxRates.isDefault, true));
    const [r] = await tx.insert(taxRates).values({ name: body.name, ratePct: String(body.ratePct), isDefault: body.isDefault }).returning();
    await audit(tx, { action: 'taxrate.create', entityType: 'tax_rate', entityId: r.id, summary: `Added tax rate ${r.name} (${r.ratePct}%)`, new: r });
    return r;
  })));
