import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { route, created, listQuery, likePattern, reply, isUuid } from '@/lib/api';
import { db } from '@/lib/db';
import { pageMeta } from '@/lib/crud';
import { projectScopeSql, getAccessibleProject } from '@/lib/access';
import { invoiceBody } from '@/lib/validators';
import { createInvoice } from '@/lib/services/billing';
import { lockProject } from '@/lib/services/costs';
import { INVOICE_FROM, INVOICE_SELECT, mapInvoice } from '@/lib/services/invoice-query';
import { badRequest, forbidden } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const query = listQuery.extend({
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  status: z.enum(['SCHEDULED', 'PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
});

const SORTS: Record<string, string> = { number: 'number', dueDate: 'due_date', issueDate: 'issue_date', total: 'total', project: 'project_name', createdAt: 'created_at' };

export const GET = route({ perm: 'payments.view', query }, async ({ query, user }) => {
  if (query.projectId && !isUuid(query.projectId)) throw badRequest('Invalid projectId.');
  if (query.clientId && !isUuid(query.clientId)) throw badRequest('Invalid clientId.');
  const conds = [
    projectScopeSql(user, 'p'),
    query.projectId ? sql`i.project_id = ${query.projectId}::uuid` : sql`true`,
    query.clientId ? sql`p.client_id = ${query.clientId}::uuid` : sql`true`,
    query.from ? sql`i.due_date >= ${query.from}::date` : sql`true`,
    query.to ? sql`i.due_date <= ${query.to}::date` : sql`true`,
    query.q ? sql`(i.number ILIKE ${likePattern(query.q)} OR p.name ILIKE ${likePattern(query.q)} OR c.company_name ILIKE ${likePattern(query.q)} OR p.code ILIKE ${likePattern(query.q)})` : sql`true`,
  ];
  const where = sql.join(conds, sql` AND `);
  const wrap = sql`SELECT * FROM (SELECT ${INVOICE_SELECT} ${INVOICE_FROM} WHERE ${where}) x`;
  const statusCond = query.status ? sql`WHERE derived_status = ${query.status}` : sql``;
  const sortCol = sql.raw(SORTS[query.sort ?? ''] ?? 'due_date');
  const dir = sql.raw(query.dir === 'asc' ? 'ASC' : 'DESC');
  const [tot] = (await db.execute(sql`SELECT count(*)::int AS n, COALESCE(SUM(ROUND((total - settled)*100)) FILTER (WHERE derived_status IN ('PENDING','PARTIALLY_PAID','OVERDUE')),0)::bigint AS outstanding FROM (${wrap}) y ${statusCond}`)).rows as { n: number; outstanding: string }[];
  const rows = (await db.execute(sql`SELECT * FROM (${wrap}) y ${statusCond} ORDER BY ${sortCol} ${dir}, id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`)).rows;
  return reply(rows.map(mapInvoice), { meta: { ...pageMeta(query.page, query.pageSize, tot.n), outstandingMinor: Number(tot.outstanding) } });
});

export const POST = route({ perm: 'payments.manage', body: invoiceBody }, async ({ body, user, actor }) => {
  await getAccessibleProject(user, body.projectId);
  // invoice numbers are sequential by design (GST); a manual number is an administrator-only override
  if (body.number && !user.perms.has('settings.manage')) throw forbidden('Invoice numbers are assigned automatically.', 'INVOICE_NUMBER_FORBIDDEN');
  const inv = await db.transaction(async (tx) => {
    await lockProject(tx, body.projectId);
    return createInvoice(tx, actor, body);
  });
  return created(inv);
});
