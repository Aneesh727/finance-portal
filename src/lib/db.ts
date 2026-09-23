import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@/db/schema';

type G = typeof globalThis & { __pool?: Pool; __db?: NodePgDatabase<typeof schema> };
const g = globalThis as G;

function makePool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // never let a runaway query hold a connection forever
    statement_timeout: 60_000,
    idle_in_transaction_session_timeout: 60_000,
  });
  pool.on('error', (e) => console.error('[db] idle client error', e.message));
  return pool;
}

export function getPool(): Pool {
  if (!g.__pool) g.__pool = makePool();
  return g.__pool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!g.__db) g.__db = drizzle(getPool(), { schema });
  return g.__db;
}

/** lazy proxy so importing this module never opens a connection (safe during `next build`) */
export const db: NodePgDatabase<typeof schema> = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** either the pool db or a transaction */
export type Executor = Db | Tx;

export async function closeDb() {
  if (g.__pool) {
    await g.__pool.end();
    g.__pool = undefined;
    g.__db = undefined;
  }
}
