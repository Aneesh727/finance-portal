/**
 * Date helpers. Calendar dates are plain "YYYY-MM-DD" strings everywhere (DB `date` columns in string mode),
 * so there is no timezone drift. "Today" is evaluated in the configured business timezone.
 */

export type DateStr = string;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateStr(s: unknown): s is DateStr {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function parts(s: DateStr): { y: number; m: number; d: number } {
  const m = DATE_RE.exec(s);
  if (!m) throw new Error(`Invalid date: ${s}`);
  return { y: +m[1], m: +m[2], d: +m[3] };
}

export function fmt(y: number, m: number, d: number): DateStr {
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

export function todayStr(tz = process.env.APP_TIMEZONE || 'Asia/Kolkata', now = new Date()): DateStr {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(now); // en-CA => YYYY-MM-DD
}

export function monthStart(s: DateStr): DateStr {
  const { y, m } = parts(s);
  return fmt(y, m, 1);
}

export function monthEnd(s: DateStr): DateStr {
  const { y, m } = parts(s);
  return fmt(y, m, daysInMonth(y, m));
}

/** add N months, clamping the day to the target month's length (31 Jan + 1M = 28/29 Feb) */
export function addMonths(s: DateStr, n: number): DateStr {
  const { y, m, d } = parts(s);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addDays(s: DateStr, n: number): DateStr {
  const { y, m, d } = parts(s);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** whole days from a to b (b - a) */
export function diffDays(a: DateStr, b: DateStr): number {
  const pa = parts(a), pb = parts(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

export function cmp(a: DateStr, b: DateStr): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDate(a: DateStr, b: DateStr) { return a > b ? a : b; }
export function minDate(a: DateStr, b: DateStr) { return a < b ? a : b; }

/** first-of-month strings from a's month to b's month inclusive */
export function monthsBetween(a: DateStr, b: DateStr): DateStr[] {
  const out: DateStr[] = [];
  let cur = monthStart(a);
  const end = monthStart(b);
  let guard = 0;
  while (cur <= end && guard++ < 1200) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

/** Indian financial year helpers. fyStartMonth default 4 (April). FY label like "2025-26". */
export function fyStartOf(s: DateStr, fyStartMonth = 4): DateStr {
  const { y, m } = parts(s);
  const startYear = m >= fyStartMonth ? y : y - 1;
  return fmt(startYear, fyStartMonth, 1);
}
export function fyEndOf(s: DateStr, fyStartMonth = 4): DateStr {
  return addDays(addMonths(fyStartOf(s, fyStartMonth), 12), -1);
}
export function fyLabel(s: DateStr, fyStartMonth = 4): string {
  const st = parts(fyStartOf(s, fyStartMonth));
  if (fyStartMonth === 1) return `${st.y}`;
  return `${st.y}-${((st.y + 1) % 100).toString().padStart(2, '0')}`;
}

/** DD/MM/YYYY display */
export function displayDate(s: DateStr | null | undefined, format = 'DD/MM/YYYY'): string {
  if (!s || !DATE_RE.test(s)) return '—';
  const { y, m, d } = parts(s);
  const dd = d.toString().padStart(2, '0'), mm = m.toString().padStart(2, '0');
  if (format === 'MM/DD/YYYY') return `${mm}/${dd}/${y}`;
  if (format === 'YYYY-MM-DD') return s;
  return `${dd}/${mm}/${y}`;
}

export function monthLabel(s: DateStr): string {
  const { y, m } = parts(s);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}
