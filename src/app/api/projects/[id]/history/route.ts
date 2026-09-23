import { sql } from 'drizzle-orm';
import { route, listQuery, reply } from '@/lib/api';
import { db } from '@/lib/db';
import { getAccessibleProject } from '@/lib/access';
import { pageMeta } from '@/lib/crud';

export const dynamic = 'force-dynamic';

/** change history of one project (summaries only; raw before/after values need audit.view) */
export const GET = route({ anyPerm: ['audit.view', 'costs.view'], query: listQuery }, async ({ id, query, user }) => {
  const pid = id();
  await getAccessibleProject(user, pid);
  const [t] = (await db.execute(sql`SELECT count(*)::int AS n FROM audit_logs WHERE project_id = ${pid}::uuid`)).rows as { n: number }[];
  const rows = (await db.execute(sql`SELECT id, created_at, user_email, action, entity_type, summary, old_value, new_value FROM audit_logs WHERE project_id = ${pid}::uuid ORDER BY id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`)).rows as Record<string, unknown>[];
  const raw = user.perms.has('audit.view');
  return reply(rows.map((r) => ({ id: r.id, at: r.created_at, user: r.user_email, action: r.action, entityType: r.entity_type, summary: r.summary, old: raw ? r.old_value : undefined, new: raw ? r.new_value : undefined })), { meta: pageMeta(query.page, query.pageSize, t.n) });
});
