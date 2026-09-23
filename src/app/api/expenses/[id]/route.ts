import { eq, sql } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { expenseAllocations, expenses, projects } from '@/db/schema';
import { isProjectAccessible } from '@/lib/access';
import { expensePatch } from '@/lib/validators';
import { updateExpense } from '@/lib/services/expenses';
import { notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

async function load(id: string, user: Parameters<typeof isProjectAccessible>[0]) {
  const [e] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!e) throw notFound('Expense');
  if (e.projectId && !(await isProjectAccessible(user, e.projectId))) throw notFound('Expense');
  return e;
}

export const GET = route({ perm: 'expenses.view' }, async ({ id, user }) => {
  const e = await load(id(), user);
  const allocations = await db.select({ a: expenseAllocations, projectName: projects.name, projectCode: projects.code }).from(expenseAllocations).leftJoin(projects, eq(projects.id, expenseAllocations.projectId)).where(eq(expenseAllocations.expenseId, e.id));
  const total = Number(e.amount);
  const allocated = allocations.reduce((a, r) => a + Number(r.a.amount), 0);
  return { expense: e, allocations: allocations.map((r) => ({ ...r.a, projectName: r.projectName, projectCode: r.projectCode })), overhead: Math.round((total - allocated) * 100) / 100 };
});

export const PATCH = route({ perm: 'expenses.create', body: expensePatch }, async ({ id, body, user, actor }) => {
  const e = await load(id(), user);
  return db.transaction((tx) => updateExpense(tx, { user, actor }, e.id, body));
});
void sql;
