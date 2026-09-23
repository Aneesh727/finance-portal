import { z } from 'zod';
import { and, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { route, created, listQuery, likePattern, reply } from '@/lib/api';
import { db } from '@/lib/db';
import { resourceRateHistory, resources } from '@/db/schema';
import { orderBy, pageMeta } from '@/lib/crud';
import { resourceBody } from '@/lib/validators';
import { RESOURCE_TYPES } from '@/db/schema';
import { deriveRates, redactResource } from '@/lib/services/resources';
import { getSettings } from '@/lib/settings';
import { todayStr } from '@/lib/dates';
import { unprocessable } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const query = listQuery.extend({
  archived: z.enum(['0', '1', 'all']).default('0'),
  type: z.enum(RESOURCE_TYPES).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const GET = route({ perm: 'resources.view', query }, async ({ query, user }) => {
  const conds = [
    query.archived === 'all' ? undefined : query.archived === '1' ? sql`${resources.archivedAt} is not null` : isNull(resources.archivedAt),
    query.type ? eq(resources.type, query.type) : undefined,
    query.status ? eq(resources.status, query.status) : undefined,
    query.q ? or(ilike(resources.name, likePattern(query.q)), ilike(resources.role, likePattern(query.q))) : undefined,
  ].filter(Boolean);
  const where = conds.length ? and(...(conds as never[])) : undefined;
  const [{ total }] = (await db.select({ total: sql<number>`count(*)::int` }).from(resources).where(where)) as { total: number }[];
  const rows = await db.select().from(resources).where(where)
    .orderBy(...orderBy({ id: resources.id, name: resources.name, role: resources.role, type: resources.type, createdAt: resources.createdAt }, query.sort, query.dir, 'name'))
    .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
  return reply(rows.map((r) => redactResource(r, user)), { meta: pageMeta(query.page, query.pageSize, total) });
});

export const POST = route({ perm: 'resources.manage', body: resourceBody }, async ({ body, audit }) => {
  if (body.startDate && body.endDate && body.endDate < body.startDate) throw unprocessable('End date cannot be before start date.');
  const s = await getSettings();
  const rates = deriveRates(body, s);
  return created(await db.transaction(async (tx) => {
    const [r] = await tx.insert(resources).values({ ...body, ...rates }).returning();
    await tx.insert(resourceRateHistory).values({ resourceId: r.id, effectiveOn: todayStr(), hourlyCost: r.hourlyCost, dailyCost: r.dailyCost, monthlyCost: r.monthlyCost, billingRate: r.billingRate });
    await audit(tx, { action: 'resource.create', entityType: 'resource', entityId: r.id, summary: `Created ${r.type.toLowerCase()} ${r.name} (${r.role})`, new: r });
    return r;
  }));
});
