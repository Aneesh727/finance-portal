import { sql } from 'drizzle-orm';
import { todayStr } from '@/lib/dates';

/** the invoice + settled amount + derived status, reusable by list / detail */
export const INVOICE_SELECT = sql`
  i.*, p.name AS project_name, p.code AS project_code, p.currency AS project_currency, c.company_name AS client_name, p.client_id,
  s.settled, s.received, s.tds,
  CASE WHEN i.status='CANCELLED' THEN 'CANCELLED' WHEN i.status='SCHEDULED' THEN 'SCHEDULED'
       WHEN s.settled >= i.total AND i.total > 0 THEN 'PAID' WHEN i.due_date < ${todayStr()}::date THEN 'OVERDUE'
       WHEN s.settled > 0 THEN 'PARTIALLY_PAID' ELSE 'PENDING' END AS derived_status`;
export const INVOICE_FROM = sql`
  FROM invoices i JOIN projects p ON p.id = i.project_id JOIN clients c ON c.id = p.client_id
  LEFT JOIN LATERAL (SELECT COALESCE(SUM(pay.amount + pay.tds_amount) FILTER (WHERE pay.kind='RECEIPT'),0) - COALESCE(SUM(pay.amount + pay.tds_amount) FILTER (WHERE pay.kind='REFUND'),0) AS settled,
      COALESCE(SUM(pay.amount) FILTER (WHERE pay.kind='RECEIPT'),0) - COALESCE(SUM(pay.amount) FILTER (WHERE pay.kind='REFUND'),0) AS received,
      COALESCE(SUM(pay.tds_amount),0) AS tds
      FROM payments pay WHERE pay.invoice_id = i.id AND pay.voided_at IS NULL) s ON true`;


export function mapInvoice(r: Record<string, unknown>) {
  return {
    id: r.id, projectId: r.project_id, projectName: r.project_name, projectCode: r.project_code, currency: r.project_currency, clientId: r.client_id, clientName: r.client_name,
    number: r.number, type: r.type, milestoneId: r.milestone_id, description: r.description, status: r.derived_status, storedStatus: r.status,
    issueDate: r.issue_date, dueDate: r.due_date, subtotal: r.subtotal, cgst: r.cgst, sgst: r.sgst, igst: r.igst, taxAmount: r.tax_amount, total: r.total,
    received: r.received, tds: r.tds, settled: r.settled, outstanding: r.status === 'CANCELLED' || r.status === 'SCHEDULED' ? '0' : String(Math.max(0, Math.round((Number(r.total) - Number(r.settled)) * 100) / 100)),
    cancelReason: r.cancel_reason, version: r.version, createdAt: r.created_at,
  };
}

