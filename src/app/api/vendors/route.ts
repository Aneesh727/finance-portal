import { z } from 'zod';
import { and, ilike, isNull, or, sql } from 'drizzle-orm';
import { route, created, listQuery, likePattern, reply } from '@/lib/api';
import { db } from '@/lib/db';
import { vendors } from '@/db/schema';
import { orderBy, pageMeta } from '@/lib/crud';
import { vendorBody } from '@/lib/validators';

export const dynamic = 'force-dynamic';

const query = listQuery.extend({ archived: z.enum(['0', '1', 'all']).default('0') });

export const GET = route({ perm: 'resources.view', query }, async ({ query }) => {
  const conds = [
    query.archived === 'all' ? undefined : query.archived === '1' ? sql`${vendors.archivedAt} is not null` : isNull(vendors.archivedAt),
    query.q ? or(ilike(vendors.name, likePattern(query.q)), ilike(vendors.category, likePattern(query.q))) : undefined,
  ].filter(Boolean);
  const where = conds.length ? and(...(conds as never[])) : undefined;
  const [{ total }] = (await db.select({ total: sql<number>`count(*)::int` }).from(vendors).where(where)) as { total: number }[];
  const rows = await db.select().from(vendors).where(where)
    .orderBy(...orderBy({ id: vendors.id, name: vendors.name, createdAt: vendors.createdAt, category: vendors.category }, query.sort, query.dir, 'name'))
    .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
  return reply(rows, { meta: pageMeta(query.page, query.pageSize, total) });
});

export const POST = route({ perm: 'resources.manage', body: vendorBody }, async ({ body, audit }) => {
  return created(await db.transaction(async (tx) => {
    const [v] = await tx.insert(vendors).values(body).returning();
    await audit(tx, { action: 'vendor.create', entityType: 'vendor', entityId: v.id, summary: `Created vendor ${v.name}`, new: v });
    return v;
  }));
});
