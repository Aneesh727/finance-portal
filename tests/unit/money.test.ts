import { describe, it, expect } from 'vitest';
import { toMinor, fromMinor, mulDiv, distribute, percentOf, ratioPct, ratioPctFloor, formatMoney, formatCompact } from '@/lib/money';
import { check } from './_ledger';

describe('money primitives', () => {
  it('parses decimal strings exactly (no float drift)', () => {
    check('money', 'parse 1234.50', '1234.50', 123450, toMinor('1234.50'));
    check('money', 'parse 0.1+0.2 style', '0.30', 30, toMinor('0.30'));
    check('money', 'parse 1.005 rounds half up', '1.005', 101, toMinor('1.005'));
    check('money', 'parse number 19.99', 19.99, 1999, toMinor(19.99));
    check('money', 'parse negative', '-250.75', -25075, toMinor('-250.75'));
    check('money', 'parse null', null, 0, toMinor(null));
    check('money', 'parse large', '9999999999999.99', 999999999999999, toMinor('9999999999999.99'));
  });
  it('rejects garbage', () => {
    expect(() => toMinor('abc')).toThrow();
    expect(() => toMinor(NaN)).toThrow();
    expect(() => toMinor('1e400')).toThrow();
  });
  it('formats minor units back to exact string', () => {
    check('money', 'fromMinor', 123450, '1234.50', fromMinor(123450));
    check('money', 'fromMinor negative', -5, '-0.05', fromMinor(-5));
    check('money', 'fromMinor zero', 0, '0.00', fromMinor(0));
  });
  it('mulDiv rounds half away from zero and never overflows', () => {
    check('money', 'mulDiv 1/3', [100, 1, 3], 33, mulDiv(100, 1, 3));
    check('money', 'mulDiv half up', [5, 1, 2], 3, mulDiv(5, 1, 2));
    check('money', 'mulDiv negative half', [-5, 1, 2], -3, mulDiv(-5, 1, 2));
    check('money', 'mulDiv huge', [900000000000000, 18, 100], 162000000000000, mulDiv(900000000000000, 18, 100));
  });
  it('percentOf handles decimals', () => {
    check('money', '18% of 100000', [10000000, 18], 1800000, percentOf(10000000, 18));
    check('money', '12.5% of 80000.00', [8000000, 12.5], 1000000, percentOf(8000000, 12.5));
  });
  it('ratio helpers', () => {
    check('money', 'ratioPct 50%', [100, 200], 50, ratioPct(100, 200));
    check('money', 'ratioPct zero denom', [100, 0], null, ratioPct(100, 0));
    check('money', 'ratioPctFloor 99.999 stays 99.99', [9999900, 10000000], 99.99, ratioPctFloor(9999900, 10000000));
    check('money', 'ratioPct rounds 99.999 to 100', [9999900, 10000000], 100, ratioPct(9999900, 10000000));
  });
  it('distribute sums exactly to the total', () => {
    const parts = distribute(10000, [1, 1, 1]);
    check('money', 'distribute 100.00 in 3', [10000, [1, 1, 1]], 10000, parts.reduce((a, b) => a + b, 0));
    check('money', 'distribute parts', [10000, [1, 1, 1]], [3334, 3333, 3333], parts);
    check('money', 'distribute weighted', [1000, [2, 1]], [667, 333], distribute(1000, [2, 1]));
    check('money', 'distribute zero weights', [1000, [0, 0]], [0, 0], distribute(1000, [0, 0]));
  });
  it('formats INR in lakh/crore grouping', () => {
    expect(formatMoney(20000000, 'INR')).toBe('₹2,00,000');
    expect(formatMoney(12345, 'INR')).toBe('₹123.45');
    expect(formatCompact(20000000, 'INR')).toBe('₹2 L');
    expect(formatCompact(1500000000, 'INR')).toBe('₹1.5 Cr');
  });
});
