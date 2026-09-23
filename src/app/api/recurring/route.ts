import { desc, eq, sql } from 'drizzle-orm';
import { route, created } from '@/lib/api';
import { db } from '@/lib/db';
import { categories, recurringRules, vendors, projects } from '@/db/schema';
import { recurringBody } from '@/lib/validators';
import { createRule, upcoming } from '@/lib/services/recurring-expenses';
import { todayStr } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'expenses.view' }, async ({ user }) => {
  const rows = await db.select({ r: recurringRules, category: categories.name, vendor: vendors.name, projectName: projects.name, projectCode: projects.code })
    .from(recurringRules).innerJoin(categories, eq(categories.id, recurringRules.categoryId)).leftJoin(vendors, eq(vendors.id, recurringRules.vendorId)).leftJoin(projects, eq(projects.id, recurringRules.projectId))
    .orderBy(desc(recurringRules.active), recurringRules.name);
  void user;
  return rows.map((x) => ({ ...x.r, category: x.category, vendor: x.vendor, projectName: x.projectName, projectCode: x.projectCode, next: upcoming(x.r, todayStr(), 3) }));
});

export const POST = route({ perm: 'expenses.edit', body: recurringBody }, async ({ body, user, actor }) => created(await db.transaction((tx) => createRule(tx, { user, actor }, body))));
void sql;
