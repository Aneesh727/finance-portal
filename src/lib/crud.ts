import { and, asc, desc, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Executor } from './db';
import { conflict, notFound } from './errors';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export const pageMeta = (page: number, pageSize: number, total: number): PageMeta => ({ page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });

/** whitelist-based ORDER BY so user input never reaches SQL */
export function orderBy(map: Record<string, AnyColumn | SQL>, sort: string | undefined, dir: 'asc' | 'desc', fallback: string): SQL[] {
  const col = map[sort ?? ''] ?? map[fallback];
  const primary = dir === 'asc' ? asc(col as AnyColumn) : desc(col as AnyColumn);
  const tie = map.id ? [asc(map.id as AnyColumn)] : [];
  return [primary as SQL, ...(tie as SQL[])];
}

/**
 * Optimistic-concurrency update. When `expected` is given and the row's version differs, throws 409
 * (someone else edited it). Always bumps `version`.
 */
export async function updateVersioned<T extends PgTable & { id: AnyColumn; version: AnyColumn }>(
  tx: Executor,
  table: T,
  id: string,
  expected: number | undefined,
  set: Record<string, unknown>,
  label: string,
  extraWhere?: SQL,
): Promise<Record<string, unknown>> {
  const where = and(eq(table.id, id), expected !== undefined ? eq(table.version, expected) : undefined, extraWhere);
  const rows = await (tx as never as { update: (t: T) => { set: (v: unknown) => { where: (w: unknown) => { returning: () => Promise<Record<string, unknown>[]> } } } })
    .update(table)
    .set({ ...set, version: sql`${table.version} + 1` })
    .where(where)
    .returning();
  if (rows[0]) return rows[0];
  const [exists] = await (tx as never as { select: (f: unknown) => { from: (t: unknown) => { where: (w: unknown) => { limit: (n: number) => Promise<unknown[]> } } } }).select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
  if (!exists) throw notFound(label);
  throw conflict(`This ${label.toLowerCase()} was changed by someone else while you were editing. Reload it and re-apply your changes.`, 'STALE_VERSION');
}

export const trimOrNull = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
