import { sql } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** tables included in the portable JSON export (secrets and transient tables are excluded). `pg_dump` remains the real disaster-recovery backup. */
const TABLES = [
  'company', 'settings', 'tax_rates', 'payment_terms', 'exchange_rates', 'categories', 'roles', 'permissions', 'role_permissions', 'clients', 'vendors', 'resources', 'resource_rate_history',
  'projects', 'project_members', 'project_budgets', 'milestones', 'project_costs', 'project_resources', 'project_adjustments', 'invoices', 'payments', 'recurring_rules', 'expenses', 'expense_allocations',
  'employee_allocations', 'retainers', 'retainer_terms', 'retainer_periods', 'deals', 'deal_scenarios', 'deal_cost_lines', 'approvals', 'attachments', 'audit_logs',
] as const;

export const GET = route({ perm: 'backup.run', rate: { name: 'backup', max: 5, windowSec: 3600, by: 'user' } }, async ({ audit }) => {
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), format: 'finance-portal-export/1', note: 'Money amounts are decimal strings in each record\'s own currency. Password hashes and sessions are never exported.' };
  const counts: Record<string, number> = {};
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    for (const t of TABLES) {
      const rows = (await tx.execute(sql`SELECT * FROM ${sql.identifier(t)}`)).rows;
      out[t] = rows;
      counts[t] = rows.length;
    }
    out.users = (await tx.execute(sql`SELECT id, email, name, role_id, active, created_at FROM users`)).rows;
  });
  await audit(db, { action: 'backup.export', entityType: 'backup', summary: `Exported a JSON data backup (${Object.values(counts).reduce((a, b) => a + b, 0)} records)` });
  return new Response(JSON.stringify(out), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="finance-portal-export-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'private, no-store' },
  });
});
