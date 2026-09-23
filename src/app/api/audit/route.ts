import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { route, listQuery, reply, isUuid, likePattern } from '@/lib/api';
import { db } from '@/lib/db';
import { pageMeta } from '@/lib/crud';
import { badRequest } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const query = listQuery.extend({ entityType: z.string().max(40).optional(), entityId: z.string().max(60).optional(), projectId: z.string().optional(), userId: z.string().optional(), action: z.string().max(60).optional() });

export const GET = route({ perm: 'audit.view', query }, async ({ query }) => {
  for (const k of ['projectId', 'userId'] as const) if (query[k] && !isUuid(query[k])) throw badRequest(`Invalid ${k}.`);
  const where = sql.join([
    query.entityType ? sql`a.entity_type = ${query.entityType}` : sql`true`,
    query.entityId ? sql`a.entity_id = ${query.entityId}` : sql`true`,
    query.projectId ? sql`a.project_id = ${query.projectId}::uuid` : sql`true`,
    query.userId ? sql`a.user_id = ${query.userId}::uuid` : sql`true`,
    query.action ? sql`a.action LIKE ${likePattern(query.action)}` : sql`true`,
    query.from ? sql`a.created_at >= ${query.from}::date` : sql`true`,
    query.to ? sql`a.created_at < (${query.to}::date + 1)` : sql`true`,
    query.q ? sql`(a.summary ILIKE ${likePattern(query.q)} OR a.user_email ILIKE ${likePattern(query.q)})` : sql`true`,
  ], sql` AND `);
  const [t] = (await db.execute(sql`SELECT count(*)::int AS n FROM audit_logs a WHERE ${where}`)).rows as { n: number }[];
  const rows = (await db.execute(sql`SELECT a.id, a.created_at, a.user_id, a.user_email, a.action, a.entity_type, a.entity_id, a.project_id, a.summary, a.old_value, a.new_value, a.ip
    FROM audit_logs a WHERE ${where} ORDER BY a.id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`)).rows as Record<string, unknown>[];
  return reply(rows.map((r) => ({ id: r.id, at: r.created_at, userId: r.user_id, user: r.user_email, action: r.action, entityType: r.entity_type, entityId: r.entity_id, projectId: r.project_id, summary: r.summary, old: r.old_value, new: r.new_value, ip: r.ip })), { meta: pageMeta(query.page, query.pageSize, t.n) });
});
