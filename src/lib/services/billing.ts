import { and, eq, sql } from 'drizzle-orm';
import type { Executor } from '@/lib/db';
import { clients, invoices, milestones, payments, projects, retainers } from '@/db/schema';
import { calculateTax, splitGst } from '@/lib/finance/engine';
import { fromMinor, mulDiv, toMinor, type Minor } from '@/lib/money';
import { fyLabel, todayStr, type DateStr } from '@/lib/dates';
import { conflict, notFound, unprocessable } from '@/lib/errors';
import { getCompany, nextSequence } from '@/lib/settings';
import { audit, type Actor } from '@/lib/audit';
import { formatMoney } from '@/lib/money';
import { loadOne } from '@/lib/finance/loaders';

type Project = typeof projects.$inferSelect;
export type InvoiceDerivedStatus = 'SCHEDULED' | 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';

export function deriveInvoiceStatus(status: string, dueDate: string, total: Minor, settled: Minor, today: DateStr): InvoiceDerivedStatus {
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'SCHEDULED') return 'SCHEDULED';
  if (settled >= total && total > 0) return 'PAID';
  if (dueDate < today) return 'OVERDUE';
  if (settled > 0) return 'PARTIALLY_PAID';
  return 'PENDING';
}

/** intra-state supply (CGST+SGST) when company and client state codes match or either is unknown */
export async function isIntraState(exec: Executor, clientId: string): Promise<boolean> {
  const company = await getCompany(exec);
  const [c] = await exec.select({ s: clients.stateCode }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!company?.stateCode || !c?.s) return true;
  return company.stateCode === c.s;
}

export function buildInvoiceAmounts(subtotal: Minor, project: Pick<Project, 'taxMode' | 'taxRatePct'>, intra: boolean, explicitTax?: Minor) {
  let tax: Minor;
  if (explicitTax !== undefined) tax = explicitTax;
  else if (project.taxMode === 'NONE') tax = 0;
  else tax = calculateTax(subtotal, 0, 'EXCLUSIVE', Number(project.taxRatePct)).tax;
  const g = splitGst(tax, intra);
  return { subtotal, taxAmount: tax, cgst: g.cgst, sgst: g.sgst, igst: g.igst, total: subtotal + tax };
}

export async function invoiceNumber(tx: Executor, onDate: DateStr, fyStartMonth: number): Promise<string> {
  const fy = fyLabel(onDate, fyStartMonth);
  const n = await nextSequence(tx, `invoice:${fy}`);
  return `INV/${fy}/${String(n).padStart(4, '0')}`;
}

export interface NewInvoice {
  projectId: string;
  type: 'ADVANCE' | 'MILESTONE' | 'MONTHLY' | 'QUARTERLY' | 'FINAL' | 'CUSTOM';
  milestoneId?: string | null;
  description?: string | null;
  status: 'SCHEDULED' | 'ISSUED';
  issueDate?: string | null;
  dueDate: string;
  subtotal: string;
  taxAmount?: string;
  periodStart?: string | null;
  number?: string;
}

const BILLABLE_BLOCKED = ['CANCELLED', 'LOST'];

export async function createInvoice(tx: Executor, actor: Actor, input: NewInvoice, opts: { skipOverInvoiceCheck?: boolean } = {}) {
  const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) throw notFound('Project');
  if (project.archivedAt) throw unprocessable('This project is archived. Restore it before invoicing.', undefined, 'PROJECT_ARCHIVED');
  if (BILLABLE_BLOCKED.includes(project.status)) throw unprocessable(`A ${project.status.toLowerCase()} project cannot be invoiced.`, undefined, 'PROJECT_NOT_BILLABLE');
  const company = await getCompany(tx);
  const today = todayStr();
  const issueDate = input.status === 'ISSUED' ? input.issueDate ?? today : input.issueDate ?? null;
  if (issueDate && input.dueDate < issueDate) throw unprocessable('Due date cannot be before the issue date.');
  if (input.milestoneId) {
    const [m] = await tx.select().from(milestones).where(and(eq(milestones.id, input.milestoneId), eq(milestones.projectId, project.id))).limit(1);
    if (!m) throw unprocessable('That milestone does not belong to this project.');
  }
  const subtotal = toMinor(input.subtotal);
  if (subtotal <= 0) throw unprocessable('Invoice amount must be greater than zero.');

  // guard against invoicing more than the contract value (fixed-price projects)
  if (!opts.skipOverInvoiceCheck && ['ONE_TIME', 'MILESTONE', 'FIXED_RECURRING'].includes(project.type)) {
    const fin = await loadOne(project.id, { exec: tx });
    if (fin) {
      const cap = fin.f.revenue.contractValue;
      const [{ used }] = (await tx.execute(sql`SELECT COALESCE(SUM(ROUND(subtotal*100)),0)::bigint AS used FROM invoices WHERE project_id = ${project.id}::uuid AND status <> 'CANCELLED'`)).rows as { used: string }[];
      if (Number(used) + subtotal > cap) {
        throw unprocessable(`Invoices would total ${formatMoney(Number(used) + subtotal, project.currency)}, more than the contract value of ${formatMoney(cap, project.currency)}. Add a revenue adjustment first if the scope increased.`, { contractValue: cap, alreadyInvoiced: Number(used) }, 'OVER_INVOICED');
      }
    }
  }
  const intra = await isIntraState(tx, project.clientId);
  const amt = buildInvoiceAmounts(subtotal, project, intra, input.taxAmount !== undefined ? toMinor(input.taxAmount) : undefined);
  const number = input.number ?? (await invoiceNumber(tx, issueDate ?? input.dueDate, company?.fyStartMonth ?? 4));
  const [inv] = await tx.insert(invoices).values({
    projectId: project.id, number, type: input.type, milestoneId: input.milestoneId ?? null, description: input.description ?? null,
    status: input.status, issueDate, dueDate: input.dueDate, periodStart: input.periodStart ?? null,
    subtotal: fromMinor(amt.subtotal), cgst: fromMinor(amt.cgst), sgst: fromMinor(amt.sgst), igst: fromMinor(amt.igst), taxAmount: fromMinor(amt.taxAmount), total: fromMinor(amt.total),
  }).returning();
  await audit(tx, actor, { action: 'invoice.create', entityType: 'invoice', entityId: inv.id, projectId: project.id, summary: `${input.status === 'ISSUED' ? 'Issued' : 'Scheduled'} invoice ${number} for ${formatMoney(amt.total, project.currency)} (due ${input.dueDate})`, new: inv });
  return inv;
}

export async function issueInvoice(tx: Executor, actor: Actor, invoiceId: string, issueDate?: string) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv) throw notFound('Invoice');
  if (inv.status !== 'SCHEDULED') throw conflict(`Only scheduled invoices can be issued (this one is ${inv.status.toLowerCase()}).`, 'INVALID_STATE');
  const date = issueDate ?? todayStr();
  const due = inv.dueDate < date ? date : inv.dueDate;
  const [row] = await tx.update(invoices).set({ status: 'ISSUED', issueDate: date, dueDate: due, version: sql`${invoices.version} + 1` }).where(eq(invoices.id, invoiceId)).returning();
  await audit(tx, actor, { action: 'invoice.issue', entityType: 'invoice', entityId: invoiceId, projectId: inv.projectId, summary: `Issued invoice ${inv.number}` });
  return row;
}

export async function cancelInvoice(tx: Executor, actor: Actor, invoiceId: string, reason: string) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv) throw notFound('Invoice');
  if (inv.status === 'CANCELLED') throw conflict('This invoice is already cancelled.', 'INVALID_STATE');
  const [row] = await tx.update(invoices).set({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, version: sql`${invoices.version} + 1` }).where(eq(invoices.id, invoiceId)).returning();
  const [{ n }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM payments WHERE invoice_id = ${invoiceId}::uuid AND voided_at IS NULL`)).rows as { n: number }[];
  await audit(tx, actor, {
    action: 'invoice.cancel', entityType: 'invoice', entityId: invoiceId, projectId: inv.projectId,
    summary: `Cancelled invoice ${inv.number}: ${reason}${n ? ` (${n} payment(s) remain as unapplied credit)` : ''}`, old: { status: inv.status }, new: { status: 'CANCELLED', reason },
  });
  return row;
}

export interface NewPayment {
  projectId?: string;
  invoiceId?: string | null;
  kind: 'RECEIPT' | 'REFUND';
  amount: string;
  tdsAmount: string;
  receivedDate: string;
  method: 'BANK_TRANSFER' | 'UPI' | 'CHEQUE' | 'CASH' | 'CARD' | 'OTHER';
  reference?: string | null;
  notes?: string | null;
}

export async function recordPayment(tx: Executor, actor: Actor, input: NewPayment) {
  const today = todayStr();
  if (!input.receivedDate) throw unprocessable('A payment needs the date it was received.');
  if (input.receivedDate > today) throw unprocessable('The received date cannot be in the future.');
  let projectId = input.projectId ?? null;
  let inv: typeof invoices.$inferSelect | undefined;
  if (input.invoiceId) {
    [inv] = await tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
    if (!inv) throw notFound('Invoice');
    if (projectId && inv.projectId !== projectId) throw unprocessable('That invoice belongs to a different project.');
    if (inv.status === 'CANCELLED') throw conflict('This invoice is cancelled. Record the payment without an invoice (as an advance) instead.', 'INVOICE_CANCELLED');
    if (inv.status === 'SCHEDULED') throw conflict('This invoice has not been issued yet. Issue it first, or record the payment as an advance without an invoice.', 'INVOICE_NOT_ISSUED');
    projectId = inv.projectId;
  }
  if (!projectId) throw unprocessable('Choose a project or an invoice for this payment.');
  const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw notFound('Project');
  if (project.archivedAt) throw unprocessable('This project is archived. Restore it first.', undefined, 'PROJECT_ARCHIVED');

  const amount = toMinor(input.amount);
  const tds = toMinor(input.tdsAmount);
  if (amount <= 0) throw unprocessable('Payment amount must be greater than zero.');
  if (input.kind === 'REFUND') {
    if (tds > 0) throw unprocessable('A refund cannot carry TDS.');
    const [r] = (await tx.execute(sql`
      SELECT COALESCE(SUM(CASE WHEN kind='RECEIPT' THEN ROUND(amount*100) ELSE -ROUND(amount*100) END),0)::bigint AS net
      FROM payments WHERE voided_at IS NULL AND project_id = ${projectId}::uuid ${inv ? sql`AND invoice_id = ${inv.id}::uuid` : sql``}`)).rows as { net: string }[];
    if (amount > Number(r.net)) throw unprocessable(`Cannot refund ${formatMoney(amount, project.currency)}; only ${formatMoney(Math.max(0, Number(r.net)), project.currency)} has been received${inv ? ' on this invoice' : ''}.`, undefined, 'REFUND_EXCEEDS_RECEIVED');
  }
  const [p] = await tx.insert(payments).values({
    projectId, invoiceId: inv?.id ?? null, kind: input.kind, amount: fromMinor(amount), tdsAmount: fromMinor(tds), receivedDate: input.receivedDate,
    method: input.method, reference: input.reference ?? null, notes: input.notes ?? null, createdById: actor.userId ?? null,
  }).returning();

  // report overpayment
  let overpaidBy = 0;
  if (inv && input.kind === 'RECEIPT') {
    const [s] = (await tx.execute(sql`
      SELECT COALESCE(SUM(CASE WHEN kind='RECEIPT' THEN ROUND((amount+tds_amount)*100) ELSE -ROUND(amount*100) END),0)::bigint AS settled
      FROM payments WHERE invoice_id = ${inv.id}::uuid AND voided_at IS NULL`)).rows as { settled: string }[];
    overpaidBy = Math.max(0, Number(s.settled) - toMinor(inv.total));
  }
  await audit(tx, actor, {
    action: input.kind === 'REFUND' ? 'payment.refund' : 'payment.record', entityType: 'payment', entityId: p.id, projectId,
    summary: `${input.kind === 'REFUND' ? 'Refunded' : 'Received'} ${formatMoney(amount, project.currency)}${inv ? ` against ${inv.number}` : ' (no invoice / advance)'} on ${input.receivedDate}${overpaidBy ? ` - overpaid by ${formatMoney(overpaidBy, project.currency)}` : ''}`, new: p,
  });
  return { payment: p, overpaidBy };
}

export async function voidPayment(tx: Executor, actor: Actor, paymentId: string, reason: string) {
  const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!p) throw notFound('Payment');
  if (p.voidedAt) throw conflict('This payment is already voided.', 'INVALID_STATE');
  const [row] = await tx.update(payments).set({ voidedAt: new Date(), voidReason: reason }).where(eq(payments.id, paymentId)).returning();
  await audit(tx, actor, { action: 'payment.void', entityType: 'payment', entityId: paymentId, projectId: p.projectId, summary: `Voided payment of ${p.amount}: ${reason}`, old: p, new: { voided: true, reason } });
  return row;
}

/**
 * Turn a payment plan (e.g. 30% advance / 40% milestone / 30% final) into SCHEDULED invoices.
 * Percentages apply to the contract value (ex-tax). The last item absorbs rounding so the plan sums exactly.
 */
export async function generateSchedule(
  tx: Executor, actor: Actor, project: Project, contractValue: Minor,
  items: { type: NewInvoice['type']; label?: string | null; pct?: number; amount?: string; dueDate: string; milestoneId?: string | null }[],
) {
  if (!items.length) return [];
  if (contractValue <= 0) throw unprocessable('Set a contract value before creating a payment schedule.');
  const totalPct = items.reduce((a, i) => a + (i.pct ?? 0), 0);
  if (totalPct > 100.0001) throw unprocessable(`The payment schedule adds up to ${totalPct}% of the contract (max 100%).`);
  const amounts: Minor[] = items.map((i) => (i.amount !== undefined ? toMinor(i.amount) : mulDiv(contractValue, Math.round((i.pct ?? 0) * 10000), 1_000_000)));
  const sum = amounts.reduce((a, b) => a + b, 0);
  const pctOnly = items.every((i) => i.amount === undefined);
  if (pctOnly && Math.abs(totalPct - 100) < 0.0001 && sum !== contractValue) amounts[amounts.length - 1] += contractValue - sum;
  else if (sum > contractValue) throw unprocessable(`The payment schedule (${formatMoney(sum, project.currency)}) is more than the contract value (${formatMoney(contractValue, project.currency)}).`);
  const out = [];
  for (let i = 0; i < items.length; i++) {
    if (amounts[i] <= 0) continue;
    out.push(await createInvoice(tx, actor, {
      projectId: project.id, type: items[i].type, milestoneId: items[i].milestoneId ?? null, description: items[i].label ?? null, status: 'SCHEDULED',
      dueDate: items[i].dueDate, subtotal: fromMinor(amounts[i]),
    }, { skipOverInvoiceCheck: true }));
  }
  return out;
}
void retainers;
