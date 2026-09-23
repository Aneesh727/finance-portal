/** Display helpers. Money is stored/transported as integer paise (calc results) or decimal strings (records). */
import { formatMoney, formatCompact, toMinor, formatPct } from '@/lib/money';
import { displayDate } from '@/lib/dates';

export { formatPct, toMinor };
/** integer paise → "₹1,23,456.00" */
export const inr = (minor: number | null | undefined, cur = 'INR') => (minor === null || minor === undefined ? '—' : formatMoney(minor, cur));
/** integer paise, whole rupees ("₹1,23,456") for tiles */
export const inr0 = (minor: number | null | undefined, cur = 'INR') => (minor === null || minor === undefined ? '—' : formatMoney(minor, cur, { decimals: false }));
export const inrC = (minor: number | null | undefined, cur = 'INR') => (minor === null || minor === undefined ? '—' : formatCompact(minor, cur));
/** decimal string "1234.50" → "₹1,234.50" */
export const money = (v: string | number | null | undefined, cur = 'INR') => (v === null || v === undefined || v === '' ? '—' : formatMoney(toMinor(v), cur));
export const pct = (p: number | null | undefined, d = 1) => (p === null || p === undefined ? '—' : formatPct(p, d));
export const dmy = (d: string | null | undefined) => (d ? displayDate(d.slice(0, 10)) : '—');
/** accepts ISO strings and Postgres timestamptz text ("2026-09-20 09:02:34.9+00") */
const toDate = (v: string) => new Date(/^\d{4}-\d{2}-\d{2} /.test(v) ? v.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00') : v);
export const dateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = toDate(iso);
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(d).replace(',', '');
};
export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - toDate(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return dmy(iso);
};
export const title = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w|\s\w/g, (c) => c.toUpperCase());
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
export const monthShort = (d: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(d.slice(0, 10) + 'T00:00:00Z'));
