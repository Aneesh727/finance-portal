import { z } from 'zod';
import { fromMinor, toMinor } from './money';
import { isDateStr } from './dates';
import { uuidSchema } from './api';

/** Money input: number or string, max 2 decimals, up to 13 integer digits. Normalised to "1234.50". */
export const moneyStr = z.union([z.number(), z.string()]).transform((v, ctx) => {
  let s: string;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid amount (up to 2 decimals)' });
      return z.NEVER;
    }
    s = v.toFixed(2);
  } else s = v.trim().replace(/,/g, '');
  if (!/^-?\d{1,13}(\.\d{1,2})?$/.test(s)) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid amount (up to 2 decimals)' });
    return z.NEVER;
  }
  return fromMinor(toMinor(s));
});
export const positiveMoney = moneyStr.refine((v) => typeof v === 'string' && toMinor(v) > 0, 'Amount must be greater than zero');
export const nonNegMoney = moneyStr.refine((v) => typeof v === 'string' && toMinor(v) >= 0, 'Amount cannot be negative');

/** decimal number with limits (hours, rates, percentages) */
export const num = (min = 0, max = 1e9) => z.coerce.number().finite().min(min).max(max);
export const pct = z.coerce.number().finite().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100');

export const dateStr = z.string().refine(isDateStr, 'Use a valid date (YYYY-MM-DD)');
export const optDate = dateStr.nullish().transform((v) => v ?? null);
export const uuid = uuidSchema;
export const optUuid = z.union([uuidSchema, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));

export const currency = z.string().regex(/^[A-Za-z]{3}$/, 'Use a 3-letter currency code').transform((s) => s.toUpperCase());
export const text = (max = 500) => z.string().trim().max(max);
export const reqText = (max = 200) => z.string().trim().min(1, 'Required').max(max);
export const optText = (max = 2000) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN format')
  .nullish()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));
export const email = z.string().trim().toLowerCase().email('Invalid email').max(200).nullish().or(z.literal('')).transform((v) => (v ? v : null));
export const version = z.coerce.number().int().min(1).optional();

export const idParam = z.object({ id: uuidSchema });

/** state code from a GSTIN (first 2 digits) */
export const stateFromGstin = (g?: string | null) => (g && /^\d{2}/.test(g) ? g.slice(0, 2) : null);
