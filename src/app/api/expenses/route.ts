import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { route, created, listQuery, likePattern, reply, isUuid } from '@/lib/api';
import { db } from '@/lib/db';
import { pageMeta } from '@/lib/crud';
import { projectScopeSql, getAccessibleProject } from '@/lib/access';
import { expenseBody } from '@/lib/validators';
import { createExpense } from '@/lib/services/expenses';
import { EXPENSE_SCOPES, EXPENSE_STATUSES } from '@/db/schema';
import { badRequest } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const query = listQuery.extend({
  categoryId: z.string().optional(), vendorId: z.string().optional(), projectId: z.string().optional(),
  scope: z.enum(EXPENSE_SCOPES).optional(), status: z.enum(EXPENSE_STATUSES).optional(), department: z.string().max(80).optional(),
  voided: z.enum(['0', '1', 'all']).default('0'),
});
const SORTS: Record<string, string> = { date: 'e.date', amount: 'e.amount', description: 'e.description', category: 'c.name', createdAt: 'e.created_at' };

export const GET = route({ perm: 'expenses.view', query }, async ({ query, user }) => {
  for (const k of ['categoryId', 'vendorId', 'projectId'] as const) if (query[k] && !isUuid(query[k])) throw badRequest(`Invalid ${k}.`);
  const where = sql.join([
    sql`(e.scope <> 'PROJECT' OR (p.id IS NOT NULL AND ${projectScopeSql(user, 'p')}))`,
    query.voided === 'all' ? sql`true` : query.voided === '1' ? sql`e.archived_at IS NOT NULL` : sql`e.archived_at IS NULL`,
    query.categoryId ? sql`e.category_id = ${query.categoryId}::uuid` : sql`true`,
    query.vendorId ? sql`e.vendor_id = ${query.vendorId}::uuid` : sql`true`,
    query.projectId ? sql`e.project_id = ${query.projectId}::uuid` : sql`true`,
    query.scope ? sql`e.scope = ${query.scope}` : sql`true`,
    query.status ? sql`e.status = ${query.status}` : sql`true`,
    query.department ? sql`e.department = ${query.department}` : sql`true`,
    query.from ? sql`e.date >= ${query.from}::date` : sql`true`,
    query.to ? sql`e.date <= ${query.to}::date` : sql`true`,
    query.q ? sql`(e.description ILIKE ${likePattern(query.q)} OR v.name ILIKE ${likePattern(query.q)} OR e.reference ILIKE ${likePattern(query.q)} OR p.name ILIKE ${likePattern(query.q)})` : sql`true`,
  ], sql` AND `);
  const from = sql`FROM expenses e JOIN categories c ON c.id = e.category_id LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN projects p ON p.id = e.project_id
    LEFT JOIN LATERAL (SELECT COALESCE(SUM(a.amount),0) AS allocated FROM expense_allocations a WHERE a.expense_id = e.id) al ON true`;
  const [tot] = (await db.execute(sql`SELECT count(*)::int AS n, COALESCE(SUM(ROUND(e.amount*100)) FILTER (WHERE e.status='APPROVED' AND e.archived_at IS NULL),0)::bigint AS approved ${from} WHERE ${where}`)).rows as { n: number; approved: string }[];
  const col = sql.raw(SORTS[query.sort ?? ''] ?? 'e.date');
  const rows = (await db.execute(sql`SELECT e.*, c.name AS category_name, v.name AS vendor_name, p.name AS project_name, p.code AS project_code, al.allocated ${from} WHERE ${where}
    ORDER BY ${col} ${sql.raw(query.dir === 'asc' ? 'ASC' : 'DESC')}, e.id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`)).rows as Record<string, unknown>[];
  return reply(rows.map((r) => ({
    id: r.id, date: r.date, categoryId: r.category_id, category: r.category_name, description: r.description, amount: r.amount, taxAmount: r.tax_amount, originalAmount: r.original_amount, currency: r.currency, fxRate: r.fx_rate,
    vendorId: r.vendor_id, vendor: r.vendor_name, paymentMethod: r.payment_method, scope: r.scope, projectId: r.project_id, projectName: r.project_name, projectCode: r.project_code, department: r.department,
    status: r.status, recurringRuleId: r.recurring_rule_id, reference: r.reference, notes: r.notes, allocated: r.allocated, version: r.version, archived: !!r.archived_at, createdAt: r.created_at,
  })), { meta: { ...pageMeta(query.page, query.pageSize, tot.n), approvedTotalMinor: Number(tot.approved) } });
});

export const POST = route({ perm: 'expenses.create', body: expenseBody }, async ({ body, user, actor }) => {
  if (body.scope === 'PROJECT' && body.projectId) await getAccessibleProject(user, body.projectId);
  return created(await db.transaction((tx) => createExpense(tx, { user, actor }, body)));
});
