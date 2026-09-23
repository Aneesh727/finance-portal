import { z } from 'zod';
import { and, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { route, created, listQuery, likePattern } from '@/lib/api';
import { db } from '@/lib/db';
import { clients } from '@/db/schema';
import { orderBy, pageMeta, trimOrNull } from '@/lib/crud';
import { stateFromGstin } from '@/lib/schemas';
import { clientBody } from '@/lib/validators';
import { clientStats } from '@/lib/services/clients';
import { reply } from '@/lib/api';

export const dynamic = 'force-dynamic';

const query = listQuery.extend({ archived: z.enum(['0', '1', 'all']).default('0') });

export const GET = route({ perm: 'clients.view', query }, async ({ query, user }) => {
  const conds = [
    query.archived === 'all' ? undefined : query.archived === '1' ? sql`${clients.archivedAt} is not null` : isNull(clients.archivedAt),
    query.q ? or(ilike(clients.companyName, likePattern(query.q)), ilike(clients.contactPerson, likePattern(query.q)), ilike(clients.email, likePattern(query.q))) : undefined,
  ].filter(Boolean);
  const where = conds.length ? and(...(conds as never[])) : undefined;
  const [{ total }] = (await db.select({ total: sql<number>`count(*)::int` }).from(clients).where(where)) as { total: number }[];
  const rows = await db
    .select()
    .from(clients)
    .where(where)
    .orderBy(...orderBy({ id: clients.id, name: clients.companyName, createdAt: clients.createdAt, industry: clients.industry }, query.sort, query.dir, 'name'))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  const stats = await clientStats(rows.map((r) => r.id), user);
  return reply(rows.map((r) => ({ ...r, stats: stats.get(r.id) })), { meta: pageMeta(query.page, query.pageSize, total) });
});

export const POST = route({ perm: 'clients.manage', body: clientBody }, async ({ body, audit }) => {
  const row = await db.transaction(async (tx) => {
    const [c] = await tx.insert(clients).values({ ...body, companyName: body.companyName.trim(), stateCode: stateFromGstin(body.gstin) }).returning();
    await audit(tx, { action: 'client.create', entityType: 'client', entityId: c.id, summary: `Created client ${c.companyName}`, new: c });
    return c;
  });
  return created(row);
});
void eq; void trimOrNull;
