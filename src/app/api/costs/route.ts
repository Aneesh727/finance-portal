import { z } from 'zod';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { route, created, listQuery, likePattern, reply, isUuid } from '@/lib/api';
import { db } from '@/lib/db';
import { categories, projectCosts, projects, resources, vendors, users } from '@/db/schema';
import { orderBy, pageMeta } from '@/lib/crud';
import { projectScope, getAccessibleProject } from '@/lib/access';
import { costBody } from '@/lib/validators';
import { createCost } from '@/lib/services/costs';
import { COST_KINDS, COST_STATUSES } from '@/db/schema';
import { badRequest } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const query = listQuery.extend({
  projectId: z.string().optional(),
  categoryId: z.string().optional(),
  vendorId: z.string().optional(),
  resourceId: z.string().optional(),
  kind: z.enum(COST_KINDS).optional(),
  status: z.enum(COST_STATUSES).optional(),
  voided: z.enum(['0', '1', 'all']).default('0'),
});

export const GET = route({ perm: 'costs.view', query }, async ({ query, user }) => {
  for (const k of ['projectId', 'categoryId', 'vendorId', 'resourceId'] as const) if (query[k] && !isUuid(query[k])) throw badRequest(`Invalid ${k}.`);
  const c = projectCosts;
  const conds = [
    projectScope(user),
    query.voided === 'all' ? undefined : query.voided === '1' ? sql`${c.archivedAt} is not null` : sql`${c.archivedAt} is null`,
    query.projectId ? eq(c.projectId, query.projectId) : undefined,
    query.categoryId ? eq(c.categoryId, query.categoryId) : undefined,
    query.vendorId ? eq(c.vendorId, query.vendorId) : undefined,
    query.resourceId ? eq(c.resourceId, query.resourceId) : undefined,
    query.kind ? eq(c.kind, query.kind) : undefined,
    query.status ? eq(c.status, query.status) : undefined,
    query.from ? sql`${c.date} >= ${query.from}::date` : undefined,
    query.to ? sql`${c.date} <= ${query.to}::date` : undefined,
    query.q ? or(ilike(c.name, likePattern(query.q)), ilike(c.description, likePattern(query.q)), ilike(vendors.name, likePattern(query.q)), ilike(projects.name, likePattern(query.q)), ilike(projects.code, likePattern(query.q))) : undefined,
  ].filter(Boolean) as never[];
  const where = and(...conds);
  const base = db.select({ c, projectName: projects.name, projectCode: projects.code, projectCurrency: projects.currency, category: categories.name, vendor: vendors.name, resource: resources.name, createdBy: users.name })
    .from(c).innerJoin(projects, eq(projects.id, c.projectId)).innerJoin(categories, eq(categories.id, c.categoryId))
    .leftJoin(vendors, eq(vendors.id, c.vendorId)).leftJoin(resources, eq(resources.id, c.resourceId)).leftJoin(users, eq(users.id, c.createdById));
  const [agg] = await db.select({ total: sql<number>`count(*)::int`, actual: sql<string>`coalesce(sum(case when ${c.kind}='ACTUAL' and ${c.status} in ('APPROVED','PAID') and ${c.archivedAt} is null then round(${c.amount}*100) else 0 end),0)::text` })
    .from(c).innerJoin(projects, eq(projects.id, c.projectId)).leftJoin(vendors, eq(vendors.id, c.vendorId)).where(where);
  const rows = await base.where(where)
    .orderBy(...orderBy({ id: c.id, date: c.date, name: c.name, amount: c.amount, createdAt: c.createdAt, project: projects.name, category: categories.name }, query.sort, query.dir, 'date'))
    .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
  return reply(rows.map((r) => ({ ...r.c, projectName: r.projectName, projectCode: r.projectCode, projectCurrency: r.projectCurrency, category: r.category, vendor: r.vendor, resource: r.resource, createdBy: r.createdBy })), {
    meta: { ...pageMeta(query.page, query.pageSize, agg.total), actualTotalMinor: Number(agg.actual) },
  });
});

export const POST = route({ perm: 'costs.create', body: costBody }, async ({ body, user, actor }) => {
  await getAccessibleProject(user, body.projectId);
  const res = await db.transaction((tx) => createCost(tx, { user, actor }, body));
  return created(res);
});
