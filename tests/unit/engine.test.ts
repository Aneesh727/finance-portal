import { describe, it, expect } from 'vitest';
import {
  calculateTax, splitGst, calculateProjectRevenue, calculateProjectCost, calculateProjectedCost, calculateProjectMargin,
  calculateProjectProfit, calculateBudget, calculateOutstandingAmount, calculateCashPosition, calculateHealth,
  calculateProjectFinancials, calculateResourceContribution, convertMinor, calculateDealScenario, calculateBudgetUtilization,
  EMPTY_BILLING, DEFAULT_THRESHOLDS, type RevenueInput, type CostParts, type BillingAgg,
} from '@/lib/finance/engine';
import { check } from './_ledger';

const R = (rupees: number) => Math.round(rupees * 100);
const rev = (o: Partial<RevenueInput> = {}): RevenueInput => ({ type: 'ONE_TIME', status: 'ACTIVE', sellingPrice: 0, discount: 0, taxMode: 'NONE', taxRatePct: 0, ...o });
const cost = (o: Partial<CostParts> = {}): CostParts => ({ directActual: 0, expenseAllocations: 0, employeeAllocations: 0, resourceAssignments: 0, estimated: 0, committed: 0, pendingApproval: 0, paid: 0, ...o });
const bill = (o: Partial<BillingAgg> = {}): BillingAgg => ({ ...EMPTY_BILLING, ...o });

describe('tax & discount', () => {
  it('tax-exclusive price adds tax on top', () => {
    check('tax', 'exclusive 18%', { price: R(100000), rate: 18 }, { taxable: R(100000), tax: R(18000), gross: R(118000) }, calculateTax(R(100000), 0, 'EXCLUSIVE', 18));
  });
  it('tax-inclusive price extracts tax', () => {
    check('tax', 'inclusive 18%', { price: R(118000), rate: 18 }, { taxable: R(100000), tax: R(18000), gross: R(118000) }, calculateTax(R(118000), 0, 'INCLUSIVE', 18));
  });
  it('discount is applied before tax (exclusive)', () => {
    check('tax', 'exclusive + 10% discount', { price: R(100000), disc: R(10000) }, { taxable: R(90000), tax: R(16200), gross: R(106200) }, calculateTax(R(100000), R(10000), 'EXCLUSIVE', 18));
  });
  it('discount is applied before tax (inclusive)', () => {
    check('tax', 'inclusive + discount', { price: R(118000), disc: R(11800) }, { taxable: R(90000), tax: R(16200), gross: R(106200) }, calculateTax(R(118000), R(11800), 'INCLUSIVE', 18));
  });
  it('GST rate changes are honoured (nothing hard-coded)', () => {
    check('tax', 'GST 12%', 12, R(12000), calculateTax(R(100000), 0, 'EXCLUSIVE', 12).tax);
    check('tax', 'GST 5%', 5, R(5000), calculateTax(R(100000), 0, 'EXCLUSIVE', 5).tax);
    check('tax', 'GST 0%', 0, 0, calculateTax(R(100000), 0, 'EXCLUSIVE', 0).tax);
    check('tax', 'GST 2.5% fractional', 2.5, R(2500), calculateTax(R(100000), 0, 'EXCLUSIVE', 2.5).tax);
  });
  it('tax mode NONE ignores the rate', () => {
    check('tax', 'NONE', { price: R(100000), rate: 18 }, { taxable: R(100000), tax: 0, gross: R(100000) }, calculateTax(R(100000), 0, 'NONE', 18));
  });
  it('decimal amounts round to the paisa', () => {
    // 1234.56 * 18% = 222.2208 -> 222.22
    check('tax', 'decimals', R(1234.56), { taxable: 123456, tax: 22222, gross: 145678 }, calculateTax(123456, 0, 'EXCLUSIVE', 18));
  });
  it('large numbers stay exact', () => {
    const big = R(9_000_000_000); // 900 crore
    check('tax', 'large', big, { taxable: big, tax: R(1_620_000_000), gross: R(10_620_000_000) }, calculateTax(big, 0, 'EXCLUSIVE', 18));
  });
  it('splits GST into CGST/SGST or IGST', () => {
    check('tax', 'intra-state', 1801, { cgst: 900, sgst: 901, igst: 0 }, splitGst(1801, true));
    check('tax', 'inter-state', 1801, { cgst: 0, sgst: 0, igst: 1801 }, splitGst(1801, false));
  });
});

describe('revenue by project type', () => {
  it('ONE_TIME: selling price, ex-tax', () => {
    const r = calculateProjectRevenue(rev({ sellingPrice: R(200000) }));
    check('revenue', 'one-time 2L', R(200000), R(200000), r.revenue);
  });
  it('ONE_TIME exclusive tax: revenue excludes tax, client pays tax on top', () => {
    const r = calculateProjectRevenue(rev({ sellingPrice: R(500000), taxMode: 'EXCLUSIVE', taxRatePct: 18 }));
    check('revenue', 'exclusive revenue', 0, { rev: R(500000), tax: R(90000), total: R(590000) }, { rev: r.revenue, tax: r.tax, total: r.totalIncludingTax });
  });
  it('MILESTONE: sum of milestones', () => {
    const r = calculateProjectRevenue(rev({ type: 'MILESTONE', milestonesTotal: R(50000 + 100000 + 80000 + 30000 + 20000) }));
    check('revenue', 'milestones 2.8L', 0, R(280000), r.revenue);
  });
  it('MILESTONE falls back to selling price when there are no milestones', () => {
    check('revenue', 'milestone fallback', 0, R(90000), calculateProjectRevenue(rev({ type: 'MILESTONE', sellingPrice: R(90000) })).revenue);
  });
  it('HOURLY: hours x billing rate (120h x 1000 vs cost 120h x 500)', () => {
    const c = calculateResourceContribution(120, R(500), R(1000));
    check('revenue', 'hourly contribution', { h: 120 }, { cost: R(60000), revenue: R(120000), profit: R(60000) }, c);
    check('revenue', 'hourly project revenue', 0, R(120000), calculateProjectRevenue(rev({ type: 'HOURLY', hourlyRevenue: c.revenue })).revenue);
  });
  it('HOURLY fractional hours', () => {
    check('revenue', '7.5h x 1200', 7.5, { cost: R(4500), revenue: R(9000), profit: R(4500) }, calculateResourceContribution(7.5, R(600), R(1200)));
  });
  it('FIXED_RECURRING: setup + monthly x months (2L + 50k x 12)', () => {
    const r = calculateProjectRevenue(rev({ type: 'FIXED_RECURRING', setupFee: R(200000), monthlyFee: R(50000), durationMonths: 12 }));
    check('revenue', 'setup + recurring', 0, R(800000), r.revenue);
  });
  it('RETAINER: uses computed retainer revenue', () => {
    check('revenue', 'retainer', 0, R(900000), calculateProjectRevenue(rev({ type: 'RETAINER', retainerRevenue: R(900000) })).revenue);
  });
  it('negative adjustment (credit note) reduces revenue', () => {
    const r = calculateProjectRevenue(rev({ sellingPrice: R(100000), adjustments: -R(10000) }));
    check('revenue', 'negative adjustment', 0, R(90000), r.revenue);
  });
  it('positive adjustment (scope increase) adds revenue', () => {
    check('revenue', 'positive adjustment', 0, R(125000), calculateProjectRevenue(rev({ sellingPrice: R(100000), adjustments: R(25000) })).revenue);
  });
  it('cancelled project keeps only what was invoiced', () => {
    const r = calculateProjectRevenue(rev({ status: 'CANCELLED', sellingPrice: R(300000), invoicedSubtotal: R(90000) }));
    check('revenue', 'cancelled', 0, { revenue: R(90000), contract: R(300000) }, { revenue: r.revenue, contract: r.contractValue });
  });
  it('lost project has no revenue', () => {
    check('revenue', 'lost', 0, 0, calculateProjectRevenue(rev({ status: 'LOST', sellingPrice: R(300000) })).revenue);
  });
  it('zero revenue project', () => {
    check('revenue', 'zero', 0, 0, calculateProjectRevenue(rev({})).revenue);
  });
});

describe('cost & projected cost', () => {
  it('actual = direct + allocations + assignments', () => {
    const c = calculateProjectCost(cost({ directActual: R(100), expenseAllocations: R(20), employeeAllocations: R(30), resourceAssignments: R(50), paid: R(120) }), 'ACTIVE');
    check('cost', 'components', 0, { actual: R(200), paid: R(120), unpaid: R(80) }, { actual: c.actual, paid: c.paid, unpaid: c.unpaid });
  });
  it('open project: projected = max(estimated, actual + committed)', () => {
    check('cost', 'estimate dominates', 0, R(100000), calculateProjectedCost({ estimated: R(100000), actual: R(40000), committed: R(20000), status: 'ACTIVE' }));
    check('cost', 'spend dominates', 0, R(120000), calculateProjectedCost({ estimated: R(100000), actual: R(90000), committed: R(30000), status: 'ACTIVE' }));
  });
  it('completed project: projected = actual + committed', () => {
    check('cost', 'completed', 0, R(40000), calculateProjectedCost({ estimated: R(100000), actual: R(40000), committed: 0, status: 'COMPLETED' }));
    check('cost', 'cancelled', 0, R(40000), calculateProjectedCost({ estimated: R(100000), actual: R(40000), committed: 0, status: 'CANCELLED' }));
  });
  it('pending-approval lines are reported but never counted', () => {
    const c = calculateProjectCost(cost({ directActual: R(100), pendingApproval: R(500) }), 'ACTIVE');
    check('cost', 'pending not counted', 0, { actual: R(100), pending: R(500) }, { actual: c.actual, pending: c.pendingApproval });
  });
  it('paid can never exceed actual', () => {
    check('cost', 'paid clamp', 0, R(100), calculateProjectCost(cost({ directActual: R(100), paid: R(500) }), 'ACTIVE').paid);
  });
});

describe('profit & margin', () => {
  it('spec example: 2L revenue, 1L cost => 1L profit, 50%', () => {
    const p = calculateProjectProfit(R(200000), R(100000));
    check('profit', 'gross profit', 0, R(100000), p);
    check('profit', 'gross margin', 0, 50, calculateProjectMargin(p, R(200000)));
  });
  it('100% margin (zero cost)', () => check('profit', '100% margin', 0, 100, calculateProjectMargin(R(1000), R(1000))));
  it('0% margin (revenue == cost)', () => check('profit', '0% margin', 0, 0, calculateProjectMargin(0, R(1000))));
  it('negative margin (loss)', () => check('profit', 'negative margin', 0, -50, calculateProjectMargin(-R(500), R(1000))));
  it('zero revenue -> margin undefined (null), never NaN/Infinity', () => {
    check('profit', 'zero revenue', 0, null, calculateProjectMargin(-R(500), 0));
    check('profit', 'zero/zero', 0, null, calculateProjectMargin(0, 0));
  });
  it('rounds margin to 2dp', () => check('profit', 'margin 2dp', 0, 53.33, calculateProjectMargin(R(160000), R(300000))));
  it('deal scenario from the brief: 3L price, 1.4L cost => 1.6L, 53.33%', () => {
    const d = calculateDealScenario(R(300000), [R(70000), R(30000), R(20000), R(10000), R(10000)]);
    check('profit', 'deal scenario', 0, { cost: R(140000), profit: R(160000), margin: 53.33 }, { cost: d.estimatedCost, profit: d.estimatedProfit, margin: d.marginPct });
  });
});

describe('budget control', () => {
  const b = R(100000);
  it('below warning threshold is OK', () => check('budget', '79,999.99', 0, 'OK', calculateBudget(b, R(79999.99)).state));
  it('80% triggers WARNING', () => check('budget', '80,000', 0, 'WARNING', calculateBudget(b, R(80000)).state));
  it('99.99% is a WARNING and displays 99.99, not 100', () => {
    const r = calculateBudget(b, R(99999));
    check('budget', 'near limit 99,999', 0, { s: 'WARNING', u: 99.99 }, { s: r.state, u: r.utilizationPct });
    const r2 = calculateBudget(b, R(99999.99));
    check('budget', 'near limit 99,999.99', 0, { s: 'WARNING', u: 99.99 }, { s: r2.state, u: r2.utilizationPct });
  });
  it('exactly 100% is an ALERT (not yet exceeded)', () => {
    const r = calculateBudget(b, b);
    check('budget', 'exactly reached', 0, { s: 'ALERT', u: 100, rem: 0 }, { s: r.state, u: r.utilizationPct, rem: r.remaining });
  });
  it('one paisa above is EXCEEDED', () => {
    const r = calculateBudget(b, b + 1);
    check('budget', 'exceeded by 1 paisa', 0, { s: 'EXCEEDED', over: 1 }, { s: r.state, over: r.overBy });
  });
  it('no budget -> state NONE, utilisation null', () => {
    const r = calculateBudget(0, R(5000));
    check('budget', 'no budget', 0, { s: 'NONE', u: null }, { s: r.state, u: r.utilizationPct });
  });
  it('remaining accounts for committed cost', () => {
    check('budget', 'remaining', 0, R(30000), calculateBudget(b, R(50000), R(20000)).remaining);
  });
  it('custom thresholds (admin configurable)', () => {
    check('budget', 'custom warn 50', 0, 'WARNING', calculateBudget(b, R(50000), 0, { budgetWarnPct: 50, budgetAlertPct: 90 }).state);
    check('budget', 'custom alert 90', 0, 'ALERT', calculateBudget(b, R(90000), 0, { budgetWarnPct: 50, budgetAlertPct: 90 }).state);
  });
  it('utilisation helper', () => check('budget', 'util helper', 0, 33.33, calculateBudgetUtilization(R(300), R(100))));
});

describe('receivables, payments & cash', () => {
  it('partial payment: 5L + 18% GST, 1.5L received', () => {
    const r = calculateOutstandingAmount(bill({ issuedSubtotal: R(500000), issuedTax: R(90000), issuedTotal: R(590000), invoiceOutstanding: R(440000), receipts: R(150000) }));
    check('billing', 'partial payment', 0, { outstanding: R(440000), received: R(150000), pct: 25.42 }, { outstanding: r.outstanding, received: r.received, pct: r.collectionPct });
  });
  it('overpayment becomes credit, outstanding never negative', () => {
    const r = calculateOutstandingAmount(bill({ issuedTotal: R(100000), invoiceOutstanding: 0, invoiceOverpaid: R(10000), receipts: R(110000) }));
    check('billing', 'overpayment', 0, { outstanding: 0, credit: R(10000) }, { outstanding: r.outstanding, credit: r.creditBalance });
  });
  it('payment received before invoice (unapplied) reduces outstanding once invoiced', () => {
    const r = calculateOutstandingAmount(bill({ issuedTotal: R(300000), invoiceOutstanding: R(300000), unapplied: R(100000), receipts: R(100000) }));
    check('billing', 'advance before invoice', 0, { outstanding: R(200000) }, { outstanding: r.outstanding });
  });
  it('advance larger than the invoice leaves customer credit', () => {
    const r = calculateOutstandingAmount(bill({ issuedTotal: R(300000), invoiceOutstanding: R(300000), unapplied: R(400000), receipts: R(400000) }));
    check('billing', 'advance > invoice', 0, { outstanding: 0, credit: R(100000) }, { outstanding: r.outstanding, credit: r.creditBalance });
  });
  it('payment with no invoice at all: nothing outstanding, all credit', () => {
    const r = calculateOutstandingAmount(bill({ unapplied: R(50000), receipts: R(50000) }));
    check('billing', 'payment, no invoice', 0, { outstanding: 0, credit: R(50000) }, { outstanding: r.outstanding, credit: r.creditBalance });
  });
  it('refunds reduce received cash', () => {
    check('billing', 'refund', 0, R(400000), calculateOutstandingAmount(bill({ receipts: R(500000), refunds: R(100000) })).received);
  });
  it('TDS settles the invoice but is not cash', () => {
    const r = calculateOutstandingAmount(bill({ issuedTotal: R(100000), invoiceOutstanding: 0, receipts: R(90000), tds: R(10000) }));
    check('billing', 'tds', 0, { received: R(90000), pct: 100, outstanding: 0 }, { received: r.received, pct: r.collectionPct, outstanding: r.outstanding });
  });
  it('cancelled invoice: nothing invoiced, nothing outstanding', () => {
    const r = calculateOutstandingAmount(bill({ issuedTotal: 0, invoiceOutstanding: 0 }));
    check('billing', 'cancelled invoice', 0, { invoiced: 0, outstanding: 0, pct: null }, { invoiced: r.invoiced, outstanding: r.outstanding, pct: r.collectionPct });
  });
  it('scheduled invoices are upcoming receivables, not outstanding', () => {
    const r = calculateOutstandingAmount(bill({ scheduledTotal: R(120000) }));
    check('billing', 'upcoming', 0, { upcoming: R(120000), outstanding: 0 }, { upcoming: r.upcoming, outstanding: r.outstanding });
  });
  it('cash position (net of tax) differs from accounting profit', () => {
    const revenue = calculateProjectRevenue(rev({ sellingPrice: R(500000), taxMode: 'EXCLUSIVE', taxRatePct: 18 }));
    const c = calculateProjectCost(cost({ directActual: R(250000), paid: R(100000) }), 'ACTIVE');
    const cash = calculateCashPosition({
      billing: bill({ issuedSubtotal: R(500000), issuedTax: R(90000), issuedTotal: R(590000), receipts: R(118000) }),
      revenue, cost: c,
    });
    // 118000 received incl 18% GST => 100000 net; paid 100000 => 0
    check('cash', 'cash position', 0, { net: R(100000), tax: R(18000), pos: 0, afterPayables: -R(150000) }, { net: cash.receivedNet, tax: cash.taxCollected, pos: cash.cashPosition, afterPayables: cash.cashPositionAfterPayables });
  });
  it('cash before any invoice uses contract tax ratio', () => {
    const revenue = calculateProjectRevenue(rev({ sellingPrice: R(100000), taxMode: 'EXCLUSIVE', taxRatePct: 18 }));
    const cash = calculateCashPosition({ billing: bill({ receipts: R(59000), unapplied: R(59000) }), revenue, cost: calculateProjectCost(cost(), 'ACTIVE') });
    check('cash', 'advance uses contract ratio', 0, R(50000), cash.receivedNet);
  });
});

describe('project health (rules based)', () => {
  const base = { status: 'ACTIVE' as const, revenue: R(100000), actualCost: R(40000), projectedProfit: R(60000), projectedMarginPct: 60, budgetState: 'OK' as const, utilizationPct: 40, overdue: 0, invoiced: R(100000), oldestOverdueDays: 0 };
  it('healthy', () => check('health', 'healthy', 0, 'HEALTHY', calculateHealth(base).status));
  it('budget warning => attention', () => check('health', 'budget 85%', 0, 'ATTENTION', calculateHealth({ ...base, budgetState: 'WARNING', utilizationPct: 85 }).status));
  it('budget alert (100%) => attention', () => check('health', 'budget 100%', 0, 'ATTENTION', calculateHealth({ ...base, budgetState: 'ALERT', utilizationPct: 100 }).status));
  it('budget exceeded => critical', () => check('health', 'budget exceeded', 0, 'CRITICAL', calculateHealth({ ...base, budgetState: 'EXCEEDED' }).status));
  it('projected loss => critical', () => check('health', 'projected loss', 0, 'CRITICAL', calculateHealth({ ...base, projectedProfit: -R(1), projectedMarginPct: -0.5 }).status));
  it('margin below target => attention', () => check('health', 'margin 20%', 0, 'ATTENTION', calculateHealth({ ...base, projectedMarginPct: 20 }).status));
  it('margin below critical floor => critical', () => check('health', 'margin 5%', 0, 'CRITICAL', calculateHealth({ ...base, projectedMarginPct: 5 }).status));
  it('significant overdue => critical, small overdue => attention', () => {
    check('health', 'overdue big+old', 0, 'CRITICAL', calculateHealth({ ...base, overdue: R(40000), oldestOverdueDays: 45 }).status);
    check('health', 'overdue big but recent', 0, 'ATTENTION', calculateHealth({ ...base, overdue: R(40000), oldestOverdueDays: 5 }).status);
    check('health', 'overdue small', 0, 'ATTENTION', calculateHealth({ ...base, overdue: R(5000), oldestOverdueDays: 60 }).status);
  });
  it('thresholds are configurable', () => {
    const t = { ...DEFAULT_THRESHOLDS, targetMarginPct: 70 };
    check('health', 'custom target 70', 0, 'ATTENTION', calculateHealth(base, t).status);
  });
  it('pipeline / lost / cancelled projects are NA', () => {
    for (const s of ['LEAD', 'PROPOSAL', 'NEGOTIATION', 'LOST', 'CANCELLED'] as const) check('health', `status ${s}`, 0, 'NA', calculateHealth({ ...base, status: s }).status);
  });
  it('project with no revenue and no cost is not flagged', () => {
    check('health', 'no data', 0, 'HEALTHY', calculateHealth({ ...base, revenue: 0, actualCost: 0, projectedProfit: 0, projectedMarginPct: null, invoiced: 0 }).status);
  });
  it('zero revenue with cost is a projected loss => critical', () => {
    check('health', 'zero revenue w/ cost', 0, 'CRITICAL', calculateHealth({ ...base, revenue: 0, actualCost: R(500), projectedProfit: -R(500), projectedMarginPct: null }).status);
  });
});

describe('currency', () => {
  it('converts using a rate', () => check('currency', '100 USD @ 83.5', 0, R(8350), convertMinor(R(100), 83.5)));
  it('rounds half up', () => check('currency', 'rounding', 0, 8, convertMinor(1, 7.5)));
  it('missing/invalid conversion rate is an error, never silently 1', () => {
    expect(() => convertMinor(R(100), 0)).toThrow(/conversion/i);
    expect(() => convertMinor(R(100), NaN)).toThrow(/conversion/i);
  });
});

describe('spec scenario §49: ABC Company e-commerce website (pure engine)', () => {
  const contract = R(500000);
  const estimated = [120000, 50000, 30000, 10000, 20000].map(R);
  const actualBase = [140000, 45000, 30000, 10000, 25000].map(R);
  const budget = R(250000);
  const sumA = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const run = (actual: number, receipts: number, outstandingInv: number) =>
    calculateProjectFinancials({
      revenue: rev({ sellingPrice: contract }),
      cost: cost({ estimated: sumA(estimated), directActual: actual, paid: actual }),
      billing: bill({ issuedSubtotal: contract, issuedTotal: contract, invoiceOutstanding: outstandingInv, receipts }),
      budget,
    });
  it('baseline', () => {
    const f = run(sumA(actualBase), R(150000), R(350000));
    check('e2e', 'estimated cost', 0, R(230000), f.cost.estimated);
    check('e2e', 'actual cost', 0, R(250000), f.cost.actual);
    check('e2e', 'actual profit / margin', 0, { p: R(250000), m: 50 }, { p: f.actualProfit, m: f.grossMarginPct });
    check('e2e', 'budget at limit', 0, { s: 'ALERT', u: 100 }, { s: f.budget.state, u: f.budget.utilizationPct });
    check('e2e', 'outstanding after 1.5L advance', 0, R(350000), f.receivables.outstanding);
  });
  it('developer cost +20,000 changes cost, profit, margin, budget', () => {
    const f = run(sumA(actualBase) + R(20000), R(150000), R(350000));
    check('e2e', 'cost after +20k', 0, R(270000), f.cost.actual);
    check('e2e', 'profit after +20k', 0, { p: R(230000), m: 46 }, { p: f.actualProfit, m: f.grossMarginPct });
    check('e2e', 'budget exceeded', 0, { s: 'EXCEEDED', u: 108, over: R(20000) }, { s: f.budget.state, u: f.budget.utilizationPct, over: f.budget.overBy });
    check('e2e', 'health critical', 0, 'CRITICAL', f.health.status);
  });
  it('another payment received reduces outstanding', () => {
    const f = run(sumA(actualBase) + R(20000), R(150000 + 200000), R(150000));
    check('e2e', 'outstanding after 2nd payment', 0, R(150000), f.receivables.outstanding);
  });
});
