/**
 * Cost allocation maths (employee salary allocation + company expense allocation).
 * Rounding rule: shares of a pool always sum EXACTLY to the pool (largest remainder).
 */
import { distribute, mulDiv, percentOf, scale4, type Minor } from '../money';

// ───────────────────────────── Employee allocation ─────────────────────────────

export type EmpMethod = 'PERCENT' | 'HOURS' | 'DAYS' | 'MANUAL';

export interface EmpAllocationSettings {
  /** standard working hours per month used for HOURS allocation */
  workHoursPerMonth: number;
  /** standard working days per month used for DAYS allocation */
  workDaysPerMonth: number;
}
export const DEFAULT_EMP_SETTINGS: EmpAllocationSettings = { workHoursPerMonth: 160, workDaysPerMonth: 22 };

/** Amount of one allocation line. MANUAL: `value` is an amount in minor units. */
export function employeeAllocationAmount(monthlyCost: Minor, method: EmpMethod, value: number, s: EmpAllocationSettings = DEFAULT_EMP_SETTINGS): Minor {
  if (!(value >= 0)) throw new Error('Allocation value cannot be negative');
  switch (method) {
    case 'PERCENT':
      return percentOf(monthlyCost, value);
    case 'HOURS':
      return mulDiv(monthlyCost, scale4(value), Math.round(s.workHoursPerMonth * 10000));
    case 'DAYS':
      return mulDiv(monthlyCost, scale4(value), Math.round(s.workDaysPerMonth * 10000));
    case 'MANUAL':
      return Math.round(value);
  }
}

export interface EmployeeMonthCheck {
  ok: boolean;
  allocated: Minor;
  /** monthly cost not allocated to any project = internal/overhead cost */
  internal: Minor;
  overBy: Minor;
}

/** An employee's cost can never be allocated above 100% (no double counting). */
export function checkEmployeeMonth(monthlyCost: Minor, projectAmounts: Minor[]): EmployeeMonthCheck {
  const allocated = projectAmounts.reduce((a, b) => a + b, 0);
  return { ok: allocated <= monthlyCost, allocated, internal: Math.max(0, monthlyCost - allocated), overBy: Math.max(0, allocated - monthlyCost) };
}

/** Prorated monthly payroll for a month given join/leave dates (calendar days). */
export function proratedMonthlyCost(monthlyCost: Minor, activeDays: number, daysInMonth: number): Minor {
  if (activeDays >= daysInMonth) return monthlyCost;
  if (activeDays <= 0) return 0;
  return mulDiv(monthlyCost, activeDays, daysInMonth);
}

// ───────────────────────────── Company expense allocation ─────────────────────────────

export type AllocMethodT = 'FIXED' | 'PERCENT' | 'HOURS' | 'REVENUE_PERCENT';

export interface AllocRow {
  /** free-form key (row id / project id) */
  key: string;
  method: AllocMethodT;
  /** FIXED: amount in MINOR units; PERCENT: percentage; HOURS: hours; REVENUE_PERCENT: ignored */
  value: number;
  /** REVENUE_PERCENT: revenue (minor units) of the target project */
  revenue?: Minor;
}

export interface AllocResult {
  amounts: Minor[];
  allocated: Minor;
  /** remainder that stays as company overhead */
  overhead: Minor;
}

/**
 * Allocation semantics:
 *  1. FIXED rows take their fixed amount, PERCENT rows take pct of the total.
 *  2. Whatever remains is the POOL, shared by HOURS rows (by hours) or REVENUE_PERCENT rows (by revenue).
 *     A single expense may use only one pool method.
 *  3. Anything not allocated stays as company overhead.
 * Throws when allocations exceed 100% of the expense.
 */
export function computeExpenseAllocations(total: Minor, rows: AllocRow[]): AllocResult {
  if (total <= 0) throw new Error('Expense amount must be positive');
  const hasHours = rows.some((r) => r.method === 'HOURS');
  const hasRev = rows.some((r) => r.method === 'REVENUE_PERCENT');
  if (hasHours && hasRev) throw new Error('Use either hours-based or revenue-based sharing for one expense, not both');
  if (rows.some((r) => !(r.value >= 0))) throw new Error('Allocation values cannot be negative');

  const amounts: Minor[] = rows.map(() => 0);
  let used = 0;
  rows.forEach((r, i) => {
    if (r.method === 'FIXED') amounts[i] = Math.round(r.value);
    else if (r.method === 'PERCENT') amounts[i] = percentOf(total, r.value);
  });
  const pctRows = rows.map((r, i) => ({ r, i })).filter((x) => x.r.method === 'PERCENT');
  const pctSum = pctRows.reduce((a, x) => a + x.r.value, 0);
  if (pctSum > 100.0001) throw new Error(`Percentage allocations add up to ${pctSum}% (max 100%)`);
  // percentages that total 100% must consume the expense exactly (largest-remainder), so no paisa is lost to rounding
  if (pctRows.length > 1 && Math.abs(pctSum - 100) < 0.0001) {
    const shares = distribute(total, pctRows.map((x) => x.r.value));
    pctRows.forEach((x, k) => (amounts[x.i] = shares[k]));
  }
  used = amounts.reduce((a, b) => a + b, 0);
  if (used > total) throw new Error('Allocations exceed the expense amount');

  const poolRows = rows.map((r, i) => ({ r, i })).filter((x) => x.r.method === 'HOURS' || x.r.method === 'REVENUE_PERCENT');
  if (poolRows.length) {
    const pool = total - used;
    const weights = poolRows.map((x) => (x.r.method === 'HOURS' ? x.r.value : Math.max(0, x.r.revenue ?? 0)));
    if (weights.reduce((a, b) => a + b, 0) <= 0) throw new Error(hasHours ? 'Enter hours for the hours-based allocation' : 'Selected projects have no revenue to share by');
    const shares = distribute(pool, weights);
    poolRows.forEach((x, k) => (amounts[x.i] = shares[k]));
    used += shares.reduce((a, b) => a + b, 0);
  }
  if (used > total) throw new Error('Allocations exceed the expense amount');
  return { amounts, allocated: used, overhead: total - used };
}
