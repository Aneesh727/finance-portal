import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/** Fresh schema for every run: drop everything in the TEST database and re-run the real migrations. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL || 'postgresql://portal:portal_dev_pw@localhost:5432/finance_portal_test';
  if (!/_test\b/.test(url)) throw new Error('Refusing to reset a database whose name does not end in _test');
  const pool = new Pool({ connectionString: url, max: 1 });
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  await migrate(drizzle(pool), { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  await pool.end();
}
