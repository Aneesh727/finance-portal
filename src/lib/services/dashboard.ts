/** Executive dashboard + shared portfolio aggregation (all money in company base currency, integer paise). */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import type { AuthUser } from '@/lib/auth';
import { projectScopeSql } from '@/lib/access';
import { healthFor, loadProjectFinancials, toBase, type ProjectFinRow } from '@/lib/finance/loaders';
import { RECOGNISED_STATUSES, OPEN_STATUSES } from '@/lib/finance/engine';
import { ratioPct } from '@/lib/money';
import { addMonths, monthStart, todayStr } from '@/lib/dates';
import { getSettings } from '@/lib/settings';

export interface Portfolio {
  rows: ProjectFinRow[];
  totals: { revenue: number; cost: number; actualProfit: number; projectedCost: number; projectedProfit: number; budget: number; invoiced: number; received: number; outstanding: number; overdue: number; cashPosition: number };
}

const n = (v: unknown) => Number(v ?? 0);

/** every accessible, non-archived project (up to a hard cap) with its computed financials */
export async function loadPortfolio(user: AuthUser, o: { includeArchived?: boolean; extra?: ReturnType<typeof sql> } = {}): Promise<Portfolio> {
  const s = await getSettings();
  const rows = await loadProjectFinancials({
    thresholds: s.thresholds,
    where: sql`${o.includeArchived ? sql`true` : sql`p.archived_at IS NULL`} AND ${projectScopeSql(user, 'p')} ${o.extra ? sql`AND ${o.extra}` : sql``}`,
    limit: 50000,
  });
  const t = { revenue: 0, cost: 0, actualProfit: 0, projectedCost: 0, projectedProfit: 0, budget: 0, invoiced: 0, received: 0, outstanding: 0, overdue: 0, cashPosition: 0 };
  for (const r of rows) {
    if (!RECOGNISED_STATUSES.includes(r.status)) continue;
    const b = (x: number) => toBase(x, r.fxRateToBase);
    t.revenue += b(r.f.revenue.revenue);
    t.cost += b(r.f.cost.actual);
    t.actualProfit += b(r.f.actualProfit);
    t.projectedCost += b(r.f.cost.projected);
    t.projectedProfit += b(r.f.projectedProfit);
    t.budget += b(r.budgetMinor);
    t.invoiced += b(r.f.receivables.invoiced);
    t.received += b(r.f.receivables.received);
    t.outstanding += b(r.f.receivables.outstanding);
    t.overdue += b(r.f.receivables.overdue);
    t.cashPosition += b(r.f.cash.cashPosition);
  }
  return { rows, totals: t };
}

export async function getDashboard(user: AuthUser, o: { from?: string; to?: string } = {}) {
  const seeProfit = user.perms.has('profit.view');
  const seeCost = user.perms.has('costs.view');
  const today = todayStr();
  const to = o.to ?? today;
  const from = o.from ?? addMonths(monthStart(to), -11);
  const scope = projectScopeSql(user, 'p');
  const pf = await loadPortfolio(user);
  const { rows, totals } = pf;
  const recognised = rows.filter((r) => RECOGNISED_STATUSES.includes(r.status));
  const open = rows.filter((r) => OPEN_STATUSES.includes(r.status));
  const b = (r: ProjectFinRow, x: number) => toBase(x, r.fxRateToBase);

  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const health: Record<string, number> = { HEALTHY: 0, ATTENTION: 0, CRITICAL: 0, NA: 0 };
  for (const r of open) { const h = healthFor(r.f, user)?.status ?? 'NA'; health[h] = (health[h] ?? 0) + 1; }

  // service breakdown
  const svc = new Map<string, { service: string; projects: number; revenue: number; cost: number; profit: number }>();
  for (const r of recognised) {
    const e = svc.get(r.serviceId) ?? { service: r.serviceName, projects: 0, revenue: 0, cost: 0, profit: 0 };
    e.projects++; e.revenue += b(r, r.f.revenue.revenue); e.cost += b(r, r.f.cost.actual); e.profit += b(r, r.f.actualProfit);
    svc.set(r.serviceId, e);
  }

  const dto = (r: ProjectFinRow) => ({
    id: r.id, code: r.code, name: r.name, client: r.clientName, status: r.status, currency: r.currency, health: healthFor(r.f, user)?.status,
    revenue: seeProfit ? b(r, r.f.revenue.revenue) : undefined, profit: seeProfit ? b(r, r.f.actualProfit) : undefined, marginPct: seeProfit ? r.f.grossMarginPct : undefined,
    projectedMarginPct: seeProfit ? r.f.projectedMarginPct : undefined,
    budgetUtilizationPct: seeCost ? r.f.budget.utilizationPct : undefined, overBy: seeCost ? b(r, r.f.budget.overBy) : undefined,
  });
  const withRev = recognised.filter((r) => r.f.revenue.revenue > 0);

  // time series (activity basis; hourly assignments carry no date so they are not in the series)
  const series = (await db.execute(sql`
    WITH months AS (SELECT to_char(g, 'YYYY-MM-01') AS m FROM generate_series(date_trunc('month', ${from}::date), date_trunc('month', ${to}::date), interval '1 month') g),
    rev AS (SELECT to_char(date_trunc('month', i.issue_date),'YYYY-MM-01') AS m, SUM(ROUND(i.subtotal*100*p.fx_rate_to_base)) AS v FROM invoices i JOIN projects p ON p.id = i.project_id
            WHERE i.status='ISSUED' AND i.issue_date BETWEEN ${from}::date AND ${to}::date AND ${scope} GROUP BY 1),
    cost AS (SELECT to_char(date_trunc('month', c.date),'YYYY-MM-01') AS m, SUM(ROUND(c.amount*100*p.fx_rate_to_base)) AS v FROM project_costs c JOIN projects p ON p.id = c.project_id
            WHERE c.kind='ACTUAL' AND c.status IN ('APPROVED','PAID') AND c.archived_at IS NULL AND c.date BETWEEN ${from}::date AND ${to}::date AND ${scope} GROUP BY 1),
    emp AS (SELECT to_char(a.month,'YYYY-MM-01') AS m, SUM(ROUND(a.amount*100*p.fx_rate_to_base)) AS v FROM employee_allocations a JOIN projects p ON p.id = a.project_id
            WHERE a.month BETWEEN date_trunc('month', ${from}::date) AND ${to}::date AND ${scope} GROUP BY 1),
    over AS (SELECT to_char(date_trunc('month', e.date),'YYYY-MM-01') AS m,
               SUM(ROUND(e.amount*100) - COALESCE((SELECT SUM(ROUND(a.amount*100)) FROM expense_allocations a WHERE a.expense_id = e.id AND a.target_type='PROJECT'),0)) AS v
             FROM expenses e WHERE e.scope <> 'PROJECT' AND e.status='APPROVED' AND e.archived_at IS NULL AND e.date BETWEEN ${from}::date AND ${to}::date GROUP BY 1),
    cash AS (SELECT to_char(date_trunc('month', y.received_date),'YYYY-MM-01') AS m, SUM(CASE WHEN y.kind='RECEIPT' THEN 1 ELSE -1 END * ROUND(y.amount*100*p.fx_rate_to_base)) AS v FROM payments y JOIN projects p ON p.id = y.project_id
            WHERE y.voided_at IS NULL AND y.received_date BETWEEN ${from}::date AND ${to}::date AND ${scope} GROUP BY 1)
    SELECT months.m, COALESCE(rev.v,0)::bigint AS revenue, (COALESCE(cost.v,0) + COALESCE(emp.v,0))::bigint AS cost, COALESCE(over.v,0)::bigint AS overhead, COALESCE(cash.v,0)::bigint AS cash
    FROM months LEFT JOIN rev USING (m) LEFT JOIN cost USING (m) LEFT JOIN emp USING (m) LEFT JOIN over USING (m) LEFT JOIN cash USING (m) ORDER BY months.m`)).rows as { m: string; revenue: string; cost: string; overhead: string; cash: string }[];

  const catRows = seeCost ? (await db.execute(sql`
    SELECT cat.name, SUM(ROUND(c.amount*100*p.fx_rate_to_base))::bigint AS v FROM project_costs c JOIN projects p ON p.id = c.project_id JOIN categories cat ON cat.id = c.category_id
    WHERE c.kind='ACTUAL' AND c.status IN ('APPROVED','PAID') AND c.archived_at IS NULL AND p.archived_at IS NULL AND ${scope} GROUP BY cat.name ORDER BY v DESC LIMIT 12`)).rows as { name: string; v: string }[] : [];

  const overdueInv = seeProfit ? (await db.execute(sql`
    SELECT i.id, i.number, i.due_date, p.code, p.name AS project, c.company_name AS client, p.currency,
           ROUND((i.total - COALESCE((SELECT SUM(CASE WHEN y.kind='RECEIPT' THEN y.amount + y.tds_amount ELSE -y.amount END) FROM payments y WHERE y.invoice_id = i.id AND y.voided_at IS NULL),0))*100)::bigint AS outstanding
    FROM invoices i JOIN projects p ON p.id = i.project_id JOIN clients c ON c.id = p.client_id
    WHERE i.status='ISSUED' AND i.due_date < ${today}::date AND ${scope}
      AND i.total > COALESCE((SELECT SUM(CASE WHEN y.kind='RECEIPT' THEN y.amount + y.tds_amount ELSE -y.amount END) FROM payments y WHERE y.invoice_id = i.id AND y.voided_at IS NULL),0)
    ORDER BY i.due_date LIMIT 8`)).rows as { id: string; number: string; due_date: string; code: string; project: string; client: string; currency: string; outstanding: string }[] : [];

  const s = await getSettings();
  const renewals = user.perms.has('retainers.view') ? (await db.execute(sql`
    SELECT r.id, p.code, p.name, t.end_date, t.monthly_fee FROM retainers r JOIN projects p ON p.id = r.project_id
    JOIN LATERAL (SELECT end_date, monthly_fee FROM retainer_terms WHERE retainer_id = r.id ORDER BY end_date DESC LIMIT 1) t ON true
    WHERE r.status='ACTIVE' AND t.end_date BETWEEN ${today}::date AND (${today}::date + ${s.notifications.renewalDays}::int) AND ${scope} ORDER BY t.end_date LIMIT 8`)).rows as { id: string; code: string; name: string; end_date: string; monthly_fee: string }[] : [];
  const [pend] = user.perms.has('approvals.decide') ? (await db.execute(sql`SELECT count(*)::int AS n FROM approvals WHERE status='PENDING'`)).rows as { n: number }[] : [{ n: 0 }];

  const periodRevenue = series.reduce((a, x) => a + n(x.revenue), 0);
  const periodCost = series.reduce((a, x) => a + n(x.cost), 0);
  const periodOverhead = series.reduce((a, x) => a + n(x.overhead), 0);

  return {
    range: { from, to },
    counts: { total: rows.length, active: byStatus.ACTIVE ?? 0, byStatus, overBudget: open.filter((r) => r.f.budget.state === 'EXCEEDED').length, pendingApprovals: pend?.n ?? 0 },
    kpis: {
      revenue: seeProfit ? totals.revenue : undefined,
      cost: seeCost ? totals.cost : undefined,
      grossProfit: seeProfit ? totals.actualProfit : undefined,
      marginPct: seeProfit ? ratioPct(totals.actualProfit, totals.revenue) : undefined,
      projectedProfit: seeProfit ? totals.projectedProfit : undefined,
      projectedMarginPct: seeProfit ? ratioPct(totals.projectedProfit, totals.revenue) : undefined,
      budget: seeCost ? totals.budget : undefined,
      budgetUsedPct: seeCost ? ratioPct(totals.cost, totals.budget) : undefined,
      invoiced: seeProfit ? totals.invoiced : undefined,
      received: seeProfit ? totals.received : undefined,
      outstanding: seeProfit ? totals.outstanding : undefined,
      overdue: seeProfit ? totals.overdue : undefined,
      cashPosition: seeProfit ? totals.cashPosition : undefined,
      collectionPct: seeProfit ? ratioPct(totals.received, totals.invoiced) : undefined,
    },
    period: seeProfit && seeCost ? { revenue: periodRevenue, directCost: periodCost, overhead: periodOverhead, grossProfit: periodRevenue - periodCost, netProfit: periodRevenue - periodCost - periodOverhead } : undefined,
    series: series.map((x) => ({ month: x.m, revenue: seeProfit ? n(x.revenue) : undefined, cost: seeCost ? n(x.cost) : undefined, overhead: seeCost ? n(x.overhead) : undefined, cash: seeProfit ? n(x.cash) : undefined, profit: seeProfit && seeCost ? n(x.revenue) - n(x.cost) : undefined })),
    costByCategory: catRows.map((c) => ({ name: c.name, value: n(c.v) })),
    byService: seeProfit ? [...svc.values()].sort((a, c) => c.revenue - a.revenue).map((x) => ({ ...x, marginPct: ratioPct(x.profit, x.revenue) })) : [],
    health,
    topProfitable: seeProfit ? [...withRev].sort((a, c) => b(c, c.f.actualProfit) - b(a, a.f.actualProfit)).slice(0, 5).map(dto) : [],
    lowestMargin: seeProfit ? [...withRev].sort((a, c) => (a.f.grossMarginPct ?? 1e9) - (c.f.grossMarginPct ?? 1e9)).slice(0, 5).map(dto) : [],
    overBudget: seeCost ? open.filter((r) => r.f.budget.state === 'EXCEEDED').sort((a, c) => b(c, c.f.budget.overBy) - b(a, a.f.budget.overBy)).slice(0, 8).map(dto) : [],
    atRisk: open.filter((r) => ['ATTENTION', 'CRITICAL'].includes(healthFor(r.f, user)?.status ?? '')).slice(0, 8).map((r) => ({ ...dto(r), reasons: healthFor(r.f, user)?.reasons ?? [] })),
    overdueInvoices: overdueInv.map((x) => ({ id: x.id, number: x.number, dueDate: x.due_date, code: x.code, project: x.project, client: x.client, currency: x.currency, outstanding: n(x.outstanding) })),
    renewals: renewals.map((x) => ({ id: x.id, code: x.code, name: x.name, endDate: x.end_date, monthlyFee: seeProfit ? Math.round(Number(x.monthly_fee) * 100) : undefined })),
  };
}
