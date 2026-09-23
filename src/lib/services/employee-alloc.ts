import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Executor } from '@/lib/db';
import { employeeAllocations, projects, resources } from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { audit, type Actor } from '@/lib/audit';
import { notFound, unprocessable } from '@/lib/errors';
import { checkEmployeeMonth, employeeAllocationAmount, proratedMonthlyCost } from '@/lib/finance/allocation';
import { daysInMonth, diffDays, maxDate, minDate, monthEnd, monthStart, parts } from '@/lib/dates';
import { formatMoney, fromMinor, toMinor } from '@/lib/money';
import { getSettings } from '@/lib/settings';
import type { employeeAllocationBody } from '@/lib/validators';
import { evaluateProjectAlerts } from './alerts';

type Ctx = { user: AuthUser; actor: Actor };
type Input = z.infer<typeof employeeAllocationBody>;

/** the employee's payroll cost for a month, prorated for join / leave dates inside that month */
export function monthlyCostFor(r: { monthlyCost: string; startDate: string | null; endDate: string | null }, month: string) {
  const ms = monthStart(month), me = monthEnd(month);
  const full = toMinor(r.monthlyCost);
  const from = r.startDate ? maxDate(r.startDate, ms) : ms;
  const to = r.endDate ? minDate(r.endDate, me) : me;
  const active = to < from ? 0 : diffDays(from, to) + 1;
  return proratedMonthlyCost(full, active, daysInMonth(parts(ms).y, parts(ms).m));
}

export async function setEmployeeAllocation(tx: Executor, ctx: Ctx, input: Input) {
  const month = monthStart(input.month);
  const [r] = await tx.select().from(resources).where(eq(resources.id, input.resourceId)).limit(1);
  if (!r) throw notFound('Resource');
  if (r.type !== 'EMPLOYEE') throw unprocessable('Only employees are allocated monthly. Freelancers and vendors are costed by hours or paid amounts.', { fields: { resourceId: 'Not an employee' } });
  const s = await getSettings(tx);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'emp:' + r.id + month}))`);
  const monthly = monthlyCostFor(r, month);

  const seen = new Set<string>();
  for (const row of input.rows) {
    const k = row.projectId ?? 'INTERNAL';
    if (seen.has(k)) throw unprocessable('The same project appears twice for this employee and month.', { fields: { rows: 'Duplicate project' } });
    seen.add(k);
  }
  const projectIds = input.rows.map((x) => x.projectId).filter(Boolean) as string[];
  const found = projectIds.length ? await tx.select({ id: projects.id }).from(projects).where(sql`${projects.id} IN (${sql.join(projectIds.map((p) => sql`${p}::uuid`), sql`,`)})`) : [];
  if (found.length !== projectIds.length) throw unprocessable('One of the selected projects does not exist.', { fields: { rows: 'Project not found' } });

  const amounts = input.rows.map((row) => {
    try { return employeeAllocationAmount(monthly, row.method, row.method === 'MANUAL' ? toMinor(String(row.value)) : Number(row.value), s.allocation); }
    catch (e) { throw unprocessable((e as Error).message); }
  });
  const chk = checkEmployeeMonth(monthly, amounts);
  if (!chk.ok) throw unprocessable(`${r.name}'s cost for ${month.slice(0, 7)} is ${formatMoney(monthly, 'INR')} but the allocation adds up to ${formatMoney(chk.allocated, 'INR')}. It cannot go above 100%.`, { overBy: chk.overBy, fields: { rows: 'Above 100%' } }, 'ALLOCATION_OVER_100');

  const before = await tx.select({ p: employeeAllocations.projectId }).from(employeeAllocations).where(and(eq(employeeAllocations.resourceId, r.id), eq(employeeAllocations.month, month)));
  await tx.delete(employeeAllocations).where(and(eq(employeeAllocations.resourceId, r.id), eq(employeeAllocations.month, month)));
  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i];
    await tx.insert(employeeAllocations).values({ resourceId: r.id, projectId: row.projectId, projectKey: row.projectId ?? 'INTERNAL', month, method: row.method, value: String(row.value), monthlyCostSnapshot: fromMinor(monthly), amount: fromMinor(amounts[i]), notes: row.notes });
  }
  await audit(tx, ctx.actor, { action: 'employee_allocation.set', entityType: 'resource', entityId: r.id, summary: `Allocated ${r.name} for ${month.slice(0, 7)}: ${formatMoney(chk.allocated, 'INR')} of ${formatMoney(monthly, 'INR')} to projects, ${formatMoney(chk.internal, 'INR')} internal`, new: { month, rows: input.rows } });
  for (const pid of new Set([...projectIds, ...(before.map((b) => b.p).filter(Boolean) as string[])])) await evaluateProjectAlerts(tx, pid);
  return { monthlyCost: monthly, allocated: chk.allocated, internal: chk.internal, amounts };
}
