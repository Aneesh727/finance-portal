import { z } from 'zod';
import { sql, eq } from 'drizzle-orm';
import { route, created, listQuery, reply, isUuid } from '@/lib/api';
import { db } from '@/lib/db';
import { invoices } from '@/db/schema';
import { pageMeta } from '@/lib/crud';
import { projectScopeSql, getAccessibleProject } from '@/lib/access';
import { paymentBody } from '@/lib/validators';
import { recordPayment } from '@/lib/services/billing';
import { lockProject } from '@/lib/services/costs';
import { badRequest, unprocessable } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const query = listQuery.extend({ projectId: z.string().optional(), invoiceId: z.string().optional(), kind: z.enum(['RECEIPT', 'REFUND']).optional(), voided: z.enum(['0', '1', 'all']).default('0') });
const SORTS: Record<string, string> = { receivedDate: 'pay.received_date', amount: 'pay.amount', createdAt: 'pay.created_at', project: 'p.name' };

export const GET = route({ perm: 'payments.view', query }, async ({ query, user }) => {
  for (const k of ['projectId', 'invoiceId'] as const) if (query[k] && !isUuid(query[k])) throw badRequest(`Invalid ${k}.`);
  const where = sql.join([
    projectScopeSql(user, 'p'),
    query.projectId ? sql`pay.project_id = ${query.projectId}::uuid` : sql`true`,
    query.invoiceId ? sql`pay.invoice_id = ${query.invoiceId}::uuid` : sql`true`,
    query.kind ? sql`pay.kind = ${query.kind}` : sql`true`,
    query.voided === 'all' ? sql`true` : query.voided === '1' ? sql`pay.voided_at IS NOT NULL` : sql`pay.voided_at IS NULL`,
    query.from ? sql`pay.received_date >= ${query.from}::date` : sql`true`,
    query.to ? sql`pay.received_date <= ${query.to}::date` : sql`true`,
    query.q ? sql`(pay.reference ILIKE ${'%' + query.q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'} OR p.name ILIKE ${'%' + query.q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'} OR i.number ILIKE ${'%' + query.q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'})` : sql`true`,
  ], sql` AND `);
  const from = sql`FROM payments pay JOIN projects p ON p.id = pay.project_id LEFT JOIN invoices i ON i.id = pay.invoice_id`;
  const [tot] = (await db.execute(sql`SELECT count(*)::int AS n, COALESCE(SUM(CASE WHEN pay.voided_at IS NULL THEN (CASE WHEN pay.kind='REFUND' THEN -1 ELSE 1 END) * ROUND(pay.amount*100) ELSE 0 END),0)::bigint AS net ${from} WHERE ${where}`)).rows as { n: number; net: string }[];
  const col = sql.raw(SORTS[query.sort ?? ''] ?? 'pay.received_date');
  const rows = (await db.execute(sql`SELECT pay.*, p.name AS project_name, p.code AS project_code, p.currency, i.number AS invoice_number ${from} WHERE ${where} ORDER BY ${col} ${sql.raw(query.dir === 'asc' ? 'ASC' : 'DESC')}, pay.id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`)).rows as Record<string, unknown>[];
  return reply(rows.map((r) => ({
    id: r.id, projectId: r.project_id, projectName: r.project_name, projectCode: r.project_code, currency: r.currency, invoiceId: r.invoice_id, invoiceNumber: r.invoice_number, kind: r.kind,
    amount: r.amount, tdsAmount: r.tds_amount, receivedDate: r.received_date, method: r.method, reference: r.reference, notes: r.notes, voidedAt: r.voided_at, voidReason: r.void_reason, createdAt: r.created_at,
  })), { meta: { ...pageMeta(query.page, query.pageSize, tot.n), netReceivedMinor: Number(tot.net) } });
});

export const POST = route({ perm: 'payments.manage', body: paymentBody }, async ({ body, user, actor }) => {
  let projectId = body.projectId;
  if (body.invoiceId) {
    const [inv] = await db.select({ projectId: invoices.projectId }).from(invoices).where(eq(invoices.id, body.invoiceId)).limit(1);
    if (!inv) throw unprocessable('That invoice does not exist.', { fields: { invoiceId: 'Not found' } });
    if (projectId && projectId !== inv.projectId) throw unprocessable('That invoice belongs to a different project.', { fields: { invoiceId: 'Wrong project' } });
    projectId = inv.projectId;
  }
  if (!projectId) throw unprocessable('Choose a project or an invoice for this payment.', { fields: { projectId: 'Required' } });
  await getAccessibleProject(user, projectId);
  const res = await db.transaction(async (tx) => {
    await lockProject(tx, projectId!);
    return recordPayment(tx, actor, { ...body, projectId });
  });
  return created(res);
});
