/** Portfolio reports: profitability groupings, project comparison, forecast, receivables ageing, company P&L. */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import type { AuthUser } from '@/lib/auth';
import { projectScopeSql } from '@/lib/access';
import { healthFor, toBase, loadProjectFinancials, type ProjectFinRow } from '@/lib/finance/loaders';
import { RECOGNISED_STATUSES } from '@/lib/finance/engine';
import { ratioPct, toMinor } from '@/lib/money';
import { addMonths, monthStart, monthsBetween, todayStr, addDays } from '@/lib/dates';
import { occurrences, frequencyToMonths } from '@/lib/finance/recurring';
import { retainerMonths, type TermLike } from '@/lib/finance/retainer';
import { getSettings } from '@/lib/settings';
import { loadPortfolio } from './dashboard';
import { monthlyCostFor } from './employee-alloc';
import { badRequest } from '@/lib/errors';

const n = (v: unknown) => Number(v ?? 0);

// ───────────── profitability by dimension ─────────────
export type GroupBy = 'service' | 'client' | 'type' | 'manager' | 'status';

export async function profitabilityBy(user: AuthUser, group: GroupBy, o: { from?: string; to?: string } = {}) {
  const pf = await loadPortfolio(user, { extra: o.from || o.to ? sql`COALESCE(p.start_date, p.created_at::date) BETWEEN ${o.from ?? '1900-01-01'}::date AND ${o.to ?? '2999-12-31'}::date` : undefined });
  const map = new Map<string, { key: string; label: string; projects: number; revenue: number; cost: number; profit: number; projectedProfit: number; budget: number; overBudget: number }>();
  for (const r of pf.rows) {
    if (!RECOGNISED_STATUSES.includes(r.status)) continue;
    const [key, label] = ({ service: [r.serviceId, r.serviceName], client: [r.clientId, r.clientName], type: [r.type, r.type], manager: [r.managerId ?? 'none', r.managerName ?? 'Unassigned'], status: [r.status, r.status] } as Record<GroupBy, [string, string]>)[group];
    const e = map.get(key) ?? { key, label, projects: 0, revenue: 0, cost: 0, profit: 0, projectedProfit: 0, budget: 0, overBudget: 0 };
    const b = (x: number) => toBase(x, r.fxRateToBase);
    e.projects++; e.revenue += b(r.f.revenue.revenue); e.cost += b(r.f.cost.actual); e.profit += b(r.f.actualProfit); e.projectedProfit += b(r.f.projectedProfit); e.budget += b(r.budgetMinor);
    if (r.f.budget.state === 'EXCEEDED') e.overBudget++;
    map.set(key, e);
  }
  const rows = [...map.values()].map((e) => ({ ...e, marginPct: ratioPct(e.profit, e.revenue), avgRevenue: e.projects ? Math.round(e.revenue / e.projects) : 0 })).sort((a, c) => c.profit - a.profit);
  const tot = rows.reduce((a, r) => ({ projects: a.projects + r.projects, revenue: a.revenue + r.revenue, cost: a.cost + r.cost, profit: a.profit + r.profit }), { projects: 0, revenue: 0, cost: 0, profit: 0 });
  return { group, rows, totals: { ...tot, marginPct: ratioPct(tot.profit, tot.revenue) }, best: rows[0]?.label ?? null, worst: rows.length > 1 ? rows[rows.length - 1].label : null };
}

// ───────────── comparison ─────────────
export async function compareProjects(user: AuthUser, ids: string[]) {
  if (ids.length < 2) throw badRequest('Select at least two projects to compare.');
  if (ids.length > 6) throw badRequest('You can compare up to six projects at a time.');
  const s = await getSettings();
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const rows = await loadProjectFinancials({ thresholds: s.thresholds, where: sql`p.id IN (${list}) AND ${projectScopeSql(user, 'p')}` });
  if (rows.length !== ids.length) throw badRequest('One or more selected projects were not found.', undefined, 'NOT_FOUND');
  const seeProfit = user.perms.has('profit.view'), seeCost = user.perms.has('costs.view');
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!).map((r) => ({
    id: r.id, code: r.code, name: r.name, client: r.clientName, service: r.serviceName, type: r.type, status: r.status, currency: r.currency, startDate: r.startDate, endDate: r.endDate,
    revenue: seeProfit ? r.f.revenue.revenue : undefined, estimatedCost: seeCost ? r.f.cost.estimated : undefined, actualCost: seeCost ? r.f.cost.actual : undefined, projectedCost: seeCost ? r.f.cost.projected : undefined,
    estimatedProfit: seeProfit ? r.f.estimatedProfit : undefined, actualProfit: seeProfit ? r.f.actualProfit : undefined, projectedProfit: seeProfit ? r.f.projectedProfit : undefined,
    marginPct: seeProfit ? r.f.grossMarginPct : undefined, projectedMarginPct: seeProfit ? r.f.projectedMarginPct : undefined,
    budget: seeCost ? r.f.budget.budget : undefined, budgetUtilizationPct: seeCost ? r.f.budget.utilizationPct : undefined, budgetState: seeCost ? r.f.budget.state : undefined,
    outstanding: seeProfit ? r.f.receivables.outstanding : undefined, collectionPct: seeProfit ? r.f.receivables.collectionPct : undefined,
    health: healthFor(r.f, user)?.status,
  }));
}

// ───────────── receivables ─────────────
export async function receivablesReport(user: AuthUser, asOf = todayStr()) {
  const scope = projectScopeSql(user, 'p');
  const rows = (await db.execute(sql`
    WITH open AS (
      SELECT i.id, i.number, i.due_date, i.issue_date, p.id AS project_id, p.code, p.name AS project, p.currency, p.fx_rate_to_base, c.id AS client_id, c.company_name AS client,
        ROUND(i.total*100) AS total,
        ROUND((i.total - COALESCE((SELECT SUM(CASE WHEN y.kind='RECEIPT' THEN y.amount + y.tds_amount ELSE -y.amount END) FROM payments y WHERE y.invoice_id = i.id AND y.voided_at IS NULL),0))*100) AS outstanding
      FROM invoices i JOIN projects p ON p.id = i.project_id JOIN clients c ON c.id = p.client_id WHERE i.status='ISSUED' AND ${scope})
    SELECT *, (${asOf}::date - due_date) AS days_overdue FROM open WHERE outstanding > 0 ORDER BY due_date`)).rows as Record<string, unknown>[];
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  const byClient = new Map<string, { clientId: string; client: string; outstanding: number; overdue: number; invoices: number }>();
  const list = rows.map((r) => {
    const out = Math.round(n(r.outstanding) * n(r.fx_rate_to_base));
    const d = n(r.days_overdue);
    if (d <= 0) buckets.current += out; else if (d <= 30) buckets.d1_30 += out; else if (d <= 60) buckets.d31_60 += out; else if (d <= 90) buckets.d61_90 += out; else buckets.d90plus += out;
    const c = byClient.get(r.client_id as string) ?? { clientId: r.client_id as string, client: r.client as string, outstanding: 0, overdue: 0, invoices: 0 };
    c.outstanding += out; c.invoices++; if (d > 0) c.overdue += out;
    byClient.set(r.client_id as string, c);
    return { id: r.id, number: r.number, dueDate: r.due_date, issueDate: r.issue_date, projectId: r.project_id, code: r.code, project: r.project, client: r.client, currency: r.currency, total: n(r.total), outstanding: n(r.outstanding), outstandingBase: out, daysOverdue: Math.max(0, d) };
  });
  const totalOutstanding = Object.values(buckets).reduce((a, b) => a + b, 0);
  return { asOf, totalOutstanding, overdue: totalOutstanding - buckets.current, buckets, byClient: [...byClient.values()].sort((a, b) => b.outstanding - a.outstanding), invoices: list };
}

// ───────────── company P&L ─────────────
export async function companyPnl(user: AuthUser, from: string, to: string) {
  if (to < from) throw badRequest('The end date cannot be before the start date.');
  const scope = projectScopeSql(user, 'p');
  const months = monthsBetween(from, to);
  if (months.length > 60) throw badRequest('Choose a range of at most 60 months.');
  const q = (await db.execute(sql`
    WITH rev AS (SELECT to_char(date_trunc('month', i.issue_date),'YYYY-MM-01') AS m, SUM(ROUND(i.subtotal*100*p.fx_rate_to_base)) AS v FROM invoices i JOIN projects p ON p.id = i.project_id
                 WHERE i.status='ISSUED' AND i.issue_date BETWEEN ${from}::date AND ${to}::date AND ${scope} GROUP BY 1),
    pc AS (SELECT to_char(date_trunc('month', c.date),'YYYY-MM-01') AS m, SUM(ROUND(c.amount*100*p.fx_rate_to_base)) AS v FROM project_costs c JOIN projects p ON p.id = c.project_id
           WHERE c.kind='ACTUAL' AND c.status IN ('APPROVED','PAID') AND c.archived_at IS NULL AND c.date BETWEEN ${from}::date AND ${to}::date AND ${scope} GROUP BY 1),
    ex AS (SELECT to_char(date_trunc('month', e.date),'YYYY-MM-01') AS m, SUM(ROUND(e.amount*100)) AS v FROM expenses e
           WHERE e.scope <> 'PROJECT' AND e.status='APPROVED' AND e.archived_at IS NULL AND e.date BETWEEN ${from}::date AND ${to}::date GROUP BY 1),
    ea AS (SELECT to_char(date_trunc('month', e.date),'YYYY-MM-01') AS m, SUM(ROUND(a.amount*100)) AS v FROM expense_allocations a JOIN expenses e ON e.id = a.expense_id
           WHERE a.target_type='PROJECT' AND e.status='APPROVED' AND e.archived_at IS NULL AND e.date BETWEEN ${from}::date AND ${to}::date GROUP BY 1),
    ema AS (SELECT to_char(a.month,'YYYY-MM-01') AS m, SUM(ROUND(a.amount*100)) AS v FROM employee_allocations a WHERE a.project_id IS NOT NULL AND a.month BETWEEN date_trunc('month', ${from}::date) AND ${to}::date GROUP BY 1)
    SELECT COALESCE(rev.m, pc.m, ex.m, ea.m, ema.m) AS m, COALESCE(rev.v,0)::bigint AS revenue, COALESCE(pc.v,0)::bigint AS project_cost, COALESCE(ex.v,0)::bigint AS company_expenses, COALESCE(ea.v,0)::bigint AS allocated_expenses, COALESCE(ema.v,0)::bigint AS allocated_payroll
    FROM rev FULL JOIN pc USING (m) FULL JOIN ex USING (m) FULL JOIN ea USING (m) FULL JOIN ema USING (m)`)).rows as Record<string, string>[];
  const by = new Map(q.map((r) => [r.m, r]));
  const emps = (await db.execute(sql`SELECT monthly_cost, start_date, end_date FROM resources WHERE type='EMPLOYEE' AND archived_at IS NULL`)).rows as { monthly_cost: string; start_date: string | null; end_date: string | null }[];
  const rows = months.map((m) => {
    const r = by.get(m);
    const payroll = emps.reduce((a, e) => a + monthlyCostFor({ monthlyCost: e.monthly_cost, startDate: e.start_date, endDate: e.end_date }, m), 0);
    const revenue = n(r?.revenue), projectCost = n(r?.project_cost), companyExpenses = n(r?.company_expenses);
    const totalCost = projectCost + companyExpenses + payroll;
    return { month: m, revenue, projectCost, companyExpenses, payroll, allocatedExpenses: n(r?.allocated_expenses), allocatedPayroll: n(r?.allocated_payroll), totalCost, netProfit: revenue - totalCost, marginPct: ratioPct(revenue - totalCost, revenue) };
  });
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + (r[k] as number), 0);
  const [{ v: undated }] = (await db.execute(sql`SELECT COALESCE(SUM(ROUND(pr.actual_hours*pr.cost_rate*100*p.fx_rate_to_base)) FILTER (WHERE r.type <> 'EMPLOYEE'),0)::bigint AS v FROM project_resources pr JOIN resources r ON r.id = pr.resource_id JOIN projects p ON p.id = pr.project_id WHERE pr.archived_at IS NULL AND ${scope}`)).rows as { v: string }[];
  const totals = { revenue: sum('revenue'), projectCost: sum('projectCost'), companyExpenses: sum('companyExpenses'), payroll: sum('payroll'), totalCost: sum('totalCost'), netProfit: sum('netProfit') };
  return {
    from, to, rows, totals: { ...totals, marginPct: ratioPct(totals.netProfit, totals.revenue) },
    notes: {
      undatedResourceCost: n(undated),
      basis: 'Revenue = invoices issued in the month (excl. tax). Costs are dated cost entries, company expenses and employee payroll. Allocations move cost between projects and overhead but never add to the company total.',
    },
  };
}

// ───────────── forecast ─────────────
export async function forecast(user: AuthUser, horizonMonths?: number) {
  const s = await getSettings();
  const h = Math.min(24, Math.max(1, horizonMonths ?? s.forecast.horizonMonths));
  const today = todayStr();
  const cur = monthStart(today);
  const from = addMonths(cur, -2);
  const to = addMonths(cur, h);
  const toEnd = addDays(addMonths(cur, h + 1), -1);
  const scope = projectScopeSql(user, 'p');
  const months = monthsBetween(from, to);
  const blank = () => ({ actualRevenue: 0, actualCost: 0, actualOverhead: 0, committedCost: 0, scheduledRevenue: 0, retainerRevenue: 0, recurringCost: 0, recurringExpenses: 0 });
  const acc = new Map(months.map((m) => [m, blank()]));
  const add = (m: string, k: keyof ReturnType<typeof blank>, v: number) => { const e = acc.get(monthStart(m)); if (e) e[k] += v; };

  const q1 = (await db.execute(sql`
    SELECT 'rev' AS k, to_char(date_trunc('month', i.issue_date),'YYYY-MM-01') AS m, SUM(ROUND(i.subtotal*100*p.fx_rate_to_base))::bigint AS v FROM invoices i JOIN projects p ON p.id = i.project_id WHERE i.status='ISSUED' AND i.issue_date BETWEEN ${from}::date AND ${today}::date AND ${scope} GROUP BY 2
    UNION ALL SELECT 'cost', to_char(date_trunc('month', c.date),'YYYY-MM-01'), SUM(ROUND(c.amount*100*p.fx_rate_to_base))::bigint FROM project_costs c JOIN projects p ON p.id = c.project_id WHERE c.kind='ACTUAL' AND c.status IN ('APPROVED','PAID') AND c.archived_at IS NULL AND c.date BETWEEN ${from}::date AND ${today}::date AND ${scope} GROUP BY 2
    UNION ALL SELECT 'over', to_char(date_trunc('month', e.date),'YYYY-MM-01'), SUM(ROUND(e.amount*100))::bigint FROM expenses e WHERE e.scope <> 'PROJECT' AND e.status='APPROVED' AND e.archived_at IS NULL AND e.date BETWEEN ${from}::date AND ${today}::date GROUP BY 2
    UNION ALL SELECT 'commit', to_char(date_trunc('month', c.date),'YYYY-MM-01'), SUM(ROUND(c.amount*100*p.fx_rate_to_base))::bigint FROM project_costs c JOIN projects p ON p.id = c.project_id WHERE c.kind='COMMITTED' AND c.status='APPROVED' AND c.archived_at IS NULL AND c.date <= ${toEnd}::date AND ${scope} GROUP BY 2
    UNION ALL SELECT 'sched', to_char(date_trunc('month', i.due_date),'YYYY-MM-01'), SUM(ROUND(i.subtotal*100*p.fx_rate_to_base))::bigint FROM invoices i JOIN projects p ON p.id = i.project_id WHERE i.status='SCHEDULED' AND ${scope} GROUP BY 2`)).rows as { k: string; m: string; v: string }[];
  for (const r of q1) {
    const key = { rev: 'actualRevenue', cost: 'actualCost', over: 'actualOverhead', commit: 'committedCost', sched: 'scheduledRevenue' }[r.k] as keyof ReturnType<typeof blank>;
    // overdue commitments / scheduled items in the past roll into the current month
    const m = r.m < cur && (r.k === 'commit' || r.k === 'sched') ? cur : r.m;
    add(m, key, n(r.v));
  }
  // recurring company expenses (future occurrences)
  const rules = (await db.execute(sql`SELECT amount, frequency, interval_months, start_date, end_date FROM recurring_rules WHERE active`)).rows as { amount: string; frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM'; interval_months: number; start_date: string; end_date: string | null }[];
  for (const r of rules) for (const d of occurrences({ start: r.start_date, intervalMonths: frequencyToMonths(r.frequency, r.interval_months), end: r.end_date, from: addDays(today, 1), to: toEnd })) add(d, 'recurringExpenses', toMinor(r.amount));
  // recurring project costs
  const rc = (await db.execute(sql`SELECT ROUND(c.amount*100*p.fx_rate_to_base)::bigint AS amt, c.recurrence, c.recurrence_interval_months, c.date, c.recurrence_ends FROM project_costs c JOIN projects p ON p.id = c.project_id
    WHERE c.recurrence <> 'NONE' AND c.kind='ACTUAL' AND c.status IN ('APPROVED','PAID') AND c.archived_at IS NULL AND p.status IN ('WON','ONBOARDING','ACTIVE') AND ${scope}`)).rows as { amt: string; recurrence: 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM'; recurrence_interval_months: number | null; date: string; recurrence_ends: string | null }[];
  for (const r of rc) for (const d of occurrences({ start: r.date, intervalMonths: frequencyToMonths(r.recurrence, r.recurrence_interval_months ?? 1), end: r.recurrence_ends, from: addDays(today, 1), to: toEnd })) add(d, 'recurringCost', n(r.amt));
  // retainer fees for months after this one
  const ret = (await db.execute(sql`
    SELECT r.id, p.fx_rate_to_base, r.cancelled_on, ROUND(t.monthly_fee*100)::bigint AS fee, t.start_date, t.end_date, t.included_hours, ROUND(t.overage_rate*100)::bigint AS ov
    FROM retainers r JOIN projects p ON p.id = r.project_id JOIN retainer_terms t ON t.retainer_id = r.id WHERE r.status='ACTIVE' AND ${scope}`)).rows as { id: string; fx_rate_to_base: string; cancelled_on: string | null; fee: string; start_date: string; end_date: string; included_hours: string; ov: string }[];
  const byRet = new Map<string, { fx: number; cancelled: string | null; terms: TermLike[] }>();
  for (const t of ret) {
    const e = byRet.get(t.id) ?? { fx: n(t.fx_rate_to_base), cancelled: t.cancelled_on, terms: [] };
    e.terms.push({ monthlyFee: n(t.fee), startDate: t.start_date, endDate: t.end_date, includedHours: n(t.included_hours), overageRate: n(t.ov) });
    byRet.set(t.id, e);
  }
  for (const e of byRet.values()) for (const m of retainerMonths(e.terms, {}, e.cancelled)) if (m.month > cur) add(m.month, 'retainerRevenue', Math.round(m.baseRevenue * e.fx));

  const out = months.map((m) => {
    const e = acc.get(m)!;
    const isPast = m < cur, isCurrent = m === cur;
    const projectedRevenue = isPast ? e.actualRevenue : e.actualRevenue + e.scheduledRevenue + e.retainerRevenue;
    const projectedCost = isPast ? e.actualCost + e.actualOverhead : e.actualCost + e.actualOverhead + e.committedCost + e.recurringCost + e.recurringExpenses;
    return { month: m, phase: isPast ? 'ACTUAL' : isCurrent ? 'CURRENT' : 'FORECAST', ...e, projectedRevenue, projectedCost, projectedProfit: projectedRevenue - projectedCost };
  });
  const future = out.filter((x) => x.phase !== 'ACTUAL');
  return {
    asOf: today, horizonMonths: h, months: out,
    totals: { projectedRevenue: future.reduce((a, x) => a + x.projectedRevenue, 0), projectedCost: future.reduce((a, x) => a + x.projectedCost, 0), projectedProfit: future.reduce((a, x) => a + x.projectedProfit, 0), committed: future.reduce((a, x) => a + x.committedCost, 0) },
    basis: 'Actual = posted invoices, approved costs and expenses. Committed = approved commitments. Forecast = scheduled invoices, retainer fees, recurring expenses and recurring project costs. No AI or guesses are involved.',
  };
}
export type { ProjectFinRow };
