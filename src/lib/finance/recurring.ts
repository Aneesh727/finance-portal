/**
 * Recurrence maths: generates the schedule of dates for a recurring expense/cost.
 * Anchor day is preserved (31st stays 31st where the month allows; otherwise the last day of the month).
 */
import { addMonths, cmp, monthStart, type DateStr, parts, fmt, daysInMonth } from '../dates';

export type FrequencyT = 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM';

export function frequencyToMonths(freq: FrequencyT | 'NONE', customMonths = 1): number {
  switch (freq) {
    case 'MONTHLY': return 1;
    case 'QUARTERLY': return 3;
    case 'YEARLY': return 12;
    case 'CUSTOM': return Math.max(1, Math.floor(customMonths));
    default: return 0;
  }
}

/** k-th occurrence date counted from the anchor (k = 0 is the start date). */
export function occurrenceAt(start: DateStr, intervalMonths: number, k: number): DateStr {
  const { y, m, d } = parts(start);
  const idx = y * 12 + (m - 1) + k * intervalMonths;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/**
 * All occurrence dates d with from <= d <= to, and d >= start, d <= end (if given).
 * Guarded to at most `limit` results.
 */
export function occurrences(args: { start: DateStr; intervalMonths: number; end?: DateStr | null; from: DateStr; to: DateStr; limit?: number }): DateStr[] {
  const { start, intervalMonths, end, from, to } = args;
  const limit = args.limit ?? 600;
  if (intervalMonths < 1) return [];
  const out: DateStr[] = [];
  for (let k = 0; k < 5000 && out.length < limit; k++) {
    const dt = occurrenceAt(start, intervalMonths, k);
    if (cmp(dt, to) > 0) break;
    if (end && cmp(dt, end) > 0) break;
    if (cmp(dt, from) >= 0) out.push(dt);
  }
  return out;
}

/** first-of-month buckets, useful for grouping forecasts */
export const bucket = (d: DateStr) => monthStart(d);
export { addMonths };
