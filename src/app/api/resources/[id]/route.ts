import { desc, eq, sql } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { employeeAllocations, projectResources, projects, resourceRateHistory, resources } from '@/db/schema';
import { notFound, unprocessable } from '@/lib/errors';
import { updateVersioned } from '@/lib/crud';
import { changeSummary, diffFields } from '@/lib/audit';
import { resourceBody } from '@/lib/validators';
import { version } from '@/lib/schemas';
import { canSeeRates, deriveRates, redactResource } from '@/lib/services/resources';
import { getSettings } from '@/lib/settings';
import { todayStr } from '@/lib/dates';
import { projectScope } from '@/lib/access';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'resources.view' }, async ({ id, user }) => {
  const rid = id();
  const [r] = await db.select().from(resources).where(eq(resources.id, rid)).limit(1);
  if (!r) throw notFound('Resource');
  const rates = canSeeRates(user);
  const assignments = await db
    .select({ a: projectResources, projectName: projects.name, projectCode: projects.code, projectId: projects.id, status: projects.status })
    .from(projectResources).innerJoin(projects, eq(projects.id, projectResources.projectId))
    .where(sql`${projectResources.resourceId} = ${rid} AND ${projectResources.archivedAt} IS NULL AND ${projectScope(user) ?? sql`true`}`)
    .orderBy(desc(projectResources.createdAt));
  const history = rates ? await db.select().from(resourceRateHistory).where(eq(resourceRateHistory.resourceId, rid)).orderBy(desc(resourceRateHistory.effectiveOn), desc(resourceRateHistory.createdAt)) : [];
  const allocs = rates
    ? await db.select({ n: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${employeeAllocations.amount}),0)` }).from(employeeAllocations).where(eq(employeeAllocations.resourceId, rid))
    : [];
  return {
    resource: redactResource(r, user),
    assignments: assignments.map((x) => ({
      id: x.a.id, projectId: x.projectId, projectName: x.projectName, projectCode: x.projectCode, projectStatus: x.status,
      plannedHours: x.a.plannedHours, actualHours: x.a.actualHours,
      ...(rates ? { costRate: x.a.costRate, billingRate: x.a.billingRate } : {}),
    })),
    rateHistory: history,
    allocationSummary: allocs[0] ?? null,
  };
});

const patch = resourceBody.partial().extend({ version });

export const PATCH = route({ perm: 'resources.manage', body: patch }, async ({ id, body, audit }) => {
  const rid = id();
  const s = await getSettings();
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(resources).where(eq(resources.id, rid)).limit(1);
    if (!old) throw notFound('Resource');
    const { version: v, ...fields } = body;
    const merged = { type: fields.type ?? old.type, hourlyCost: fields.hourlyCost ?? old.hourlyCost, dailyCost: fields.dailyCost ?? old.dailyCost, monthlyCost: fields.monthlyCost ?? old.monthlyCost };
    const set: Record<string, unknown> = { ...fields };
    if (fields.monthlyCost !== undefined && fields.hourlyCost === undefined && fields.dailyCost === undefined) Object.assign(set, deriveRates({ ...merged, hourlyCost: '0', dailyCost: '0' }, s));
    const sd = (set.startDate as string | null | undefined) ?? old.startDate, ed = (set.endDate as string | null | undefined) ?? old.endDate;
    if (sd && ed && ed < sd) throw unprocessable('End date cannot be before start date.');
    const row = await updateVersioned(tx, resources as never, rid, v, set, 'Resource') as typeof old;
    const rateChanged = ['hourlyCost', 'dailyCost', 'monthlyCost', 'billingRate'].some((k) => Number((row as never)[k]) !== Number((old as never)[k]));
    if (rateChanged) {
      // rate history is kept; existing project assignments keep their SNAPSHOT rates so historical cost never changes
      await tx.insert(resourceRateHistory).values({ resourceId: rid, effectiveOn: todayStr(), hourlyCost: row.hourlyCost, dailyCost: row.dailyCost, monthlyCost: row.monthlyCost, billingRate: row.billingRate });
    }
    const d = diffFields(old as never, row as never, Object.keys(set));
    await audit(tx, { action: 'resource.update', entityType: 'resource', entityId: rid, summary: changeSummary(`Resource ${old.name}:`, d), old: d.old, new: d.new });
    return row;
  });
});
