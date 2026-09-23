import { describe, it, expect } from 'vitest';
import { occurrences, occurrenceAt, frequencyToMonths } from '@/lib/finance/recurring';
import { retainerMonths, retainerTotalRevenue, termMonthRevenue, findOverlap } from '@/lib/finance/retainer';
import { computeExpenseAllocations, employeeAllocationAmount, checkEmployeeMonth, proratedMonthlyCost } from '@/lib/finance/allocation';
import { fyLabel, fyStartOf, fyEndOf, addMonths, addDays, diffDays, isDateStr, displayDate, monthsBetween } from '@/lib/dates';
import { check } from './_ledger';

const R = (r: number) => Math.round(r * 100);

describe('dates & Indian financial year', () => {
  it('FY runs April - March', () => {
    check('dates', 'FY of 2026-02-10', 0, '2025-26', fyLabel('2026-02-10'));
    check('dates', 'FY of 2026-04-01', 0, '2026-27', fyLabel('2026-04-01'));
    check('dates', 'FY start', 0, '2025-04-01', fyStartOf('2026-03-31'));
    check('dates', 'FY end', 0, '2026-03-31', fyEndOf('2025-06-15'));
  });
  it('configurable FY start (January)', () => check('dates', 'FY jan', 0, '2026', fyLabel('2026-06-01', 1)));
  it('month arithmetic clamps day', () => {
    check('dates', '31 Jan + 1M', 0, '2026-02-28', addMonths('2026-01-31', 1));
    check('dates', 'leap Feb', 0, '2028-02-29', addMonths('2028-01-31', 1));
    check('dates', '+days across month', 0, '2026-03-01', addDays('2026-02-28', 1));
    check('dates', 'diff', 0, 30, diffDays('2026-01-01', '2026-01-31'));
  });
  it('validates dates', () => {
    expect(isDateStr('2026-02-30')).toBe(false);
    expect(isDateStr('2026-13-01')).toBe(false);
    expect(isDateStr('2026-02-28')).toBe(true);
    expect(isDateStr('28/02/2026')).toBe(false);
  });
  it('DD/MM/YYYY display', () => check('dates', 'display', 0, '05/03/2026', displayDate('2026-03-05')));
  it('monthsBetween', () => check('dates', 'months', 0, ['2026-01-01', '2026-02-01', '2026-03-01'], monthsBetween('2026-01-15', '2026-03-02')));
});

describe('recurring schedule generation', () => {
  it('monthly from the 31st keeps clamping to month end', () => {
    const o = occurrences({ start: '2026-01-31', intervalMonths: 1, from: '2026-01-01', to: '2026-04-30' });
    check('recurring', 'monthly 31st', 0, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'], o);
  });
  it('quarterly / yearly / custom', () => {
    check('recurring', 'quarterly', 0, ['2026-01-05', '2026-04-05', '2026-07-05'], occurrences({ start: '2026-01-05', intervalMonths: frequencyToMonths('QUARTERLY'), from: '2026-01-01', to: '2026-09-30' }));
    check('recurring', 'yearly leap anchor', 0, ['2028-02-29', '2029-02-28', '2030-02-28'], occurrences({ start: '2028-02-29', intervalMonths: 12, from: '2028-01-01', to: '2030-12-31' }));
    check('recurring', 'custom 2 months', 0, ['2026-01-10', '2026-03-10', '2026-05-10'], occurrences({ start: '2026-01-10', intervalMonths: frequencyToMonths('CUSTOM', 2), from: '2026-01-01', to: '2026-05-31' }));
  });
  it('respects end date and from-window', () => {
    check('recurring', 'end date', 0, ['2026-02-01', '2026-03-01'], occurrences({ start: '2026-01-01', intervalMonths: 1, end: '2026-03-15', from: '2026-02-01', to: '2026-12-31' }));
  });
  it('occurrenceAt is stable (no drift after clamping)', () => check('recurring', 'no drift', 0, '2026-03-31', occurrenceAt('2026-01-31', 1, 2)));
  it('is idempotent: same window gives same dates', () => {
    const a = occurrences({ start: '2026-01-01', intervalMonths: 1, from: '2026-01-01', to: '2026-12-31' });
    const b = occurrences({ start: '2026-01-01', intervalMonths: 1, from: '2026-01-01', to: '2026-12-31' });
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe('retainer maths', () => {
  const term = { monthlyFee: R(75000), startDate: '2026-01-01', endDate: '2026-12-31', includedHours: 0, overageRate: 0 };
  it('12 x 75,000 = 9,00,000', () => check('retainer', 'full year', 0, R(900000), retainerTotalRevenue([term], {}).total));
  it('starting mid-month prorates by days (16/31)', () => {
    check('retainer', 'mid-month start month', 0, 3870968, termMonthRevenue({ ...term, startDate: '2026-01-16' }, '2026-01-01').revenue);
    check('retainer', 'mid-month start total', 0, R(825000) + 3870968, retainerTotalRevenue([{ ...term, startDate: '2026-01-16' }], {}).total);
  });
  it('ending mid-month prorates (15/30 in June)', () => {
    check('retainer', 'mid-month end', 0, R(37500), termMonthRevenue({ ...term, endDate: '2026-06-15' }, '2026-06-01').revenue);
  });
  it('cancellation stops revenue (10th March)', () => {
    const r = retainerTotalRevenue([term], {}, '2026-03-10');
    // Jan + Feb full, Mar 10/31 => 75000*10/31 = 24193.55
    check('retainer', 'cancelled', 0, R(150000) + 2419355, r.total);
    check('retainer', 'no months after cancel', 0, 3, r.months.length);
  });
  it('renewal with a new fee never rewrites history', () => {
    const t2 = { ...term, monthlyFee: R(90000), startDate: '2027-01-01', endDate: '2027-06-30' };
    const r = retainerTotalRevenue([term, t2], {});
    check('retainer', 'renewal total', 0, R(900000) + 6 * R(90000), r.total);
    check('retainer', 'old month unchanged', 0, R(75000), r.months.find((m) => m.month === '2026-06-01')!.revenue);
    check('retainer', 'new fee applies to new term', 0, R(90000), r.months.find((m) => m.month === '2027-03-01')!.revenue);
  });
  it('overage: 26h used of 20h included at 2,000/h', () => {
    const t = { ...term, includedHours: 20, overageRate: R(2000) };
    const m = retainerMonths([t], { '2026-02-01': 26, '2026-03-01': 18 });
    const feb = m.find((x) => x.month === '2026-02-01')!;
    check('retainer', 'overage', 0, { h: 6, rev: R(12000), total: R(87000) }, { h: feb.overageHours, rev: feb.overageRevenue, total: feb.revenue });
    check('retainer', 'no overage under included', 0, 0, m.find((x) => x.month === '2026-03-01')!.overageRevenue);
  });
  it('detects overlapping terms', () => {
    expect(findOverlap([term, { ...term, startDate: '2026-12-31', endDate: '2027-03-01' }])).not.toBeNull();
    expect(findOverlap([term, { ...term, startDate: '2027-01-01', endDate: '2027-03-01' }])).toBeNull();
  });
});

describe('employee cost allocation (no double counting)', () => {
  const salary = R(60000);
  it('40% / 35% / internal 25% of 60,000', () => {
    const a = employeeAllocationAmount(salary, 'PERCENT', 40);
    const b = employeeAllocationAmount(salary, 'PERCENT', 35);
    const chk = checkEmployeeMonth(salary, [a, b]);
    check('allocation', 'project A', 0, R(24000), a);
    check('allocation', 'project B', 0, R(21000), b);
    check('allocation', 'internal remainder', 0, { ok: true, internal: R(15000) }, { ok: chk.ok, internal: chk.internal });
  });
  it('hours (80 of 160) and days (11 of 22) methods', () => {
    check('allocation', '80h', 0, R(30000), employeeAllocationAmount(salary, 'HOURS', 80));
    check('allocation', '11 days', 0, R(30000), employeeAllocationAmount(salary, 'DAYS', 11));
    check('allocation', 'custom hours/month', 0, R(20000), employeeAllocationAmount(salary, 'HOURS', 40, { workHoursPerMonth: 120, workDaysPerMonth: 22 }));
  });
  it('manual amount', () => check('allocation', 'manual', 0, R(12345), employeeAllocationAmount(salary, 'MANUAL', R(12345))));
  it('allocating more than 100% is rejected', () => {
    const chk = checkEmployeeMonth(salary, [employeeAllocationAmount(salary, 'PERCENT', 60), employeeAllocationAmount(salary, 'PERCENT', 50)]);
    check('allocation', 'over 100%', 0, { ok: false, over: R(6000) }, { ok: chk.ok, over: chk.overBy });
  });
  it('exactly 100% is fine', () => {
    const chk = checkEmployeeMonth(salary, [employeeAllocationAmount(salary, 'PERCENT', 60), employeeAllocationAmount(salary, 'PERCENT', 40)]);
    check('allocation', 'exactly 100%', 0, { ok: true, internal: 0 }, { ok: chk.ok, internal: chk.internal });
  });
  it('prorates mid-month joiners', () => check('allocation', 'proration 10/30', 0, R(20000), proratedMonthlyCost(salary, 10, 30)));
  it('negative values rejected', () => expect(() => employeeAllocationAmount(salary, 'PERCENT', -1)).toThrow());
});

describe('company expense allocation', () => {
  it('rent 1,00,000: A 20%, B 30%, C 10%, remaining 40% stays overhead', () => {
    const r = computeExpenseAllocations(R(100000), [
      { key: 'A', method: 'PERCENT', value: 20 }, { key: 'B', method: 'PERCENT', value: 30 }, { key: 'C', method: 'PERCENT', value: 10 },
    ]);
    check('allocation', 'rent split', 0, { amounts: [R(20000), R(30000), R(10000)], overhead: R(40000) }, { amounts: r.amounts, overhead: r.overhead });
  });
  it('fixed amounts', () => {
    const r = computeExpenseAllocations(R(50000), [{ key: 'A', method: 'FIXED', value: R(12000) }, { key: 'B', method: 'FIXED', value: R(8000) }]);
    check('allocation', 'fixed', 0, { amounts: [R(12000), R(8000)], overhead: R(30000) }, { amounts: r.amounts, overhead: r.overhead });
  });
  it('by hours shares the pool proportionally and sums exactly', () => {
    const r = computeExpenseAllocations(R(100), [{ key: 'A', method: 'HOURS', value: 1 }, { key: 'B', method: 'HOURS', value: 1 }, { key: 'C', method: 'HOURS', value: 1 }]);
    check('allocation', 'hours exact sum', 0, { sum: R(100), overhead: 0 }, { sum: r.amounts.reduce((a, b) => a + b, 0), overhead: r.overhead });
  });
  it('by revenue share (3:1)', () => {
    const r = computeExpenseAllocations(R(100000), [{ key: 'A', method: 'REVENUE_PERCENT', value: 0, revenue: R(300000) }, { key: 'B', method: 'REVENUE_PERCENT', value: 0, revenue: R(100000) }]);
    check('allocation', 'revenue share', 0, [R(75000), R(25000)], r.amounts);
  });
  it('mixed: fixed + percent + hours pool', () => {
    const r = computeExpenseAllocations(R(100000), [
      { key: 'A', method: 'FIXED', value: R(10000) }, { key: 'B', method: 'PERCENT', value: 20 },
      { key: 'C', method: 'HOURS', value: 30 }, { key: 'D', method: 'HOURS', value: 10 },
    ]);
    // pool = 100000 - 10000 - 20000 = 70000 -> 52500 / 17500
    check('allocation', 'mixed', 0, [R(10000), R(20000), R(52500), R(17500)], r.amounts);
  });
  it('cannot allocate more than 100%', () => {
    expect(() => computeExpenseAllocations(R(1000), [{ key: 'A', method: 'PERCENT', value: 60 }, { key: 'B', method: 'PERCENT', value: 50 }])).toThrow(/100%/);
    expect(() => computeExpenseAllocations(R(1000), [{ key: 'A', method: 'FIXED', value: R(600) }, { key: 'B', method: 'FIXED', value: R(500) }])).toThrow(/exceed/);
  });
  it('mixing hours and revenue pools is rejected', () => {
    expect(() => computeExpenseAllocations(R(1000), [{ key: 'A', method: 'HOURS', value: 1 }, { key: 'B', method: 'REVENUE_PERCENT', value: 0, revenue: 1 }])).toThrow();
  });
  it('zero-weight pool is rejected with a helpful message', () => {
    expect(() => computeExpenseAllocations(R(1000), [{ key: 'A', method: 'HOURS', value: 0 }])).toThrow(/hours/i);
  });
  it('rejects non-positive expense and negative values', () => {
    expect(() => computeExpenseAllocations(0, [])).toThrow();
    expect(() => computeExpenseAllocations(R(10), [{ key: 'A', method: 'PERCENT', value: -5 }])).toThrow();
  });
});

describe('percent allocations that total 100% lose no paisa', () => {
  it('33.34 / 33.33 / 33.33 % of ₹100.01 allocates exactly ₹100.01', () => {
    const r = computeExpenseAllocations(10001, [{ key: 'a', method: 'PERCENT', value: 33.34 }, { key: 'b', method: 'PERCENT', value: 33.33 }, { key: 'c', method: 'PERCENT', value: 33.33 }]);
    expect(r.amounts.reduce((a, b) => a + b, 0)).toBe(10001);
    expect(r.overhead).toBe(0);
  });
  it('less than 100% keeps the remainder as overhead', () => {
    const r = computeExpenseAllocations(10000, [{ key: 'a', method: 'PERCENT', value: 40 }, { key: 'b', method: 'PERCENT', value: 35 }]);
    expect(r.amounts).toEqual([4000, 3500]); expect(r.overhead).toBe(2500);
  });
});
