/**
 * Money primitives.
 *
 * All arithmetic is done on INTEGER MINOR UNITS (paise/cents) so there is never floating point drift.
 * Database numerics arrive as strings ("1234.50"); `toMinor` parses them exactly (no float multiply).
 */

export type Minor = number;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** Parse a decimal string / number / null into integer minor units, rounding half away from zero at 2dp. */
export function toMinor(v: string | number | null | undefined): Minor {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Invalid amount');
    v = v.toString();
    if (/e/i.test(v)) v = Number(v).toFixed(8);
  }
  const s = v.trim();
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`Invalid amount: "${v}"`);
  const sign = m[1] === '-' ? -1 : 1;
  const whole = m[2] || '0';
  const frac = (m[3] ?? '').padEnd(3, '0');
  let minor = BigInt(whole) * 100n + BigInt(frac.slice(0, 2));
  if (frac[2] >= '5') minor += 1n; // half away from zero (on magnitude)
  const out = Number(minor) * sign;
  if (!Number.isSafeInteger(out)) throw new Error('Amount too large');
  return out === 0 ? 0 : out;
}

/** integer minor units -> "1234.50" (always 2 decimals, exact) */
export function fromMinor(m: Minor): string {
  const neg = m < 0;
  const abs = Math.abs(Math.trunc(m));
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${neg && (whole > 0 || frac !== '00') ? '-' : ''}${whole}.${frac}`;
}

/** (a * num) / den with round-half-away-from-zero, using BigInt so it can never overflow or drift. */
export function mulDiv(a: Minor, num: number, den: number): Minor {
  if (den === 0) throw new Error('Division by zero');
  if (!Number.isInteger(a) || !Number.isInteger(num) || !Number.isInteger(den)) {
    throw new Error('mulDiv requires integers');
  }
  const A = BigInt(a);
  const N = BigInt(num);
  let D = BigInt(den);
  let numer = A * N;
  if (D < 0n) {
    D = -D;
    numer = -numer;
  }
  const neg = numer < 0n;
  const absN = neg ? -numer : numer;
  let q = absN / D;
  const r = absN % D;
  if (r * 2n >= D) q += 1n;
  const res = Number(neg ? -q : q);
  if (!Number.isSafeInteger(res)) throw new Error('Amount too large');
  return res === 0 ? 0 : res;
}

/** Percentage/decimal number (max 4 decimals) -> integer scaled by 10^4 */
export function scale4(v: number | string): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) throw new Error('Invalid number');
  return Math.round(n * 10000);
}

/** amount * (pct / 100) where pct may have up to 4 decimals */
export function percentOf(amount: Minor, pct: number | string): Minor {
  return mulDiv(amount, scale4(pct), 1_000_000);
}

/** ratio as percentage with 2 decimals, rounded half-up (e.g. 12.35). null when denominator <= 0. */
export function ratioPct(numer: Minor, denom: Minor): number | null {
  if (denom <= 0) return null;
  return mulDiv(numer, 10000, denom) / 100;
}

/** ratio as percentage with 2 decimals, TRUNCATED (used for utilisation so 99.999% never displays as 100%). */
export function ratioPctFloor(numer: Minor, denom: Minor): number | null {
  if (denom <= 0) return null;
  const q = (BigInt(numer) * 10000n) / BigInt(denom);
  return Number(q) / 100;
}

/**
 * Split `total` across `weights` so parts sum EXACTLY to total (largest remainder method).
 * Zero/negative total weight -> all zero.
 */
export function distribute(total: Minor, weights: number[]): Minor[] {
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sumW <= 0 || total === 0) return weights.map(() => 0);
  const sign = total < 0 ? -1 : 1;
  const T = BigInt(Math.abs(total));
  const scaled = weights.map((w) => BigInt(Math.round(w * 10000)));
  const S = scaled.reduce((a, b) => a + b, 0n);
  const parts = scaled.map((w) => (T * w) / S);
  const rems = scaled.map((w, i) => ({ i, r: (T * w) % S }));
  let leftover = T - parts.reduce((a, b) => a + b, 0n);
  rems.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; leftover > 0n && k < rems.length; k++, leftover--) parts[rems[k].i] += 1n;
  return parts.map((p) => Number(p) * sign);
}

export function sum(nums: Minor[]): Minor {
  let t = 0;
  for (const n of nums) t += n;
  if (!Number.isSafeInteger(t)) throw new Error('Amount too large');
  return t;
}

export const clampMin0 = (n: number) => (n < 0 ? 0 : n);

export function assertSafe(n: number) {
  if (!Number.isSafeInteger(n) || Math.abs(n) > MAX_SAFE) throw new Error('Amount too large');
}

// ─────────── formatting (display only) ───────────

export function formatMoney(minor: Minor | null | undefined, currency = 'INR', opts: { locale?: string; decimals?: boolean } = {}): string {
  if (minor === null || minor === undefined) return '—';
  const locale = opts.locale ?? (currency === 'INR' ? 'en-IN' : 'en-US');
  const value = minor / 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: opts.decimals === false ? 0 : Math.abs(minor) % 100 === 0 ? 0 : 2,
    maximumFractionDigits: opts.decimals === false ? 0 : 2,
  }).format(value);
}

/** Compact Indian style: 1.2 Cr / 35.5 L / 12.3 K */
export function formatCompact(minor: Minor | null | undefined, currency = 'INR'): string {
  if (minor === null || minor === undefined) return '—';
  const v = minor / 100;
  const abs = Math.abs(v);
  const sym = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency + ' ';
  const sign = v < 0 ? '-' : '';
  if (currency === 'INR') {
    if (abs >= 1e7) return `${sign}${sym}${trim(abs / 1e7)} Cr`;
    if (abs >= 1e5) return `${sign}${sym}${trim(abs / 1e5)} L`;
    if (abs >= 1e3) return `${sign}${sym}${trim(abs / 1e3)} K`;
    return `${sign}${sym}${trim(abs)}`;
  }
  if (abs >= 1e9) return `${sign}${sym}${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}${sym}${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${sym}${trim(abs / 1e3)}K`;
  return `${sign}${sym}${trim(abs)}`;
}
function trim(n: number) {
  return (Math.round(n * 100) / 100).toString();
}

export function formatPct(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  return `${p.toFixed(digits)}%`;
}
