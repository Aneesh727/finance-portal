import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { categories } from '@/db/schema';
import { notFound } from '@/lib/errors';
import { reqText } from '@/lib/schemas';
import { slugify } from '@/lib/base-data';

export const dynamic = 'force-dynamic';

const patch = z.object({ name: reqText(80).optional(), active: z.boolean().optional() });

/** categories are deactivated, never deleted (historical costs keep pointing at them) */
export const PATCH = route({ perm: 'settings.manage', body: patch }, async ({ id, body, audit }) => {
  const cid = id();
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(categories).where(eq(categories.id, cid)).limit(1);
    if (!old) throw notFound('Category');
    const set: Record<string, unknown> = {};
    if (body.name !== undefined) { set.name = body.name; set.slug = slugify(body.name); }
    if (body.active !== undefined) set.active = body.active;
    const [row] = await tx.update(categories).set(set).where(eq(categories.id, cid)).returning();
    await audit(tx, { action: 'category.update', entityType: 'category', entityId: cid, summary: `Updated category ${old.name}`, old, new: row });
    return row;
  });
});
