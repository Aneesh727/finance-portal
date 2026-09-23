import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { categories } from '@/db/schema';
import { uuid } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: 'settings.manage', body: z.object({ ids: z.array(uuid).min(1).max(200) }) }, async ({ body, audit }) => {
  await db.transaction(async (tx) => {
    for (let i = 0; i < body.ids.length; i++) await tx.update(categories).set({ sortOrder: i }).where(eq(categories.id, body.ids[i]));
    await audit(tx, { action: 'category.reorder', entityType: 'category', summary: `Reordered ${body.ids.length} categories` });
  });
  return { ok: true };
});
