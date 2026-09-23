import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { PROJECT_STATUSES, PROJECT_TYPES, PRIORITIES } from '@/db/schema';
import { csvList, likePattern, listQuery, uuidSchema } from '@/lib/api';
import type { AuthUser } from '@/lib/auth';
import { projectScopeSql } from '@/lib/access';
import { healthFor, type ProjectFinRow } from '@/lib/finance/loaders';
import { forbidden } from '@/lib/errors';

export const projectListQuery = listQuery.extend({
  status: z.string().max(200).optional(),
  type: z.string().max(200).optional(),
  priority: z.string().max(100).optional(),
  serviceId: uuidSchema.optional(),
  clientId: uuidSchema.optional(),
  managerId: uuidSchema.optional(),
  health: z.string().max(60).optional(),
  marginMin: z.coerce.number().min(-1000).max(1000).optional(),
  marginMax: z.coerce.number().min(-1000).max(1000).optional(),
  archived: z.enum(['0', '1', 'all']).default('0'),
  overdue: z.enum(['1']).optional(),
  demo: z.enum(['0', '1']).optional(),
});
export type ProjectListQuery = z.infer<typeof projectListQuery>;

const inList = (col: SQL, values: string[], cast: string) => sql`${col}::text IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)}) AND ${col}::${sql.raw(cast)} IS NOT NULL`;

/** SQL predicates over `projects p` for the request filters + the caller's row-level scope. */
export function projectWhere(q: Partial<ProjectListQuery>, user: AuthUser): SQL {
  const c: SQL[] = [projectScopeSql(user)];
  if (q.archived !== 'all') c.push(q.archived === '1' ? sql`p.archived_at IS NOT NULL` : sql`p.archived_at IS NULL`);
  const st = csvList(q.status).filter((s) => (PROJECT_STATUSES as readonly string[]).includes(s));
  if (st.length) c.push(sql`p.status::text IN (${sql.join(st.map((s) => sql`${s}`), sql`, `)})`);
  const ty = csvList(q.type).filter((s) => (PROJECT_TYPES as readonly string[]).includes(s));
  if (ty.length) c.push(sql`p.type::text IN (${sql.join(ty.map((s) => sql`${s}`), sql`, `)})`);
  const pr = csvList(q.priority).filter((s) => (PRIORITIES as readonly string[]).includes(s));
  if (pr.length) c.push(sql`p.priority::text IN (${sql.join(pr.map((s) => sql`${s}`), sql`, `)})`);
  if (q.serviceId) c.push(sql`p.service_id = ${q.serviceId}::uuid`);
  if (q.clientId) c.push(sql`p.client_id = ${q.clientId}::uuid`);
  if (q.managerId) c.push(sql`p.manager_id = ${q.managerId}::uuid`);
  if (q.demo) c.push(sql`p.is_demo = ${q.demo === '1'}`);
  if (q.q) {
    const like = likePattern(q.q.toLowerCase());
    c.push(sql`(lower(p.name) LIKE ${like} OR lower(p.code) LIKE ${like} OR EXISTS (SELECT 1 FROM clients cl WHERE cl.id = p.client_id AND lower(cl.company_name) LIKE ${like}))`);
  }
  if (q.from) c.push(sql`COALESCE(p.start_date, p.contract_date, p.created_at::date) >= ${q.from}::date`);
  if (q.to) c.push(sql`COALESCE(p.start_date, p.contract_date, p.created_at::date) <= ${q.to}::date`);
  return sql.join(c, sql` AND `);
}

export const SQL_SORTS: Record<string, string> = {
  name: 'lower(p.name)', code: 'p.code', createdAt: 'p.created_at', startDate: 'p.start_date', endDate: 'p.end_date', status: 'p.status', priority: 'p.priority',
};

export const COMPUTED_SORTS: Record<string, (r: ProjectFinRow, u: AuthUser) => number> = {
  revenue: (r) => r.f.revenue.revenue,
  cost: (r) => r.f.cost.actual,
  profit: (r) => r.f.actualProfit,
  margin: (r) => r.f.grossMarginPct ?? -1e9,
  projectedMargin: (r) => r.f.projectedMarginPct ?? -1e9,
  budgetUsed: (r) => r.f.budget.utilizationPct ?? -1,
  outstanding: (r) => r.f.receivables.outstanding,
  health: (r, u) => ({ CRITICAL: 3, ATTENTION: 2, HEALTHY: 1, NA: 0 } as Record<string, number>)[healthFor(r.f, u)?.status ?? 'NA'],
};

export function passesComputedFilters(r: ProjectFinRow, q: Partial<ProjectListQuery>, user: AuthUser): boolean {
  const hs = csvList(q.health);
  if (hs.length && !hs.includes(healthFor(r.f, user)?.status ?? 'NA')) return false;
  if (q.marginMin !== undefined && (r.f.grossMarginPct === null || r.f.grossMarginPct < q.marginMin)) return false;
  if (q.marginMax !== undefined && (r.f.grossMarginPct === null || r.f.grossMarginPct > q.marginMax)) return false;
  if (q.overdue && !r.hasOverdue) return false;
  return true;
}

export const needsComputeMode = (q: Partial<ProjectListQuery>) =>
  !!(q.health || q.marginMin !== undefined || q.marginMax !== undefined || q.overdue || (q.sort && q.sort in COMPUTED_SORTS));

const NEEDS_PROFIT = new Set(['revenue', 'profit', 'margin', 'projectedMargin', 'outstanding']);
const NEEDS_COST = new Set(['cost', 'budgetUsed']);
/** sorting/filtering by a figure the caller may not see would leak it through the ordering, so it is refused */
export function assertListAllowed(q: Partial<ProjectListQuery>, user: AuthUser) {
  const profit = user.perms.has('profit.view'), cost = user.perms.has('costs.view');
  const sort = q.sort ?? '';
  if ((NEEDS_PROFIT.has(sort) && !profit) || (NEEDS_COST.has(sort) && !cost)) throw forbidden('You do not have access to sort by that column.');
  if ((q.marginMin !== undefined || q.marginMax !== undefined || q.overdue) && !profit) throw forbidden('You do not have access to filter by margin or payments.');
  if (q.health && !profit && !cost) throw forbidden('You do not have access to filter by health.');
}
