import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { projectBudgets, categories } from '@/db/schema';
import { getAccessibleProject } from '@/lib/access';
import { setBudgets } from '@/lib/services/projects';
import { nonNegMoney, uuid } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'costs.view' }, async ({ id, user }) => {
  const pid = id();
  const p = await getAccessibleProject(user, pid);
  const lines = await db.select({ categoryId: projectBudgets.categoryId, amount: projectBudgets.amount, name: categories.name }).from(projectBudgets).innerJoin(categories, eq(categories.id, projectBudgets.categoryId)).where(eq(projectBudgets.projectId, pid));
  return { budget: p.budget, categoryBudgets: lines };
});

const body = z.object({ budget: nonNegMoney.optional(), categoryBudgets: z.array(z.object({ categoryId: uuid, amount: nonNegMoney })).max(60).optional() });

export const PUT = route({ anyPerm: ['budgets.edit', 'projects.edit'], body }, async ({ id, body, user, actor }) => {
  const pid = id();
  await getAccessibleProject(user, pid);
  return db.transaction((tx) => setBudgets(tx, { user, actor }, pid, body));
});
