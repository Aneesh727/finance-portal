import { sql } from 'drizzle-orm';
import { route, created, reply } from '@/lib/api';
import { db } from '@/lib/db';
import { projectBody } from '@/lib/validators';
import { createProject } from '@/lib/services/projects';
import { loadProjectFinancials, toProjectDTO } from '@/lib/finance/loaders';
import { COMPUTED_SORTS, SQL_SORTS, assertListAllowed, needsComputeMode, passesComputedFilters, projectListQuery, projectWhere } from '@/lib/services/project-list';
import { pageMeta } from '@/lib/crud';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const COMPUTE_CAP = 20000;

export const GET = route({ perm: 'projects.view', query: projectListQuery }, async ({ query, user }) => {
  assertListAllowed(query, user);
  const th = (await getSettings()).thresholds;
  const where = projectWhere(query, user);
  if (!needsComputeMode(query)) {
    const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM projects p WHERE ${where}`)).rows as { n: number }[];
    const col = sql.raw(SQL_SORTS[query.sort ?? ''] ?? 'p.created_at');
    const order = sql`${col} ${sql.raw(query.dir === 'asc' ? 'ASC' : 'DESC')} NULLS LAST, p.id`;
    const rows = await loadProjectFinancials({ where, order, limit: query.pageSize, offset: (query.page - 1) * query.pageSize, thresholds: th });
    return reply(rows.map((r) => toProjectDTO(r, user)), { meta: pageMeta(query.page, query.pageSize, n) });
  }
  // computed filter / sort: evaluate over the filtered set, then paginate (bounded)
  const all = await loadProjectFinancials({ where, order: sql`p.created_at DESC, p.id`, limit: COMPUTE_CAP, thresholds: th });
  let rows = all.filter((r) => passesComputedFilters(r, query, user));
  const key = COMPUTED_SORTS[query.sort ?? ''];
  if (key) rows = rows.sort((a, b) => (query.dir === 'asc' ? key(a, user) - key(b, user) : key(b, user) - key(a, user)));
  const total = rows.length;
  const slice = rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
  return reply(slice.map((r) => toProjectDTO(r, user)), { meta: { ...pageMeta(query.page, query.pageSize, total), truncated: all.length >= COMPUTE_CAP } });
});

export const POST = route({ perm: 'projects.create', body: projectBody }, async ({ body, user, actor }) => {
  const res = await db.transaction((tx) => createProject(tx, { user, actor }, body));
  return created({ id: res.project.id, code: res.project.code, pendingApprovals: res.pendingApprovals });
});
