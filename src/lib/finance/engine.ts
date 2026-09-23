/**
 * Central financial calculation engine.
 *
 * PURE functions only (no DB, no I/O). Every number in the UI/API/exports is derived from here so that
 * a formula exists in exactly one place. All amounts are integer minor units (paise).
 *
 * Definitions (see docs/FINANCIAL_FORMULAS.md):
 *  - Revenue (net)      = contract value AFTER discount, EXCLUDING tax, + signed revenue adjustments
 *                         (hourly: hours x billing rate; retainer: prorated term fees + overages;
 *                          cancelled project: only what was actually invoiced)
 *  - Actual cost        = approved/paid ACTUAL cost lines + allocated expenses + allocated employee cost
 *                         + resource assignments (non-employee)
 *  - Committed cost     = approved COMMITTED lines not yet converted to actual
 *  - Projected cost     = max(estimated, actual + committed)   [completed/cancelled: actual + committed]
 *  - Gross profit       = revenue - actual cost
 *  - Projected profit   = revenue - projected cost
 *  - Margin %           = profit / revenue x 100   (null when revenue <= 0)
 *  - Budget utilisation = actual / budget x 100 (truncated to 2dp; state uses exact integer comparison)
 *  - Outstanding        = max(0, sum(open invoice balances) - unapplied receipts)
 *  - Cash position      = net cash received (ex-tax) - cost actually paid
 */
import { mulDiv, ratioPct, ratioPctFloor, scale4, clampMin0, type Minor } from '../money';

// ───────────────────────────── Types ─────────────────────────────

export type ProjectTypeT = 'ONE_TIME' | 'RETAINER' | 'MILESTONE' | 'HOURLY' | 'FIXED_RECURRING';
export type ProjectStatusT = 'LEAD' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'ONBOARDING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED' | 'LOST';
export type TaxModeT = 'EXCLUSIVE' | 'INCLUSIVE' | 'NONE';
export type HealthStatus = 'HEALTHY' | 'ATTENTION' | 'CRITICAL' | 'NA';
export type BudgetState = 'NONE' | 'OK' | 'WARNING' | 'ALERT' | 'EXCEEDED';

/** Projects in these statuses count towards portfolio revenue/profit (won work). */
export const RECOGNISED_STATUSES: ProjectStatusT[] = ['WON', 'ONBOARDING', 'ACTIVE', 'ON_HOLD', 'COMPLETED'];
export const PIPELINE_STATUSES: ProjectStatusT[] = ['LEAD', 'PROPOSAL', 'NEGOTIATION'];
export const OPEN_STATUSES: ProjectStatusT[] = ['WON', 'ONBOARDING', 'ACTIVE', 'ON_HOLD'];

export interface Thresholds {
  /** margin at/above which a project is healthy */
  targetMarginPct: number;
  /** margin below which a project is critical ("low margin") */
  criticalMarginPct: number;
  /** budget utilisation at/above which a warning is raised */
  budgetWarnPct: number;
  /** utilisation at/above which an alert is raised (default 100) */
  budgetAlertPct: number;
  /** overdue receivable is "significant" when >= this % of invoiced value ... */
  overdueSharePct: number;
  /** ... and the oldest overdue invoice is at least this many days late */
  overdueDays: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  targetMarginPct: 30,
  criticalMarginPct: 10,
  budgetWarnPct: 80,
  budgetAlertPct: 100,
  overdueSharePct: 25,
  overdueDays: 30,
};

// ───────────────────────────── Tax ─────────────────────────────

export interface TaxBreakdown {
  /** revenue excluding tax (after discount) */
  taxable: Minor;
  tax: Minor;
  /** what the client pays (taxable + tax) */
  gross: Minor;
}

/**
 * Split a price into taxable value + tax.
 * EXCLUSIVE: price is before tax -> tax added on top.
 * INCLUSIVE: price already contains tax -> tax extracted.
 * NONE: no tax.
 * Discount is applied to the price BEFORE tax in both modes.
 */
export function calculateTax(price: Minor, discount: Minor, mode: TaxModeT, ratePct: number): TaxBreakdown {
  const base = price - discount;
  if (mode === 'NONE' || ratePct === 0) return { taxable: base, tax: 0, gross: base };
  const rateMilli = Math.round(ratePct * 1000); // 18 -> 18000 (supports 0.001% granularity)
  if (mode === 'EXCLUSIVE') {
    const tax = mulDiv(base, rateMilli, 100000);
    return { taxable: base, tax, gross: base + tax };
  }
  // INCLUSIVE: base is the gross amount
  const taxable = mulDiv(base, 100000, 100000 + rateMilli);
  return { taxable, tax: base - taxable, gross: base };
}

/** GST split: intra-state -> CGST + SGST (half each); inter-state -> IGST. Odd paisa goes to SGST. */
export function splitGst(tax: Minor, intraState: boolean): { cgst: Minor; sgst: Minor; igst: Minor } {
  if (!intraState) return { cgst: 0, sgst: 0, igst: tax };
  const cgst = Math.floor(tax / 2);
  return { cgst, sgst: tax - cgst, igst: 0 };
}

// ───────────────────────────── Revenue ─────────────────────────────

export interface RevenueInput {
  type: ProjectTypeT;
  status: ProjectStatusT;
  sellingPrice: Minor;
  discount: Minor;
  taxMode: TaxModeT;
  taxRatePct: number;
  setupFee?: Minor;
  monthlyFee?: Minor;
  durationMonths?: number;
  /** MILESTONE: sum of milestone prices (falls back to sellingPrice when 0) */
  milestonesTotal?: Minor;
  /** HOURLY: sum(actual hours x billing rate) */
  hourlyRevenue?: Minor;
  /** RETAINER: prorated term fees + overages (ex-tax) */
  retainerRevenue?: Minor;
  /** signed sum of revenue adjustments (credit notes are negative) */
  adjustments?: Minor;
  /** sum of subtotals of ISSUED (non-cancelled) invoices; used for cancelled projects */
  invoicedSubtotal?: Minor;
}

export interface RevenueResult {
  /** price before discount (ex/inc tax as entered) */
  listPrice: Minor;
  discount: Minor;
  /** revenue excluding tax, after discount, before adjustments */
  taxable: Minor;
  tax: Minor;
  /** client payable (taxable + tax) */
  totalIncludingTax: Minor;
  adjustments: Minor;
  /** contract value, ex-tax, incl. adjustments = the number used for profit */
  contractValue: Minor;
  /** revenue used for profit: contractValue, or invoiced value for cancelled, 0 for lost */
  revenue: Minor;
}

export function calculateProjectRevenue(i: RevenueInput): RevenueResult {
  let listPrice: Minor;
  switch (i.type) {
    case 'RETAINER':
      listPrice = i.retainerRevenue ?? 0;
      break;
    case 'HOURLY':
      listPrice = i.hourlyRevenue ?? 0;
      break;
    case 'FIXED_RECURRING':
      listPrice = (i.setupFee ?? 0) + (i.monthlyFee ?? 0) * Math.max(0, i.durationMonths ?? 0);
      break;
    case 'MILESTONE':
      listPrice = (i.milestonesTotal ?? 0) > 0 ? (i.milestonesTotal as Minor) : i.sellingPrice;
      break;
    default:
      listPrice = i.sellingPrice;
  }
  const discount = i.type === 'RETAINER' || i.type === 'HOURLY' ? Math.min(i.discount, Math.max(0, listPrice)) : i.discount;
  const t = calculateTax(listPrice, discount, i.taxMode, i.taxRatePct);
  const adjustments = i.adjustments ?? 0;
  const contractValue = t.taxable + adjustments;
  let revenue = contractValue;
  if (i.status === 'CANCELLED') revenue = i.invoicedSubtotal ?? 0;
  else if (i.status === 'LOST') revenue = 0;
  return { listPrice, discount, taxable: t.taxable, tax: t.tax, totalIncludingTax: t.gross, adjustments, contractValue, revenue };
}

/** Hourly revenue/cost/profit for a set of assignments. */
export function calculateResourceContribution(hours: number, costRate: Minor, billingRate: Minor) {
  const h = scale4(hours); // hours scaled 10^4
  const cost = mulDiv(costRate, h, 10000);
  const revenue = mulDiv(billingRate, h, 10000);
  return { cost, revenue, profit: revenue - cost };
}

// ───────────────────────────── Cost ─────────────────────────────

export interface CostParts {
  /** approved/paid ACTUAL lines */
  directActual: Minor;
  /** company-expense allocations to this project */
  expenseAllocations: Minor;
  /** employee salary allocations to this project */
  employeeAllocations: Minor;
  /** non-employee resource assignments (actual hours x cost rate) */
  resourceAssignments: Minor;
  estimated: Minor;
  committed: Minor;
  /** ACTUAL/COMMITTED lines waiting for approval (not counted) */
  pendingApproval: Minor;
  /** actual cost that has really been paid out */
  paid: Minor;
}

export interface CostResult {
  estimated: Minor;
  actual: Minor;
  committed: Minor;
  pendingApproval: Minor;
  projected: Minor;
  paid: Minor;
  /** actual incurred but not yet paid (payables) */
  unpaid: Minor;
}

export function calculateProjectCost(p: CostParts, status: ProjectStatusT): CostResult {
  const actual = p.directActual + p.expenseAllocations + p.employeeAllocations + p.resourceAssignments;
  const projected = calculateProjectedCost({ estimated: p.estimated, actual, committed: p.committed, status });
  return {
    estimated: p.estimated,
    actual,
    committed: p.committed,
    pendingApproval: p.pendingApproval,
    projected,
    paid: clampMin0(Math.min(p.paid, actual)),
    unpaid: clampMin0(actual - p.paid),
  };
}

/**
 * Estimate at completion.
 *  - open project: max(estimated, actual + committed)  (the untouched part of the estimate is still expected)
 *  - completed / cancelled / lost: actual + committed  (nothing more is coming)
 */
export function calculateProjectedCost(i: { estimated: Minor; actual: Minor; committed: Minor; status: ProjectStatusT }): Minor {
  const spentOrCommitted = i.actual + i.committed;
  if (i.status === 'COMPLETED' || i.status === 'CANCELLED' || i.status === 'LOST') return spentOrCommitted;
  return Math.max(i.estimated, spentOrCommitted);
}

// ───────────────────────────── Profit & margin ─────────────────────────────

export const calculateProjectProfit = (revenue: Minor, cost: Minor): Minor => revenue - cost;

/** margin % (2dp, half-up). null when revenue <= 0 (undefined margin). */
export function calculateProjectMargin(profit: Minor, revenue: Minor): number | null {
  return ratioPct(profit, revenue);
}

export function calculateProjectedProfit(revenue: Minor, projectedCost: Minor): Minor {
  return revenue - projectedCost;
}

// ───────────────────────────── Budget ─────────────────────────────

export interface BudgetResult {
  budget: Minor;
  used: Minor;
  committed: Minor;
  /** budget - actual - committed (can be negative) */
  remaining: Minor;
  /** actual / budget, truncated to 2dp; null when no budget is set */
  utilizationPct: number | null;
  state: BudgetState;
  overBy: Minor;
}

/**
 * Utilisation is based on ACTUAL cost. State uses exact integer comparison, so 99.99% stays a WARNING
 * and exactly 100% is an ALERT; only strictly above 100% is EXCEEDED.
 */
export function calculateBudget(budget: Minor, actual: Minor, committed = 0, t: Pick<Thresholds, 'budgetWarnPct' | 'budgetAlertPct'> = DEFAULT_THRESHOLDS): BudgetResult {
  if (budget <= 0) {
    return { budget: 0, used: actual, committed, remaining: 0, utilizationPct: null, state: 'NONE', overBy: 0 };
  }
  const utilizationPct = ratioPctFloor(actual, budget);
  let state: BudgetState = 'OK';
  // actual/budget*100 >= pct  <=>  actual*1e6 >= budget*pct*1e4   (exact, no rounding)
  const ge = (pct: number) => BigInt(actual) * 1_000_000n >= BigInt(budget) * BigInt(scale4(pct));
  if (actual > budget) state = 'EXCEEDED';
  else if (ge(t.budgetAlertPct)) state = 'ALERT';
  else if (ge(t.budgetWarnPct)) state = 'WARNING';
  return { budget, used: actual, committed, remaining: budget - actual - committed, utilizationPct, state, overBy: clampMin0(actual - budget) };
}

export const calculateBudgetUtilization = (budget: Minor, actual: Minor): number | null => (budget <= 0 ? null : ratioPctFloor(actual, budget));

// ───────────────────────────── Billing / receivables / cash ─────────────────────────────

export interface BillingAgg {
  /** ISSUED (non-cancelled) invoices */
  issuedSubtotal: Minor;
  issuedTax: Minor;
  issuedTotal: Minor;
  /** SCHEDULED (planned, not yet issued) invoices - upcoming receivables */
  scheduledTotal: Minor;
  /** sum over issued invoices of max(0, total - settled) */
  invoiceOutstanding: Minor;
  /** sum over issued invoices of max(0, settled - total): overpayments on invoices */
  invoiceOverpaid: Minor;
  /** part of invoiceOutstanding whose due date has passed */
  overdueOutstanding: Minor;
  oldestOverdueDays: number;
  /** cash receipts (non-voided RECEIPT) */
  receipts: Minor;
  refunds: Minor;
  /** TDS deducted by clients (settles invoices, not cash) */
  tds: Minor;
  /** receipts+tds-refunds NOT tied to a live invoice (advance received before invoicing / cancelled invoice) */
  unapplied: Minor;
}

export const EMPTY_BILLING: BillingAgg = {
  issuedSubtotal: 0, issuedTax: 0, issuedTotal: 0, scheduledTotal: 0, invoiceOutstanding: 0, invoiceOverpaid: 0,
  overdueOutstanding: 0, oldestOverdueDays: 0, receipts: 0, refunds: 0, tds: 0, unapplied: 0,
};

export interface ReceivablesResult {
  invoiced: Minor;
  /** net cash actually received (receipts - refunds) */
  received: Minor;
  tds: Minor;
  outstanding: Minor;
  overdue: Minor;
  upcoming: Minor;
  /** overpayment / customer credit */
  creditBalance: Minor;
  /** (received + tds) / invoiced, percent */
  collectionPct: number | null;
}

/**
 * Outstanding = open invoice balances, reduced by unapplied receipts (advance received before invoicing).
 * Overpayment on an invoice is credit, never negative outstanding.
 */
export function calculateOutstandingAmount(b: BillingAgg): ReceivablesResult {
  const outstanding = clampMin0(b.invoiceOutstanding - b.unapplied);
  const overdue = clampMin0(b.overdueOutstanding - b.unapplied);
  const creditBalance = b.invoiceOverpaid + clampMin0(b.unapplied - b.invoiceOutstanding);
  const received = b.receipts - b.refunds;
  return {
    invoiced: b.issuedTotal,
    received,
    tds: b.tds,
    outstanding,
    overdue,
    upcoming: b.scheduledTotal,
    creditBalance,
    collectionPct: ratioPct(received + b.tds, b.issuedTotal),
  };
}

export interface CashPosition {
  /** gross cash received (incl. tax) */
  receivedGross: Minor;
  /** cash received excluding the tax component */
  receivedNet: Minor;
  /** portion of receipts that is tax collected on behalf of the government */
  taxCollected: Minor;
  costPaid: Minor;
  /** receivedNet - costPaid */
  cashPosition: Minor;
  /** cashPosition after paying what is already owed (actual - paid) */
  cashPositionAfterPayables: Minor;
}

/**
 * Cash view (as opposed to contract/accounting profitability).
 * The tax share of receipts is estimated from the invoiced tax ratio (or the contract's tax ratio
 * when nothing is invoiced yet).
 */
export function calculateCashPosition(args: { billing: BillingAgg; revenue: RevenueResult; cost: CostResult }): CashPosition {
  const { billing, revenue, cost } = args;
  const receivedGross = billing.receipts - billing.refunds;
  let numer: Minor, denom: Minor;
  if (billing.issuedTotal > 0) {
    numer = billing.issuedSubtotal;
    denom = billing.issuedTotal;
  } else {
    numer = revenue.taxable;
    denom = revenue.totalIncludingTax;
  }
  const receivedNet = denom > 0 ? mulDiv(receivedGross, numer, denom) : receivedGross;
  const cashPosition = receivedNet - cost.paid;
  return {
    receivedGross,
    receivedNet,
    taxCollected: receivedGross - receivedNet,
    costPaid: cost.paid,
    cashPosition,
    cashPositionAfterPayables: cashPosition - cost.unpaid,
  };
}

// ───────────────────────────── Health ─────────────────────────────

export interface HealthInput {
  status: ProjectStatusT;
  revenue: Minor;
  actualCost: Minor;
  projectedProfit: Minor;
  /** margin on projected profit (%), null when revenue <= 0 */
  projectedMarginPct: number | null;
  budgetState: BudgetState;
  utilizationPct: number | null;
  overdue: Minor;
  invoiced: Minor;
  oldestOverdueDays: number;
}

export interface HealthResult {
  status: HealthStatus;
  reasons: string[];
}

/** Rules-based project health. No AI. Thresholds are admin-configurable. */
export function calculateHealth(i: HealthInput, t: Thresholds = DEFAULT_THRESHOLDS): HealthResult {
  if (PIPELINE_STATUSES.includes(i.status) || i.status === 'LOST' || i.status === 'CANCELLED') {
    return { status: 'NA', reasons: [] };
  }
  const critical: string[] = [];
  const attention: string[] = [];

  if (i.budgetState === 'EXCEEDED') critical.push('Budget exceeded');
  if (i.projectedProfit < 0) critical.push('Projected loss');
  if (i.projectedMarginPct !== null && i.projectedMarginPct < t.criticalMarginPct && i.projectedProfit >= 0) {
    critical.push(`Low margin (${i.projectedMarginPct.toFixed(1)}% < ${t.criticalMarginPct}%)`);
  }
  if (i.overdue > 0 && i.invoiced > 0) {
    const share = ratioPct(i.overdue, i.invoiced) ?? 0;
    if (share >= t.overdueSharePct && i.oldestOverdueDays >= t.overdueDays) {
      critical.push(`Overdue payments (${share.toFixed(0)}% of invoiced, ${i.oldestOverdueDays}d late)`);
    } else {
      attention.push('Overdue client payment');
    }
  }
  if (i.budgetState === 'ALERT') attention.push('Budget fully used');
  else if (i.budgetState === 'WARNING') attention.push(`Budget ${i.utilizationPct?.toFixed(0)}% used`);
  if (i.projectedMarginPct !== null && i.projectedMarginPct >= t.criticalMarginPct && i.projectedMarginPct < t.targetMarginPct) {
    attention.push(`Margin below target (${i.projectedMarginPct.toFixed(1)}% < ${t.targetMarginPct}%)`);
  }
  if (critical.length) return { status: 'CRITICAL', reasons: [...critical, ...attention] };
  if (attention.length) return { status: 'ATTENTION', reasons: attention };
  return { status: 'HEALTHY', reasons: [] };
}

// ───────────────────────────── Category budgets ─────────────────────────────

export interface CategoryBudgetLine {
  categoryId: string;
  budget: Minor;
  actual: Minor;
}
export function calculateCategoryBudgets(lines: CategoryBudgetLine[], t: Thresholds = DEFAULT_THRESHOLDS) {
  return lines.map((l) => ({ ...l, ...calculateBudget(l.budget, l.actual, 0, t) }));
}

// ───────────────────────────── Full project summary ─────────────────────────────

export interface ProjectFinancialsInput {
  revenue: RevenueInput;
  cost: CostParts;
  billing: BillingAgg;
  budget: Minor;
  thresholds?: Thresholds;
}

export interface ProjectFinancials {
  revenue: RevenueResult;
  cost: CostResult;
  budget: BudgetResult;
  receivables: ReceivablesResult;
  cash: CashPosition;
  estimatedProfit: Minor;
  /** accounting/contract view: revenue - actual cost */
  actualProfit: Minor;
  projectedProfit: Minor;
  estimatedMarginPct: number | null;
  grossMarginPct: number | null;
  projectedMarginPct: number | null;
  health: HealthResult;
}

export function calculateProjectFinancials(input: ProjectFinancialsInput): ProjectFinancials {
  const th = input.thresholds ?? DEFAULT_THRESHOLDS;
  const status = input.revenue.status;
  const revenue = calculateProjectRevenue(input.revenue);
  const cost = calculateProjectCost(input.cost, status);
  const budget = calculateBudget(input.budget, cost.actual, cost.committed, th);
  const receivables = calculateOutstandingAmount(input.billing);
  const cash = calculateCashPosition({ billing: input.billing, revenue, cost });
  const estimatedProfit = calculateProjectProfit(revenue.revenue, cost.estimated);
  const actualProfit = calculateProjectProfit(revenue.revenue, cost.actual);
  const projectedProfit = calculateProjectedProfit(revenue.revenue, cost.projected);
  const projectedMarginPct = calculateProjectMargin(projectedProfit, revenue.revenue);
  const health = calculateHealth(
    {
      status,
      revenue: revenue.revenue,
      actualCost: cost.actual,
      projectedProfit,
      projectedMarginPct,
      budgetState: budget.state,
      utilizationPct: budget.utilizationPct,
      overdue: receivables.overdue,
      invoiced: receivables.invoiced,
      oldestOverdueDays: input.billing.oldestOverdueDays,
    },
    th,
  );
  return {
    revenue,
    cost,
    budget,
    receivables,
    cash,
    estimatedProfit,
    actualProfit,
    projectedProfit,
    estimatedMarginPct: calculateProjectMargin(estimatedProfit, revenue.revenue),
    grossMarginPct: calculateProjectMargin(actualProfit, revenue.revenue),
    projectedMarginPct,
    health,
  };
}

// ───────────────────────────── Currency ─────────────────────────────

/** Convert minor units of a foreign currency using a rate (units of target per 1 source). rate has <= 8 decimals. */
export function convertMinor(amount: Minor, rate: number | string): Minor {
  const r = typeof rate === 'string' ? Number(rate) : rate;
  if (!Number.isFinite(r) || r <= 0) throw new Error('Missing or invalid currency conversion rate');
  return mulDiv(amount, Math.round(r * 1e8), 1e8);
}

// ───────────────────────────── Deals ─────────────────────────────

export function calculateDealScenario(sellingPrice: Minor, costLines: Minor[]) {
  const estimatedCost = costLines.reduce((a, b) => a + b, 0);
  const estimatedProfit = sellingPrice - estimatedCost;
  return { sellingPrice, estimatedCost, estimatedProfit, marginPct: ratioPct(estimatedProfit, sellingPrice) };
}
