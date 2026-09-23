/**
 * Daily housekeeping. Safe to run any number of times (every step is idempotent):
 *   1. generate due recurring expenses
 *   2. issue due retainer fee invoices
 *   3. run the alert scan (overdue payments, renewals, budget/margin, missing timesheets ...)
 *   4. purge expired sessions, idempotency keys and old rate-limit rows
 * Schedule with cron / systemd timer, e.g.  15 6 * * *  cd /app && npm run jobs:daily
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import { db, closeDb } from '@/lib/db';
import { recurringRules, retainers, sessions, idempotencyKeys } from '@/db/schema';
import { generateForRule } from '@/lib/services/recurring-expenses';
import { generateRetainerInvoices } from '@/lib/services/retainers';
import { runNotificationScan } from '@/lib/services/alerts';
import { audit } from '@/lib/audit';
import { SYSTEM_ACTOR, jobContext } from './_ctx';

async function main() {
  const ctx = await jobContext();
  const out = { expenses: 0, invoices: 0, alerts: 0, purgedSessions: 0, purgedKeys: 0, errors: [] as string[] };

  for (const r of await db.select({ id: recurringRules.id, name: recurringRules.name }).from(recurringRules).where(eq(recurringRules.active, true))) {
    try { out.expenses += (await db.transaction((tx) => generateForRule(tx, ctx, r.id))).created; } catch (e) { out.errors.push(`recurring "${r.name}": ${(e as Error).message}`); }
  }
  for (const r of await db.select({ id: retainers.id }).from(retainers).where(eq(retainers.status, 'ACTIVE'))) {
    try { out.invoices += (await db.transaction((tx) => generateRetainerInvoices(tx, ctx, r.id))).length; } catch (e) { out.errors.push(`retainer ${r.id}: ${(e as Error).message}`); }
  }
  try { out.alerts = (await db.transaction((tx) => runNotificationScan(tx))).created; } catch (e) { out.errors.push(`alert scan: ${(e as Error).message}`); }

  const s = await db.delete(sessions).where(lt(sessions.expiresAt, sql`now() - interval '7 days'`)).returning({ id: sessions.id });
  const k = await db.delete(idempotencyKeys).where(and(lt(idempotencyKeys.createdAt, sql`now() - interval '2 days'`))).returning({ key: idempotencyKeys.key });
  out.purgedSessions = s.length; out.purgedKeys = k.length;

  await audit(db, SYSTEM_ACTOR, { action: 'job.daily', entityType: 'job', summary: `Daily job: ${out.expenses} recurring expense(s), ${out.invoices} retainer invoice(s), ${out.alerts} new alert(s)${out.errors.length ? `, ${out.errors.length} error(s)` : ''}`, new: out });
  console.log(JSON.stringify(out, null, 2));
  await closeDb();
  if (out.errors.length) process.exit(1);
}
main().catch(async (e) => { console.error('daily job failed:', e); await closeDb().catch(() => {}); process.exit(1); });
