/**
 * Calculation accuracy ledger (spec §50): every check records Input / Expected / Actual / Pass-Fail.
 * The ledger is written to reports/calc-accuracy.md after the run.
 */
import { afterAll, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

interface Row { area: string; name: string; input: string; expected: string; actual: string; pass: boolean }
const rows: Row[] = [];

export function check<T>(area: string, name: string, input: unknown, expected: T, actual: T) {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  rows.push({ area, name, input: JSON.stringify(input), expected: JSON.stringify(expected), actual: JSON.stringify(actual), pass });
  expect(actual).toEqual(expected);
}

afterAll(() => {
  if (!rows.length) return;
  const dir = path.join(process.cwd(), 'reports', 'ledger');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${(expect.getState().testPath ?? 'unit').split('/').pop()}.json`);
  fs.writeFileSync(file, JSON.stringify(rows, null, 1));
});
