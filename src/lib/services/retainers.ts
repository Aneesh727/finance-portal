import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { db, type Executor } from '@/lib/db';
import { clients, categories, invoices, projects, retainerPeriods, retainerTerms, retainers } from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { audit, type Actor } from '@/lib/audit';
import { conflict, notFound, unprocessable } from '@/lib/errors';
import { formatMoney, fromMinor, toMinor, type Minor } from '@/lib/money';
import { addDays, addMonths, monthStart, todayStr, cmp } from '@/lib/dates';
import { findOverlap, retainerMonths, termMonthRevenue, retainerTotalRevenue, type TermLike } from '@/lib/finance/retainer';
import { loadOne, loadProjectFinancials, toProjectDTO } from '@/lib/finance/loaders';
import { getSettings } from '@/lib/settings';
import type { retainerCreate } from '@/lib/validators';
import { createProject } from './projects';
import { createInvoice } from './billing';
import { evaluateProjectAlerts } from './alerts';
import { projectScopeSql } from '@/lib/access';

type Ctx = { user: AuthUser; actor: Actor };
export type RetainerInput = z.infer<typeof retainerCreate>;

const toTerm = (t: typeof retainerTerms.$inferSelect): TermLike => ({ monthlyFee: toMinor(t.monthlyFee), startDate: t.startDate, endDate: t.endDate, includedHours: Number(t.includedHours), overageRate: toMinor(t.overageRate) });
const FREQ_MONTHS = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 } as const;

export async function createRetainer(tx: Executor, ctx: Ctx, i: RetainerInput) {
  if (i.endDate < i.startDate) throw unprocessable('The end date cannot be before the start date.', { fields: { endDate: 'Before start date' } });
  const res = await createProject(tx, ctx, {
    name: i.name, clientId: i.clientId, serviceId: i.serviceId, type: 'RETAINER', status: 'ACTIVE', priority: 'MEDIUM', taxMode: i.taxMode, taxRatePct: i.taxRatePct,
    sellingPrice: '0', discount: '0', setupFee: '0', monthlyFee: '0', durationMonths: 0, budget: i.budget, managerId: i.accountManagerId ?? null, notes: i.notes,
    startDate: i.startDate, endDate: i.endDate,
    retainer: { monthlyFee: i.monthlyFee, startDate: i.startDate, endDate: i.endDate, includedHours: i.includedHours, overageRate: i.overageRate, billingFrequency: i.billingFrequency, accountManagerId: i.accountManagerId ?? null },
  } as never);
  const [r] = await tx.select().from(retainers).where(eq(retainers.projectId, res.project.id)).limit(1);
  return { retainer: r, project: res.project };
}

async function loadRetainer(tx: Executor, id: string) {
  const [r] = await tx.select().from(retainers).where(eq(retainers.id, id)).limit(1);
  if (!r) throw notFound('Retainer');
  const terms = await tx.select().from(retainerTerms).where(eq(retainerTerms.retainerId, id)).orderBy(retainerTerms.startDate);
  return { r, terms };
}

export async function renewRetainer(tx: Executor, ctx: Ctx, id: string, input: { monthlyFee: string; startDate?: string; endDate: string; includedHours: number; overageRate: string }) {
  const { r, terms } = await loadRetainer(tx, id);
  if (r.status === 'CANCELLED') throw conflict('A cancelled retainer cannot be renewed. Create a new one.', 'INVALID_STATE');
  const last = terms[terms.length - 1];
  const start = input.startDate ?? addDays(last.endDate, 1);
  if (input.endDate < start) throw unprocessable('The new term must end after it starts.', { fields: { endDate: 'Before start date' } });
  const overlap = findOverlap([...terms.map((t) => ({ startDate: t.startDate, endDate: t.endDate })), { startDate: start, endDate: input.endDate }]);
  if (overlap) throw unprocessable('The new term overlaps an existing term. Start it after the current term ends.', { fields: { startDate: 'Overlaps existing term' } }, 'TERM_OVERLAP');
  const [t] = await tx.insert(retainerTerms).values({ retainerId: id, monthlyFee: input.monthlyFee, startDate: start, endDate: input.endDate, includedHours: String(input.includedHours), overageRate: input.overageRate, renewalDate: input.endDate }).returning();
  await tx.update(retainers).set({ status: 'ACTIVE', cancelledOn: null, updatedAt: new Date() }).where(eq(retainers.id, id));
  await tx.update(projects).set({ endDate: input.endDate, version: sql`${projects.version} + 1` }).where(eq(projects.id, r.projectId));
  await audit(tx, ctx.actor, { action: 'retainer.renew', entityType: 'retainer', entityId: id, projectId: r.projectId, summary: `Renewed retainer: ${formatMoney(toMinor(input.monthlyFee), 'INR')}/month from ${start} to ${input.endDate}`, new: t });
  await evaluateProjectAlerts(tx, r.projectId);
  return t;
}

export async function cancelRetainer(tx: Executor, ctx: Ctx, id: string, cancelOn: string, reason: string) {
  const { r, terms } = await loadRetainer(tx, id);
  if (r.status === 'CANCELLED') throw conflict('This retainer is already cancelled.', 'INVALID_STATE');
  const first = terms[0].startDate;
  if (cancelOn < first) throw unprocessable('The cancellation date cannot be before the retainer started.', { fields: { cancelOn: 'Before start date' } });
  await tx.update(retainers).set({ status: 'CANCELLED', cancelledOn: cancelOn, updatedAt: new Date() }).where(eq(retainers.id, id));
  // invoices for periods that start after the cancellation date and are not yet issued go away
  await tx.update(invoices).set({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: `Retainer cancelled: ${reason}` }).where(and(eq(invoices.projectId, r.projectId), eq(invoices.status, 'SCHEDULED'), sql`${invoices.periodStart} > ${cancelOn}::date`));
  await audit(tx, ctx.actor, { action: 'retainer.cancel', entityType: 'retainer', entityId: id, projectId: r.projectId, summary: `Cancelled retainer effective ${cancelOn}: ${reason}`, new: { cancelOn, reason } });
  await evaluateProjectAlerts(tx, r.projectId);
  return { id, cancelledOn: cancelOn };
}

export async function setHours(tx: Executor, ctx: Ctx, id: string, monthIn: string, hoursUsed: number, notes?: string | null) {
  const { r, terms } = await loadRetainer(tx, id);
  const month = monthStart(monthIn);
  const covered = terms.some((t) => t.startDate <= addMonths(month, 1) && t.endDate >= month);
  if (!covered) throw unprocessable('That month is outside every term of this retainer.', { fields: { month: 'Outside retainer terms' } });
  const [row] = await tx.insert(retainerPeriods).values({ retainerId: id, month, hoursUsed: String(hoursUsed), notes: notes ?? null })
    .onConflictDoUpdate({ target: [retainerPeriods.retainerId, retainerPeriods.month], set: { hoursUsed: String(hoursUsed), notes: notes ?? null, updatedAt: new Date() } }).returning();
  await audit(tx, ctx.actor, { action: 'retainer.hours', entityType: 'retainer', entityId: id, projectId: r.projectId, summary: `Recorded ${hoursUsed}h used in ${month.slice(0, 7)}`, new: row });
  return row;
}

/** Bill retainer fees (in advance) for every period starting on or before `asOf`. Idempotent (DB-unique on project + period). */
export async function generateRetainerInvoices(tx: Executor, ctx: Ctx, id: string, asOf = todayStr(), dueDays = 15) {
  const { r, terms } = await loadRetainer(tx, id);
  if (r.status === 'CANCELLED' && !r.cancelledOn) return [];
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'retinv:' + id}))`);
  const step = FREQ_MONTHS[r.billingFrequency];
  const tl = terms.map(toTerm);
  const made: { id: string; number: string; periodStart: string; total: string }[] = [];
  const have = new Set((await tx.select({ p: invoices.periodStart }).from(invoices).where(and(eq(invoices.projectId, r.projectId), sql`${invoices.periodStart} is not null`, sql`${invoices.status} <> 'CANCELLED'`))).map((x) => x.p));
  for (const t of tl) {
    const anchor = monthStart(t.startDate);
    for (let k = 0; k < 600; k++) {
      const periodStart = addMonths(anchor, k * step);
      if (cmp(periodStart, t.endDate) > 0 || cmp(periodStart, asOf) > 0) break;
      if (r.cancelledOn && cmp(periodStart, r.cancelledOn) > 0) break;
      if (have.has(periodStart)) continue;
      let subtotal: Minor = 0;
      for (let m = 0; m < step; m++) subtotal += termMonthRevenue(t, addMonths(periodStart, m), r.cancelledOn).revenue;
      if (subtotal <= 0) continue;
      const issue = cmp(periodStart, asOf) > 0 ? asOf : (cmp(t.startDate, periodStart) > 0 ? t.startDate : periodStart);
      const issueDate = cmp(issue, asOf) > 0 ? asOf : issue;
      const inv = await createInvoice(tx, ctx.actor, { projectId: r.projectId, type: 'MONTHLY', status: 'ISSUED', issueDate, dueDate: addDays(issueDate, dueDays), subtotal: fromMinor(subtotal), periodStart, description: `Retainer fee ${periodStart.slice(0, 7)}${step > 1 ? ` (+${step - 1} mo)` : ''}` }, { skipOverInvoiceCheck: true });
      have.add(periodStart);
      made.push({ id: inv.id, number: inv.number, periodStart, total: inv.total });
    }
  }
  return made;
}

/** Invoice the overage (hours beyond the included allowance) of one month. Idempotent per month; amount comes from the recorded hours. */
export async function invoiceOverage(tx: Executor, ctx: Ctx, id: string, monthIn: string, dueDays = 15) {
  const { r, terms } = await loadRetainer(tx, id);
  const month = monthStart(monthIn);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'retovr:' + id}))`);
  const [per] = await tx.select().from(retainerPeriods).where(and(eq(retainerPeriods.retainerId, id), eq(retainerPeriods.month, month))).limit(1);
  const m = retainerMonths(terms.map(toTerm), per ? { [month]: Number(per.hoursUsed) } : {}, r.cancelledOn).find((x) => x.month === month);
  if (!m || m.overageRevenue <= 0) throw unprocessable('There is no overage to invoice for that month. Record the hours used first.', undefined, 'NO_OVERAGE');
  const label = `Retainer overage ${month.slice(0, 7)}`;
  const [dup] = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.projectId, r.projectId), eq(invoices.description, label), sql`${invoices.status} <> 'CANCELLED'`)).limit(1);
  if (dup) throw conflict('The overage for that month has already been invoiced.', 'ALREADY_INVOICED');
  const issueDate = todayStr();
  return createInvoice(tx, ctx.actor, { projectId: r.projectId, type: 'CUSTOM', status: 'ISSUED', issueDate, dueDate: addDays(issueDate, dueDays), subtotal: fromMinor(m.overageRevenue), description: label }, { skipOverInvoiceCheck: true });
}

export async function updateRetainer(tx: Executor, ctx: Ctx, id: string, patch: { accountManagerId?: string | null; notes?: string | null; billingFrequency?: keyof typeof FREQ_MONTHS }) {
  const { r } = await loadRetainer(tx, id);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.accountManagerId !== undefined) set.accountManagerId = patch.accountManagerId;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.billingFrequency) set.billingFrequency = patch.billingFrequency;
  const [row] = await tx.update(retainers).set(set).where(eq(retainers.id, id)).returning();
  await audit(tx, ctx.actor, { action: 'retainer.update', entityType: 'retainer', entityId: id, projectId: r.projectId, summary: 'Updated retainer details', old: r, new: row });
  return row;
}

export type RetainerPhase = 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

export async function listRetainers(user: AuthUser, o: { status?: string; q?: string; page: number; pageSize: number }) {
  const rows = (await db.execute(sql`
    SELECT r.id, r.status, r.billing_frequency, r.cancelled_on, r.project_id, p.code, p.name, p.currency, p.client_id, c.company_name, s.name AS service_name, um.name AS account_manager,
      (SELECT json_agg(json_build_object('fee', ROUND(t.monthly_fee*100)::bigint, 'start', t.start_date, 'end', t.end_date, 'inc', t.included_hours, 'ov', ROUND(t.overage_rate*100)::bigint) ORDER BY t.start_date) FROM retainer_terms t WHERE t.retainer_id = r.id) AS terms
    FROM retainers r JOIN projects p ON p.id = r.project_id JOIN clients c ON c.id = r.client_id JOIN categories s ON s.id = r.service_id LEFT JOIN users um ON um.id = r.account_manager_id
    WHERE ${projectScopeSql(user, 'p')} AND p.archived_at IS NULL
      AND (${o.q ? sql`(p.name ILIKE ${'%' + o.q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'} OR c.company_name ILIKE ${'%' + o.q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'} OR p.code ILIKE ${'%' + o.q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'})` : sql`true`})
    ORDER BY p.code`)).rows as Record<string, unknown>[];
  const today = todayStr();
  const s = await getSettings();
  const seeMoney = user.perms.has('profit.view');
  const all = rows.map((r) => {
    const terms = (r.terms as { fee: number; start: string; end: string; inc: string; ov: number }[]) ?? [];
    const current = terms.find((t) => t.start <= today && t.end >= today) ?? null;
    const lastEnd = terms.reduce((m, t) => (t.end > m ? t.end : m), '0000-00-00');
    const status = r.status as string;
    const phase: RetainerPhase = status === 'CANCELLED' ? 'CANCELLED' : lastEnd < today ? 'EXPIRED' : 'ACTIVE';
    const renewalDate = phase === 'ACTIVE' ? lastEnd : null;
    const daysToRenewal = renewalDate ? Math.round((Date.parse(renewalDate) - Date.parse(today)) / 86400000) : null;
    return {
      id: r.id, projectId: r.project_id, code: r.code, name: r.name, currency: r.currency, clientId: r.client_id, client: r.company_name, service: r.service_name, accountManager: r.account_manager,
      status, phase, billingFrequency: r.billing_frequency, cancelledOn: r.cancelled_on, startDate: terms[0]?.start ?? null, endDate: lastEnd, renewalDate, daysToRenewal,
      renewalDue: daysToRenewal !== null && daysToRenewal <= s.notifications.renewalDays,
      monthlyFee: seeMoney ? (phase === 'ACTIVE' && current ? current.fee : 0) : undefined, includedHours: current ? Number(current.inc) : 0,
    };
  });
  const filtered = all.filter((r) => (!o.status || r.phase === o.status));
  const mrr = seeMoney ? filtered.reduce((a, r) => a + (r.monthlyFee ?? 0), 0) : undefined;
  return { rows: filtered.slice((o.page - 1) * o.pageSize, o.page * o.pageSize), total: filtered.length, mrr, activeCount: filtered.filter((r) => r.phase === 'ACTIVE').length };
}

export async function getRetainerDetail(user: AuthUser, id: string) {
  const { r, terms } = await loadRetainer(db, id);
  const [p] = await db.select().from(projects).where(eq(projects.id, r.projectId)).limit(1);
  if (!p) throw notFound('Retainer');
  const [acc] = await db.select({ ok: sql<number>`1` }).from(projects).where(and(eq(projects.id, r.projectId), sql`${projectScopeSql(user, 'projects')}`)).limit(1);
  if (!acc) throw notFound('Retainer');
  const periods = await db.select().from(retainerPeriods).where(eq(retainerPeriods.retainerId, id));
  const hours: Record<string, number> = {};
  for (const x of periods) hours[x.month] = Number(x.hoursUsed);
  const tl = terms.map(toTerm);
  const months = retainerMonths(tl, hours, r.cancelledOn);
  const tot = retainerTotalRevenue(tl, hours, r.cancelledOn);
  const fin = await loadOne(r.projectId, { thresholds: (await getSettings()).thresholds });
  const [cl] = await db.select({ name: clients.companyName }).from(clients).where(eq(clients.id, r.clientId)).limit(1);
  const [sv] = await db.select({ name: categories.name }).from(categories).where(eq(categories.id, r.serviceId)).limit(1);
  const seeMoney = user.perms.has('profit.view');
  // monthly cost per month (activity basis) for the profitability history
  const costRows = user.perms.has('costs.view') ? (await db.execute(sql`SELECT to_char(date_trunc('month', date),'YYYY-MM-01') AS m, COALESCE(SUM(ROUND(amount*100)),0)::bigint AS c FROM project_costs WHERE project_id=${r.projectId}::uuid AND archived_at IS NULL AND kind='ACTUAL' AND status IN ('APPROVED','PAID') GROUP BY 1`)).rows as { m: string; c: string }[] : [];
  const costBy = new Map(costRows.map((x) => [x.m, Number(x.c)]));
  return {
    retainer: r, project: { id: p.id, code: p.code, name: p.name, currency: p.currency, status: p.status }, client: cl?.name, service: sv?.name,
    terms: terms.map((t) => ({ ...t, monthlyFee: seeMoney ? t.monthlyFee : undefined, overageRate: seeMoney ? t.overageRate : undefined })),
    months: months.map((m) => ({ ...m, baseRevenue: seeMoney ? m.baseRevenue : undefined, overageRevenue: seeMoney ? m.overageRevenue : undefined, revenue: seeMoney ? m.revenue : undefined, cost: costBy.get(m.month) ?? 0, profit: seeMoney ? m.revenue - (costBy.get(m.month) ?? 0) : undefined })),
    totals: seeMoney ? { base: tot.base, overage: tot.overage, total: tot.total } : undefined,
    financials: fin ? toProjectDTO(fin, user) : null,
  };
}
void loadProjectFinancials;
