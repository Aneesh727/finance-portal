/**
 * Remove ALL demo data (rows flagged is_demo) and demo users - in one transaction, in foreign-key order.
 * Real data is never touched. The immutable audit trail is kept (it has no foreign keys).
 *
 *   npm run db:remove-demo            (in production add --yes)
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, closeDb } from '@/lib/db';

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--yes')) {
    console.error('Refusing to run in production without --yes.');
    process.exit(2);
  }
  const counts: Record<string, number> = {};
  const del = async (t: { execute: typeof db.execute }, label: string, q: ReturnType<typeof sql>) => {
    const r = await t.execute(q);
    counts[label] = r.rowCount ?? 0;
  };
  await db.transaction(async (tx) => {
    const demoP = sql`(SELECT id FROM projects WHERE is_demo)`;
    await del(tx, 'approvals', sql`DELETE FROM approvals WHERE project_id IN ${demoP} OR requested_by_id IN (SELECT id FROM users WHERE is_demo)`);
    await del(tx, 'notifications', sql`DELETE FROM notifications n WHERE n.user_id IN (SELECT id FROM users WHERE is_demo) OR EXISTS (SELECT 1 FROM projects p WHERE p.is_demo AND (n.link LIKE '%' || p.id::text || '%' OR n.dedupe_key LIKE '%' || p.id::text || '%'))`);
    await del(tx, 'attachments', sql`DELETE FROM attachments WHERE project_id IN ${demoP}`);
    await del(tx, 'payments', sql`DELETE FROM payments WHERE is_demo OR project_id IN ${demoP}`);
    await del(tx, 'invoices', sql`DELETE FROM invoices WHERE is_demo OR project_id IN ${demoP}`);
    await del(tx, 'costs', sql`DELETE FROM project_costs WHERE is_demo OR project_id IN ${demoP}`);
    await del(tx, 'expenses', sql`DELETE FROM expenses WHERE is_demo OR project_id IN ${demoP}`);
    await del(tx, 'employee_allocations', sql`DELETE FROM employee_allocations WHERE is_demo OR project_id IN ${demoP} OR resource_id IN (SELECT id FROM resources WHERE is_demo)`);
    await del(tx, 'recurring_rules', sql`DELETE FROM recurring_rules WHERE is_demo`);
    await del(tx, 'project_resources', sql`DELETE FROM project_resources WHERE project_id IN ${demoP} OR resource_id IN (SELECT id FROM resources WHERE is_demo)`);
    await del(tx, 'project_adjustments', sql`DELETE FROM project_adjustments WHERE project_id IN ${demoP}`);
    await del(tx, 'deals', sql`DELETE FROM deals WHERE is_demo OR project_id IN ${demoP}`);
    await del(tx, 'retainers', sql`DELETE FROM retainers WHERE is_demo OR project_id IN ${demoP}`);
    await del(tx, 'projects', sql`DELETE FROM projects WHERE is_demo`);
    await del(tx, 'resources', sql`DELETE FROM resources WHERE is_demo`);
    await del(tx, 'vendors', sql`DELETE FROM vendors WHERE is_demo`);
    await del(tx, 'clients', sql`DELETE FROM clients WHERE is_demo`);
    await del(tx, 'users', sql`DELETE FROM users WHERE is_demo`);
    await tx.execute(sql`DELETE FROM idempotency_keys`);
  });
  console.log('Demo data removed:', JSON.stringify(counts));
  await closeDb();
}
main().catch(async (e) => { console.error('Could not remove demo data (nothing was changed):', e.cause?.message ?? e.message); await closeDb().catch(() => {}); process.exit(1); });
