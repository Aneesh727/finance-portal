import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { employeeAllocationBody } from '@/lib/validators';
import { setEmployeeAllocation, monthlyCostFor } from '@/lib/services/employee-alloc';
import { dateStr } from '@/lib/schemas';
import { monthStart, todayStr } from '@/lib/dates';
import { projectScopeSql } from '@/lib/access';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'allocations.manage', query: z.object({ month: dateStr.optional() }) }, async ({ query, user }) => {
  const month = monthStart(query.month ?? todayStr());
  const emps = (await db.execute(sql`SELECT id, name, role, monthly_cost, start_date, end_date FROM resources WHERE type='EMPLOYEE' AND archived_at IS NULL AND status='ACTIVE' ORDER BY name`)).rows as { id: string; name: string; role: string; monthly_cost: string; start_date: string | null; end_date: string | null }[];
  const allocs = (await db.execute(sql`SELECT ea.*, p.name AS project_name, p.code AS project_code FROM employee_allocations ea LEFT JOIN projects p ON p.id = ea.project_id WHERE ea.month = ${month}::date AND (ea.project_id IS NULL OR ${projectScopeSql(user, 'p')})`)).rows as Record<string, unknown>[];
  return {
    month,
    employees: emps.map((e) => {
      const rows = allocs.filter((a) => a.resource_id === e.id);
      const monthly = monthlyCostFor({ monthlyCost: e.monthly_cost, startDate: e.start_date, endDate: e.end_date }, month);
      const allocated = rows.reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0);
      return {
        id: e.id, name: e.name, role: e.role, monthlyCost: monthly, allocated, internal: Math.max(0, monthly - allocated),
        rows: rows.map((r) => ({ projectId: r.project_id, projectName: r.project_name, projectCode: r.project_code, method: r.method, value: r.value, amount: r.amount, notes: r.notes })),
      };
    }),
  };
});

export const PUT = route({ perm: 'allocations.manage', body: employeeAllocationBody }, async ({ body, user, actor }) => db.transaction((tx) => setEmployeeAllocation(tx, { user, actor }, body)));
