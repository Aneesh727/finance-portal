/**
 * DB -> engine bridge. One set-based SQL query aggregates every input the pure engine needs for a
 * SET of projects (a page of 25, or the whole 10k portfolio) - no per-project N+1 queries.
 * All money is aggregated in integer paise inside SQL (ROUND(x*100)), so JS never touches floats.
 */
import { sql, type SQL } from 'drizzle-orm';
import { db, type Executor } from '../db';
import { monthStart, todayStr, type DateStr } from '../dates';
import { toMinor, type Minor } from '../money';
import {
  calculateProjectFinancials, convertMinor, DEFAULT_THRESHOLDS,
  type ProjectFinancials, type ProjectStatusT, type ProjectTypeT, type TaxModeT, type Thresholds, type BillingAgg,
} from './engine';
import { retainerTotalRevenue, type TermLike } from './retainer';

export interface ProjectFinRow {
  id: string;
  code: string;
  name: string;
  clientId: string;
  clientName: string;
  serviceId: string;
  serviceName: string;
  type: ProjectTypeT;
  status: ProjectStatusT;
  priority: string;
  currency: string;
  fxRateToBase: number;
  managerId: string | null;
  managerName: string | null;
  startDate: string | null;
  endDate: string | null;
  contractDate: string | null;
  createdAt: string;
  isDemo: boolean;
  archived: boolean;
  version: number;
  budgetMinor: Minor;
  taxMode: TaxModeT;
  taxRatePct: number;
  hourlyRevenue: Minor;
  retainerRevenue: Minor;
  f: ProjectFinancials;
  /** number of open (unpaid) invoices with a passed due date */
  hasOverdue: boolean;
}

export interface LoadOpts {
  /** SQL condition over `projects p` (already parameterised). Default: not archived. */
  where?: SQL;
  order?: SQL;
  limit?: number;
  offset?: number;
  asOf?: DateStr;
  thresholds?: Thresholds;
  exec?: Executor;
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export async function loadProjectFinancials(o: LoadOpts = {}): Promise<ProjectFinRow[]> {
  const exec = o.exec ?? db;
  const asOf = o.asOf ?? todayStr();
  const monthStartStr = monthStart(asOf);
  const th = o.thresholds ?? DEFAULT_THRESHOLDS;
  const where = o.where ?? sql`p.archived_at IS NULL`;
  const order = o.order ?? sql`p.created_at DESC, p.id`;
  const lim = o.limit ? sql`LIMIT ${o.limit}` : sql``;
  const off = o.offset ? sql`OFFSET ${o.offset}` : sql``;

  const res = await exec.execute(sql`
    WITH base AS (
      SELECT p.*, ROW_NUMBER() OVER (ORDER BY ${order}) AS rn FROM projects p WHERE ${where} ORDER BY rn ${lim} ${off}
    ),
    c AS (
      SELECT pc.project_id,
        COALESCE(SUM(ROUND(pc.amount*100)) FILTER (WHERE pc.kind='ACTUAL' AND pc.status IN ('APPROVED','PAID')),0)::bigint AS direct_actual,
        COALESCE(SUM(ROUND(pc.amount*100)) FILTER (WHERE pc.kind='ESTIMATED' AND pc.status NOT IN ('REJECTED','CANCELLED')),0)::bigint AS estimated,
        COALESCE(SUM(ROUND(pc.amount*100)) FILTER (WHERE pc.kind='COMMITTED' AND pc.status='APPROVED'),0)::bigint AS committed,
        COALESCE(SUM(ROUND(pc.amount*100)) FILTER (WHERE pc.kind IN ('ACTUAL','COMMITTED') AND pc.status='PENDING_APPROVAL'),0)::bigint AS pending,
        COALESCE(SUM(ROUND(pc.amount*100)) FILTER (WHERE pc.kind='ACTUAL' AND pc.status='PAID'),0)::bigint AS paid
      FROM project_costs pc
      WHERE pc.archived_at IS NULL AND pc.project_id IN (SELECT id FROM base)
      GROUP BY pc.project_id
    ),
    ra AS (
      SELECT pr.project_id,
        COALESCE(SUM(ROUND(pr.actual_hours*pr.cost_rate*100)) FILTER (WHERE r.type <> 'EMPLOYEE'),0)::bigint AS actual_cost,
        COALESCE(SUM(ROUND(pr.planned_hours*pr.cost_rate*100)) FILTER (WHERE r.type <> 'EMPLOYEE'),0)::bigint AS planned_cost,
        COALESCE(SUM(ROUND(pr.paid_amount*100)) FILTER (WHERE r.type <> 'EMPLOYEE'),0)::bigint AS paid,
        COALESCE(SUM(ROUND(pr.actual_hours*pr.billing_rate*100)),0)::bigint AS hourly_revenue
      FROM project_resources pr JOIN resources r ON r.id = pr.resource_id
      WHERE pr.archived_at IS NULL AND pr.project_id IN (SELECT id FROM base)
      GROUP BY pr.project_id
    ),
    ea AS (
      SELECT a.project_id, COALESCE(SUM(ROUND(a.amount*100)),0)::bigint AS amt
      FROM expense_allocations a JOIN expenses e ON e.id = a.expense_id
      WHERE a.target_type = 'PROJECT' AND e.status = 'APPROVED' AND e.archived_at IS NULL AND a.project_id IN (SELECT id FROM base)
      GROUP BY a.project_id
    ),
    em AS (
      SELECT project_id, COALESCE(SUM(ROUND(amount*100)),0)::bigint AS amt
      FROM employee_allocations
      WHERE project_id IN (SELECT id FROM base) AND month <= ${monthStartStr}::date
      GROUP BY project_id
    ),
    ms AS (
      SELECT project_id, COALESCE(SUM(ROUND(price*100)),0)::bigint AS total FROM milestones
      WHERE archived_at IS NULL AND project_id IN (SELECT id FROM base) GROUP BY project_id
    ),
    adj AS (
      SELECT project_id, COALESCE(SUM(ROUND(amount*100)),0)::bigint AS total FROM project_adjustments
      WHERE archived_at IS NULL AND project_id IN (SELECT id FROM base) GROUP BY project_id
    ),
    inv AS (
      SELECT i.project_id, i.status, i.due_date, i.subtotal, i.tax_amount, i.total,
        COALESCE((SELECT SUM(CASE WHEN py.kind='RECEIPT' THEN py.amount + py.tds_amount ELSE -py.amount END)
                  FROM payments py WHERE py.invoice_id = i.id AND py.voided_at IS NULL), 0) AS settled
      FROM invoices i WHERE i.status <> 'CANCELLED' AND i.project_id IN (SELECT id FROM base)
    ),
    ia AS (
      SELECT project_id,
        COALESCE(SUM(ROUND(subtotal*100)) FILTER (WHERE status='ISSUED'),0)::bigint AS issued_subtotal,
        COALESCE(SUM(ROUND(tax_amount*100)) FILTER (WHERE status='ISSUED'),0)::bigint AS issued_tax,
        COALESCE(SUM(ROUND(total*100)) FILTER (WHERE status='ISSUED'),0)::bigint AS issued_total,
        COALESCE(SUM(ROUND(total*100)) FILTER (WHERE status='SCHEDULED'),0)::bigint AS scheduled_total,
        COALESCE(SUM(GREATEST(ROUND((total-settled)*100),0)) FILTER (WHERE status='ISSUED'),0)::bigint AS outstanding,
        COALESCE(SUM(GREATEST(ROUND((settled-total)*100),0)) FILTER (WHERE status='ISSUED'),0)::bigint AS overpaid,
        COALESCE(SUM(GREATEST(ROUND((total-settled)*100),0)) FILTER (WHERE status='ISSUED' AND due_date < ${asOf}::date),0)::bigint AS overdue,
        COALESCE(MAX(${asOf}::date - due_date) FILTER (WHERE status='ISSUED' AND due_date < ${asOf}::date AND total - settled > 0),0)::int AS oldest_overdue
      FROM inv GROUP BY project_id
    ),
    pay AS (
      SELECT py.project_id,
        COALESCE(SUM(ROUND(py.amount*100)) FILTER (WHERE py.kind='RECEIPT'),0)::bigint AS receipts,
        COALESCE(SUM(ROUND(py.amount*100)) FILTER (WHERE py.kind='REFUND'),0)::bigint AS refunds,
        COALESCE(SUM(ROUND(py.tds_amount*100)) FILTER (WHERE py.kind='RECEIPT'),0)::bigint AS tds,
        COALESCE(SUM(CASE WHEN py.kind='RECEIPT' THEN ROUND((py.amount+py.tds_amount)*100) ELSE -ROUND(py.amount*100) END)
                 FILTER (WHERE py.invoice_id IS NULL OR i.status <> 'ISSUED'),0)::bigint AS unapplied
      FROM payments py LEFT JOIN invoices i ON i.id = py.invoice_id
      WHERE py.voided_at IS NULL AND py.project_id IN (SELECT id FROM base)
      GROUP BY py.project_id
    )
    SELECT b.id, b.code, b.name, b.client_id, cl.company_name AS client_name, b.service_id, cat.name AS service_name,
      b.type, b.status, b.priority, b.currency, b.fx_rate_to_base, b.manager_id, u.name AS manager_name,
      b.start_date, b.end_date, b.contract_date, b.created_at, b.is_demo, (b.archived_at IS NOT NULL) AS archived, b.version,
      b.tax_mode, b.tax_rate_pct,
      (ROUND(b.selling_price*100))::bigint AS selling_price, (ROUND(b.discount*100))::bigint AS discount,
      (ROUND(b.setup_fee*100))::bigint AS setup_fee, (ROUND(b.monthly_fee*100))::bigint AS monthly_fee, b.duration_months,
      (ROUND(b.budget*100))::bigint AS budget,
      COALESCE(c.direct_actual,0) AS direct_actual, COALESCE(c.estimated,0) AS estimated, COALESCE(c.committed,0) AS committed,
      COALESCE(c.pending,0) AS pending, COALESCE(c.paid,0) AS paid_direct,
      COALESCE(ra.actual_cost,0) AS ra_actual, COALESCE(ra.planned_cost,0) AS ra_planned, COALESCE(ra.paid,0) AS ra_paid,
      COALESCE(ra.hourly_revenue,0) AS hourly_revenue,
      COALESCE(ea.amt,0) AS ea_amt, COALESCE(em.amt,0) AS em_amt,
      COALESCE(ms.total,0) AS milestones_total, COALESCE(adj.total,0) AS adjustments,
      COALESCE(ia.issued_subtotal,0) AS issued_subtotal, COALESCE(ia.issued_tax,0) AS issued_tax, COALESCE(ia.issued_total,0) AS issued_total,
      COALESCE(ia.scheduled_total,0) AS scheduled_total, COALESCE(ia.outstanding,0) AS inv_outstanding, COALESCE(ia.overpaid,0) AS inv_overpaid,
      COALESCE(ia.overdue,0) AS overdue, COALESCE(ia.oldest_overdue,0) AS oldest_overdue,
      COALESCE(pay.receipts,0) AS receipts, COALESCE(pay.refunds,0) AS refunds, COALESCE(pay.tds,0) AS tds, GREATEST(COALESCE(pay.unapplied,0),0) AS unapplied
    FROM base b
    JOIN clients cl ON cl.id = b.client_id
    JOIN categories cat ON cat.id = b.service_id
    LEFT JOIN users u ON u.id = b.manager_id
    LEFT JOIN c ON c.project_id = b.id
    LEFT JOIN ra ON ra.project_id = b.id
    LEFT JOIN ea ON ea.project_id = b.id
    LEFT JOIN em ON em.project_id = b.id
    LEFT JOIN ms ON ms.project_id = b.id
    LEFT JOIN adj ON adj.project_id = b.id
    LEFT JOIN ia ON ia.project_id = b.id
    LEFT JOIN pay ON pay.project_id = b.id
    ORDER BY b.rn
  `);
  return finish(res.rows as Record<string, unknown>[], th, exec, o);
}

async function finish(rows: Record<string, unknown>[], th: Thresholds, exec: Executor, o: LoadOpts): Promise<ProjectFinRow[]> {
  // retainer revenue needs term/period maths -> second (small) query for RETAINER projects only
  const retainerIds = rows.filter((r) => r.type === 'RETAINER').map((r) => r.id as string);
  const retainerRevenue = new Map<string, Minor>();
  if (retainerIds.length) {
    const idList = sql.join(retainerIds.map((id) => sql`${id}::uuid`), sql`, `);
    const terms = await exec.execute(sql`
      SELECT r.project_id, r.cancelled_on, t.start_date, t.end_date, ROUND(t.monthly_fee*100)::bigint AS fee, t.included_hours, ROUND(t.overage_rate*100)::bigint AS overage_rate
      FROM retainers r JOIN retainer_terms t ON t.retainer_id = r.id WHERE r.project_id IN (${idList})`);
    const periods = await exec.execute(sql`
      SELECT r.project_id, p.month, p.hours_used FROM retainers r JOIN retainer_periods p ON p.retainer_id = r.id WHERE r.project_id IN (${idList})`);
    const tByP = new Map<string, { cancelledOn: string | null; terms: TermLike[] }>();
    for (const t of terms.rows as Record<string, unknown>[]) {
      const k = t.project_id as string;
      const e = tByP.get(k) ?? { cancelledOn: (t.cancelled_on as string) ?? null, terms: [] };
      e.terms.push({ monthlyFee: n(t.fee), startDate: t.start_date as string, endDate: t.end_date as string, includedHours: Number(t.included_hours), overageRate: n(t.overage_rate) });
      tByP.set(k, e);
    }
    const hByP = new Map<string, Record<string, number>>();
    for (const p of periods.rows as Record<string, unknown>[]) {
      const k = p.project_id as string;
      const e = hByP.get(k) ?? {};
      e[p.month as string] = Number(p.hours_used);
      hByP.set(k, e);
    }
    for (const [pid, e] of tByP) retainerRevenue.set(pid, retainerTotalRevenue(e.terms, hByP.get(pid) ?? {}, e.cancelledOn).total);
  }

  const out: ProjectFinRow[] = rows.map((r) => {
    const status = r.status as ProjectStatusT;
    const type = r.type as ProjectTypeT;
    const directActual = n(r.direct_actual);
    const billing: BillingAgg = {
      issuedSubtotal: n(r.issued_subtotal), issuedTax: n(r.issued_tax), issuedTotal: n(r.issued_total), scheduledTotal: n(r.scheduled_total),
      invoiceOutstanding: n(r.inv_outstanding), invoiceOverpaid: n(r.inv_overpaid), overdueOutstanding: n(r.overdue), oldestOverdueDays: n(r.oldest_overdue),
      receipts: n(r.receipts), refunds: n(r.refunds), tds: n(r.tds), unapplied: n(r.unapplied),
    };
    const f = calculateProjectFinancials({
      revenue: {
        type, status, sellingPrice: n(r.selling_price), discount: n(r.discount), taxMode: r.tax_mode as TaxModeT, taxRatePct: Number(r.tax_rate_pct),
        setupFee: n(r.setup_fee), monthlyFee: n(r.monthly_fee), durationMonths: n(r.duration_months), milestonesTotal: n(r.milestones_total),
        hourlyRevenue: n(r.hourly_revenue), retainerRevenue: retainerRevenue.get(r.id as string) ?? 0, adjustments: n(r.adjustments), invoicedSubtotal: billing.issuedSubtotal,
      },
      cost: {
        directActual, expenseAllocations: n(r.ea_amt), employeeAllocations: n(r.em_amt), resourceAssignments: n(r.ra_actual),
        estimated: n(r.estimated) + n(r.ra_planned), committed: n(r.committed), pendingApproval: n(r.pending),
        paid: n(r.paid_direct) + n(r.ra_paid) + n(r.ea_amt) + n(r.em_amt),
      },
      billing,
      budget: n(r.budget),
      thresholds: th,
    });
    return {
      id: r.id as string, code: r.code as string, name: r.name as string,
      clientId: r.client_id as string, clientName: r.client_name as string,
      serviceId: r.service_id as string, serviceName: r.service_name as string,
      type, status, priority: r.priority as string, currency: r.currency as string, fxRateToBase: Number(r.fx_rate_to_base),
      managerId: (r.manager_id as string) ?? null, managerName: (r.manager_name as string) ?? null,
      startDate: (r.start_date as string) ?? null, endDate: (r.end_date as string) ?? null, contractDate: (r.contract_date as string) ?? null,
      createdAt: new Date(r.created_at as string).toISOString(), isDemo: !!r.is_demo, archived: !!r.archived, version: n(r.version),
      budgetMinor: n(r.budget), taxMode: r.tax_mode as TaxModeT, taxRatePct: Number(r.tax_rate_pct),
      hourlyRevenue: n(r.hourly_revenue), retainerRevenue: retainerRevenue.get(r.id as string) ?? 0,
      f, hasOverdue: billing.overdueOutstanding > 0,
    };
  });
  void o;
  return out;
}

export async function loadOne(id: string, o: Omit<LoadOpts, 'where' | 'limit' | 'offset'> = {}): Promise<ProjectFinRow | null> {
  const rows = await loadProjectFinancials({ ...o, where: sql`p.id = ${id}::uuid` });
  return rows[0] ?? null;
}

// ───────────────────────────── role-based redaction ─────────────────────────────

import type { AuthUser } from '../auth';

/**
 * Flat DTO returned by the API. Money in `fin` is INTEGER MINOR UNITS (paise). Sensitive blocks are
 * omitted entirely (not zeroed) when the caller lacks the permission.
 */
/**
 * Project health without leaking profit data: health rules look at margin and overdue receivables, so anyone without
 * `profit.view` only gets the budget-derived part of it (they can already see budget and cost).
 */
export function healthFor(f: ProjectFinRow['f'], user: AuthUser): { status: string; reasons: string[] } | undefined {
  if (user.perms.has('profit.view')) return f.health;
  if (!user.perms.has('costs.view')) return undefined;
  if (f.health.status === 'NA') return { status: 'NA', reasons: [] };
  const st = f.budget.state;
  if (st === 'EXCEEDED') return { status: 'CRITICAL', reasons: ['Budget exceeded'] };
  if (st === 'ALERT') return { status: 'ATTENTION', reasons: ['Budget fully used'] };
  if (st === 'WARNING') return { status: 'ATTENTION', reasons: [`Budget ${f.budget.utilizationPct?.toFixed(0)}% used`] };
  return { status: 'HEALTHY', reasons: [] };
}

export function toProjectDTO(r: ProjectFinRow, user: AuthUser) {
  const seeProfit = user.perms.has('profit.view');
  const seeCost = user.perms.has('costs.view');
  const f = r.f;
  return {
    id: r.id, code: r.code, name: r.name, type: r.type, status: r.status, priority: r.priority, currency: r.currency,
    client: { id: r.clientId, name: r.clientName }, service: { id: r.serviceId, name: r.serviceName },
    manager: r.managerId ? { id: r.managerId, name: r.managerName } : null,
    startDate: r.startDate, endDate: r.endDate, contractDate: r.contractDate, createdAt: r.createdAt, isDemo: r.isDemo, archived: r.archived, version: r.version,
    health: healthFor(f, user),
    revenue: seeProfit ? { contractValue: f.revenue.contractValue, revenue: f.revenue.revenue, tax: f.revenue.tax, total: f.revenue.totalIncludingTax, discount: f.revenue.discount } : undefined,
    profit: seeProfit
      ? {
          estimated: f.estimatedProfit, actual: f.actualProfit, projected: f.projectedProfit,
          grossMarginPct: f.grossMarginPct, projectedMarginPct: f.projectedMarginPct, estimatedMarginPct: f.estimatedMarginPct,
        }
      : undefined,
    receivables: seeProfit
      ? { invoiced: f.receivables.invoiced, received: f.receivables.received, tds: f.receivables.tds, outstanding: f.receivables.outstanding, overdue: f.receivables.overdue, upcoming: f.receivables.upcoming, creditBalance: f.receivables.creditBalance, collectionPct: f.receivables.collectionPct }
      : undefined,
    cash: seeProfit ? f.cash : undefined,
    cost: seeCost ? { estimated: f.cost.estimated, actual: f.cost.actual, committed: f.cost.committed, projected: f.cost.projected, pendingApproval: f.cost.pendingApproval, paid: f.cost.paid, unpaid: f.cost.unpaid } : undefined,
    budget: seeCost ? f.budget : undefined,
    amountsIn: 'minor_units',
  };
}
export type ProjectDTO = ReturnType<typeof toProjectDTO>;

/** convert a project-currency minor amount to the company base currency */
export function toBase(minor: Minor, fxRateToBase: number): Minor {
  return fxRateToBase === 1 ? minor : convertMinor(minor, fxRateToBase);
}

export { toMinor };
