/**
 * Retainer maths. A retainer is a list of fee TERMS; renewal adds a term, so history is never rewritten.
 * Partial months (mid-month start / end / cancellation) are prorated by calendar days.
 */
import { mulDiv, scale4, type Minor } from '../money';
import { addDays, cmp, daysInMonth, diffDays, fmt, maxDate, minDate, monthEnd, monthsBetween, monthStart, parts, type DateStr } from '../dates';

export interface TermLike {
  monthlyFee: Minor;
  startDate: DateStr;
  endDate: DateStr;
  includedHours: number;
  overageRate: Minor;
}

export interface RetainerMonth {
  month: DateStr; // first of month
  /** fee revenue for the month (prorated when partial) */
  baseRevenue: Minor;
  includedHours: number;
  hoursUsed: number;
  overageHours: number;
  overageRevenue: Minor;
  revenue: Minor;
  activeDays: number;
}

/** effective end of a term, honouring cancellation */
export function effectiveEnd(term: TermLike, cancelledOn?: DateStr | null): DateStr {
  return cancelledOn ? minDate(term.endDate, cancelledOn) : term.endDate;
}

/** Fee revenue of one term for one calendar month (prorated by days). */
export function termMonthRevenue(term: TermLike, month: DateStr, cancelledOn?: DateStr | null): { revenue: Minor; activeDays: number } {
  const ms = monthStart(month);
  const me = monthEnd(month);
  const start = maxDate(term.startDate, ms);
  const end = minDate(effectiveEnd(term, cancelledOn), me);
  if (cmp(start, end) > 0) return { revenue: 0, activeDays: 0 };
  const activeDays = diffDays(start, end) + 1;
  const { y, m } = parts(ms);
  const dim = daysInMonth(y, m);
  const revenue = activeDays >= dim ? term.monthlyFee : mulDiv(term.monthlyFee, activeDays, dim);
  return { revenue, activeDays };
}

/** month-by-month revenue incl. overage for a retainer. `hoursByMonth` keyed by first-of-month. */
export function retainerMonths(terms: TermLike[], hoursByMonth: Record<string, number>, cancelledOn?: DateStr | null): RetainerMonth[] {
  if (!terms.length) return [];
  const sorted = [...terms].sort((a, b) => cmp(a.startDate, b.startDate));
  const first = sorted[0].startDate;
  const last = sorted.reduce((mx, t) => maxDate(mx, effectiveEnd(t, cancelledOn)), sorted[0].startDate);
  if (cmp(last, first) < 0) return [];
  const out: RetainerMonth[] = [];
  for (const month of monthsBetween(first, last)) {
    let base = 0, days = 0, included = 0, overageRate = 0, bestDays = -1;
    for (const t of sorted) {
      const r = termMonthRevenue(t, month, cancelledOn);
      base += r.revenue;
      days += r.activeDays;
      // the term covering most of the month decides included hours / overage rate
      if (r.activeDays > bestDays && r.activeDays > 0) {
        bestDays = r.activeDays;
        included = t.includedHours;
        overageRate = t.overageRate;
      }
    }
    if (days === 0) continue;
    const hoursUsed = hoursByMonth[month] ?? 0;
    const overageHours = included > 0 ? Math.max(0, hoursUsed - included) : 0;
    const overageRevenue = overageHours > 0 && overageRate > 0 ? mulDiv(overageRate, scale4(overageHours), 10000) : 0;
    out.push({ month, baseRevenue: base, includedHours: included, hoursUsed, overageHours, overageRevenue, revenue: base + overageRevenue, activeDays: days });
  }
  return out;
}

export function retainerTotalRevenue(terms: TermLike[], hoursByMonth: Record<string, number>, cancelledOn?: DateStr | null) {
  const months = retainerMonths(terms, hoursByMonth, cancelledOn);
  return {
    base: months.reduce((a, m) => a + m.baseRevenue, 0),
    overage: months.reduce((a, m) => a + m.overageRevenue, 0),
    total: months.reduce((a, m) => a + m.revenue, 0),
    months,
  };
}

/** Terms may not overlap: returns first overlapping pair (or null). */
export function findOverlap(terms: Pick<TermLike, 'startDate' | 'endDate'>[]): [number, number] | null {
  const idx = terms.map((t, i) => ({ t, i })).sort((a, b) => cmp(a.t.startDate, b.t.startDate));
  for (let k = 1; k < idx.length; k++) {
    if (cmp(idx[k].t.startDate, idx[k - 1].t.endDate) <= 0) return [idx[k - 1].i, idx[k].i];
  }
  return null;
}

export { addDays, fmt };
