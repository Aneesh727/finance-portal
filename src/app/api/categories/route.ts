import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { route, created } from '@/lib/api';
import { db } from '@/lib/db';
import { categories } from '@/db/schema';
import { CATEGORY_KINDS } from '@/db/schema';
import { categoryBody } from '@/lib/validators';
import { slugify } from '@/lib/base-data';
import { conflict } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const query = z.object({ kind: z.enum(CATEGORY_KINDS).optional(), includeInactive: z.enum(['0', '1']).default('0') });

// any signed-in user may read categories (needed by every form)
export const GET = route({ query }, async ({ query }) => {
  const conds = [query.kind ? eq(categories.kind, query.kind) : undefined, query.includeInactive === '1' ? undefined : eq(categories.active, true)].filter(Boolean);
  return db.select().from(categories).where(conds.length ? and(...(conds as never[])) : undefined).orderBy(categories.kind, categories.sortOrder, categories.name);
});

export const POST = route({ perm: 'settings.manage', body: categoryBody }, async ({ body, audit }) => {
  const slug = slugify(body.name);
  return created(await db.transaction(async (tx) => {
    const [dup] = await tx.select().from(categories).where(and(eq(categories.kind, body.kind), eq(categories.slug, slug))).limit(1);
    if (dup) throw conflict('A category with this name already exists.', 'DUPLICATE');
    const [{ mx }] = (await tx.select({ mx: sql<number>`coalesce(max(${categories.sortOrder}), -1)::int` }).from(categories).where(eq(categories.kind, body.kind))) as { mx: number }[];
    const [c] = await tx.insert(categories).values({ kind: body.kind, name: body.name, slug, sortOrder: mx + 1 }).returning();
    await audit(tx, { action: 'category.create', entityType: 'category', entityId: c.id, summary: `Created ${body.kind.toLowerCase()} category ${c.name}`, new: c });
    return c;
  }));
});
