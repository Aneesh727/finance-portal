import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { route, listQuery, reply } from '@/lib/api';
import { db } from '@/lib/db';
import { pageMeta } from '@/lib/crud';
import { APPROVAL_STATUSES } from '@/db/schema';

export const dynamic = 'force-dynamic';

const query = listQuery.extend({ status: z.enum(APPROVAL_STATUSES).optional(), mine: z.enum(['0', '1']).default('0') });

/** approvers see every request; everyone else sees only their own */
export const GET = route({ query }, async ({ query, user }) => {
  const all = user.perms.has('approvals.decide') && query.mine !== '1';
  const where = sql.join([all ? sql`true` : sql`a.requested_by_id = ${user.id}::uuid`, query.status ? sql`a.status = ${query.status}::approval_status` : sql`true`], sql` AND `);
  const [t] = (await db.execute(sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE a.status='PENDING')::int AS pending FROM approvals a WHERE ${where}`)).rows as { n: number; pending: number }[];
  const rows = (await db.execute(sql`
    SELECT a.*, ru.name AS requested_by, du.name AS decided_by, p.code AS project_code, p.name AS project_name, p.currency
    FROM approvals a JOIN users ru ON ru.id = a.requested_by_id LEFT JOIN users du ON du.id = a.decided_by_id LEFT JOIN projects p ON p.id = a.project_id
    WHERE ${where} ORDER BY (a.status = 'PENDING') DESC, a.created_at DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`)).rows as Record<string, unknown>[];
  return reply(rows.map((r) => ({
    id: r.id, type: r.type, status: r.status, entityType: r.entity_type, entityId: r.entity_id, projectId: r.project_id, projectCode: r.project_code, projectName: r.project_name, currency: r.currency ?? 'INR',
    title: r.title, reason: r.reason, amount: r.amount, requestedBy: r.requested_by, requestedById: r.requested_by_id, decidedBy: r.decided_by, decidedAt: r.decided_at, decisionNote: r.decision_note, createdAt: r.created_at,
    canDecide: user.perms.has('approvals.decide') && r.requested_by_id !== user.id && r.status === 'PENDING',
  })), { meta: { ...pageMeta(query.page, query.pageSize, t.n), pending: t.pending } });
});
