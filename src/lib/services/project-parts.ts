/** Milestones, resource assignments and revenue adjustments of a project. */
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '@/lib/db';
import { milestones, projectAdjustments, projectResources, projects, resources, invoices } from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { audit, changeSummary, diffFields, type Actor } from '@/lib/audit';
import { conflict, forbidden, notFound, unprocessable, ApiError } from '@/lib/errors';
import { formatMoney, fromMinor, toMinor } from '@/lib/money';
import { calculateResourceContribution } from '@/lib/finance/engine';
import { updateVersioned } from '@/lib/crud';
import { evaluateGuard, lockProject } from './costs';
import { evaluateProjectAlerts } from './alerts';
import { milestoneInput } from '@/lib/validators';
import { dateStr, moneyStr, num, optText, reqText, uuid, version, optDate, nonNegMoney } from '@/lib/schemas';

type Ctx = { user: AuthUser; actor: Actor };
type Project = typeof projects.$inferSelect;

async function loadProject(tx: Executor, id: string): Promise<Project> {
  const [p] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!p) throw notFound('Project');
  return p;
}
function assertEditable(p: Project) {
  if (p.archivedAt) throw unprocessable('This project is archived. Restore it first.', undefined, 'PROJECT_ARCHIVED');
  if (p.status === 'CANCELLED' || p.status === 'LOST') throw unprocessable(`A ${p.status.toLowerCase()} project cannot be changed.`, undefined, 'PROJECT_CLOSED');
}
const dOrder = (a?: string | null, b?: string | null) => { if (a && b && b < a) throw unprocessable('End / due date cannot be before the start date.', { fields: { dueDate: 'Before start date' } }); };

// ───────────── milestones ─────────────
export const milestonePatch = milestoneInput.partial().extend({ version: version.optional() });
export const milestoneCreate = milestoneInput;

export async function createMilestone(tx: Executor, ctx: Ctx, projectId: string, input: z.infer<typeof milestoneInput>) {
  const p = await loadProject(tx, projectId); assertEditable(p);
  dOrder(input.startDate, input.dueDate);
  const [{ n }] = (await tx.execute(sql`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM milestones WHERE project_id=${projectId}::uuid`)).rows as { n: number }[];
  const [row] = await tx.insert(milestones).values({ ...input, projectId, sortOrder: Number(n) }).returning();
  await audit(tx, ctx.actor, { action: 'milestone.create', entityType: 'milestone', entityId: row.id, projectId, summary: `Added milestone "${row.name}" (${formatMoney(toMinor(row.price), p.currency)}) to ${p.code}`, new: row });
  return row;
}

export async function updateMilestone(tx: Executor, ctx: Ctx, id: string, patch: z.infer<typeof milestonePatch>) {
  const [old] = await tx.select().from(milestones).where(eq(milestones.id, id)).limit(1);
  if (!old || old.archivedAt) throw notFound('Milestone');
  const p = await loadProject(tx, old.projectId); assertEditable(p);
  const { version: v, ...fields } = patch;
  dOrder(fields.startDate ?? old.startDate, fields.dueDate ?? old.dueDate);
  if (Object.keys(fields).length === 0) return old;
  const [{ n }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM invoices WHERE milestone_id=${id}::uuid AND status <> 'CANCELLED'`)).rows as { n: number }[];
  if (n > 0 && fields.price !== undefined && toMinor(fields.price) !== toMinor(old.price)) {
    throw conflict('This milestone already has invoices. Cancel them before changing its price.', 'MILESTONE_INVOICED');
  }
  const row = v !== undefined ? ((await updateVersioned(tx, milestones as never, id, v, fields, 'Milestone')) as typeof old)
    : (await tx.update(milestones).set({ ...fields, updatedAt: new Date() }).where(eq(milestones.id, id)).returning())[0];
  const d = diffFields(old as never, row as never, Object.keys(fields));
  await audit(tx, ctx.actor, { action: 'milestone.update', entityType: 'milestone', entityId: id, projectId: old.projectId, summary: changeSummary(`Milestone "${old.name}" on ${p.code}:`, d, p.currency), old: d.old, new: d.new });
  await evaluateProjectAlerts(tx, old.projectId);
  return row;
}

export async function deleteMilestone(tx: Executor, ctx: Ctx, id: string) {
  const [old] = await tx.select().from(milestones).where(eq(milestones.id, id)).limit(1);
  if (!old || old.archivedAt) throw notFound('Milestone');
  const p = await loadProject(tx, old.projectId); assertEditable(p);
  const [{ n }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM invoices WHERE milestone_id=${id}::uuid AND status <> 'CANCELLED'`)).rows as { n: number }[];
  if (n > 0) throw conflict('This milestone has invoices. Cancel the invoices first.', 'MILESTONE_INVOICED');
  await tx.update(milestones).set({ archivedAt: new Date() }).where(eq(milestones.id, id));
  await audit(tx, ctx.actor, { action: 'milestone.delete', entityType: 'milestone', entityId: id, projectId: old.projectId, summary: `Removed milestone "${old.name}" from ${p.code}`, old });
}

/** milestone payment status derived from its invoices/payments */
export async function milestonePaymentStatus(tx: Executor, projectId: string): Promise<Record<string, { invoiced: number; settled: number; status: 'NOT_INVOICED' | 'INVOICED' | 'PARTIALLY_PAID' | 'PAID' }>> {
  const r = await tx.execute(sql`
    SELECT i.milestone_id, COALESCE(SUM(ROUND(i.total*100)),0)::bigint AS invoiced,
      COALESCE(SUM((SELECT COALESCE(SUM(ROUND((pay.amount+pay.tds_amount)*100)),0) FROM payments pay WHERE pay.invoice_id=i.id AND pay.voided_at IS NULL)),0)::bigint AS settled
    FROM invoices i WHERE i.project_id=${projectId}::uuid AND i.milestone_id IS NOT NULL AND i.status <> 'CANCELLED' GROUP BY i.milestone_id`);
  const out: Record<string, { invoiced: number; settled: number; status: 'NOT_INVOICED' | 'INVOICED' | 'PARTIALLY_PAID' | 'PAID' }> = {};
  for (const x of r.rows as { milestone_id: string; invoiced: string; settled: string }[]) {
    const invoiced = Number(x.invoiced), settled = Number(x.settled);
    out[x.milestone_id] = { invoiced, settled, status: settled >= invoiced && invoiced > 0 ? 'PAID' : settled > 0 ? 'PARTIALLY_PAID' : 'INVOICED' };
  }
  return out;
}

// ───────────── resource assignments ─────────────
export const assignmentBody = z.object({
  resourceId: uuid,
  plannedHours: num(0, 100000).default(0),
  actualHours: num(0, 100000).default(0),
  paidAmount: nonNegMoney.default('0'),
  startDate: optDate,
  endDate: optDate,
  notes: optText(500),
  /** allow spend beyond budget (needs costs.approve) */
  overrideBudget: z.boolean().default(false),
  overrideReason: optText(500),
});
export const assignmentPatch = assignmentBody.omit({ resourceId: true }).partial().extend({ version: z.any().optional() });

const costOf = (hours: string | number, rate: string) => calculateResourceContribution(Number(hours), toMinor(rate), 0).cost;

async function guardAssignment(tx: Executor, ctx: Ctx, p: Project, deltaMinor: number, override: boolean, reason?: string | null) {
  if (deltaMinor <= 0) return;
  const g = await evaluateGuard(tx, p, { categoryId: '00000000-0000-0000-0000-000000000000', amountMinor: deltaMinor, deltaMinor, hasVendor: false, counts: true });
  if (!g.budgetBreach) return;
  if (!ctx.user.perms.has('costs.approve')) {
    throw forbidden(`${g.reasons.join('. ')}. Only someone who can approve costs may record spend beyond the budget.`, 'BUDGET_APPROVAL_REQUIRED');
  }
  if (!override) throw new ApiError(422, 'BUDGET_WOULD_BE_EXCEEDED', `${g.reasons.join('. ')}. Confirm the override (with a reason) to save anyway.`, { ...g.details, reasons: g.reasons });
  if (!reason) throw unprocessable('Please give a reason for exceeding the budget.', { fields: { overrideReason: 'Required' } });
}

export async function assignResource(tx: Executor, ctx: Ctx, projectId: string, input: z.infer<typeof assignmentBody>) {
  await lockProject(tx, projectId);
  const p = await loadProject(tx, projectId); assertEditable(p);
  const [r] = await tx.select().from(resources).where(eq(resources.id, input.resourceId)).limit(1);
  if (!r) throw unprocessable('That resource does not exist.', { fields: { resourceId: 'Not found' } });
  if (r.archivedAt || r.status === 'INACTIVE') throw unprocessable(`${r.name} is ${r.archivedAt ? 'archived' : 'inactive'} and cannot be assigned.`, { fields: { resourceId: 'Inactive' } });
  dOrder(input.startDate, input.endDate);
  const [dup] = await tx.select({ id: projectResources.id }).from(projectResources).where(and(eq(projectResources.projectId, projectId), eq(projectResources.resourceId, r.id), sql`${projectResources.archivedAt} is null`)).limit(1);
  if (dup) throw conflict(`${r.name} is already assigned to this project. Edit the existing assignment.`, 'DUPLICATE_ASSIGNMENT');
  const costRate = r.hourlyCost; // snapshot: later rate changes never rewrite history
  const billingRate = r.billingRate;
  const isEmp = r.type === 'EMPLOYEE';
  if (isEmp && toMinor(input.paidAmount) > 0) throw unprocessable('Employee pay is costed through allocations, not paid amounts.', { fields: { paidAmount: 'Not applicable' } });
  await guardAssignment(tx, ctx, p, isEmp ? 0 : costOf(input.actualHours, costRate), input.overrideBudget, input.overrideReason);
  const [row] = await tx.insert(projectResources).values({
    projectId, resourceId: r.id, plannedHours: String(input.plannedHours), actualHours: String(input.actualHours), costRate, billingRate, paidAmount: input.paidAmount,
    startDate: input.startDate, endDate: input.endDate, notes: input.notes,
  }).returning();
  await audit(tx, ctx.actor, { action: 'assignment.create', entityType: 'project_resource', entityId: row.id, projectId, summary: `Assigned ${r.name} (${r.type.toLowerCase()}) to ${p.code}: ${input.plannedHours}h planned` + (input.overrideBudget ? ` [budget override: ${input.overrideReason}]` : ''), new: row });
  await evaluateProjectAlerts(tx, projectId);
  return row;
}

export async function updateAssignment(tx: Executor, ctx: Ctx, id: string, patch: z.infer<typeof assignmentPatch>) {
  const [old] = await tx.select().from(projectResources).where(eq(projectResources.id, id)).limit(1);
  if (!old || old.archivedAt) throw notFound('Assignment');
  await lockProject(tx, old.projectId);
  const p = await loadProject(tx, old.projectId); assertEditable(p);
  const [r] = await tx.select().from(resources).where(eq(resources.id, old.resourceId)).limit(1);
  const { version: _v, overrideBudget, overrideReason, ...fields } = patch; void _v;
  dOrder(fields.startDate ?? old.startDate, fields.endDate ?? old.endDate);
  const isEmp = r.type === 'EMPLOYEE';
  if (isEmp && fields.paidAmount !== undefined && toMinor(fields.paidAmount) > 0) throw unprocessable('Employee pay is costed through allocations, not paid amounts.', { fields: { paidAmount: 'Not applicable' } });
  const newActual = fields.actualHours ?? Number(old.actualHours);
  const delta = isEmp ? 0 : costOf(newActual, old.costRate) - costOf(old.actualHours, old.costRate);
  await guardAssignment(tx, ctx, p, delta, !!overrideBudget, overrideReason);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, val] of Object.entries(fields)) if (val !== undefined) set[k] = k.endsWith('Hours') ? String(val) : val;
  const [row] = await tx.update(projectResources).set(set).where(eq(projectResources.id, id)).returning();
  const d = diffFields(old as never, row as never, Object.keys(fields));
  await audit(tx, ctx.actor, { action: 'assignment.update', entityType: 'project_resource', entityId: id, projectId: old.projectId, summary: changeSummary(`${r.name} on ${p.code}:`, d, p.currency), old: d.old, new: d.new });
  await evaluateProjectAlerts(tx, old.projectId);
  return row;
}

export async function removeAssignment(tx: Executor, ctx: Ctx, id: string) {
  const [old] = await tx.select().from(projectResources).where(eq(projectResources.id, id)).limit(1);
  if (!old || old.archivedAt) throw notFound('Assignment');
  const p = await loadProject(tx, old.projectId); assertEditable(p);
  const [r] = await tx.select().from(resources).where(eq(resources.id, old.resourceId)).limit(1);
  await tx.update(projectResources).set({ archivedAt: new Date() }).where(eq(projectResources.id, id));
  await audit(tx, ctx.actor, { action: 'assignment.remove', entityType: 'project_resource', entityId: id, projectId: old.projectId, summary: `Removed ${r?.name ?? 'resource'} from ${p.code}`, old });
  await evaluateProjectAlerts(tx, old.projectId);
}

// ───────────── revenue adjustments ─────────────
export const adjustmentBody = z.object({ amount: moneyStr, reason: reqText(300), date: dateStr });

export async function addAdjustment(tx: Executor, ctx: Ctx, projectId: string, input: z.infer<typeof adjustmentBody>) {
  const p = await loadProject(tx, projectId); assertEditable(p);
  const amt = toMinor(input.amount);
  if (amt === 0) throw unprocessable('Adjustment amount cannot be zero. Use a negative amount for a reduction.', { fields: { amount: 'Cannot be zero' } });
  const [row] = await tx.insert(projectAdjustments).values({ projectId, amount: fromMinor(amt), reason: input.reason, date: input.date, createdById: ctx.user.id }).returning();
  await audit(tx, ctx.actor, { action: 'adjustment.create', entityType: 'adjustment', entityId: row.id, projectId, summary: `Revenue adjustment ${formatMoney(amt, p.currency)} on ${p.code}: ${input.reason}`, new: row });
  await evaluateProjectAlerts(tx, projectId);
  return row;
}

export async function removeAdjustment(tx: Executor, ctx: Ctx, id: string) {
  const [old] = await tx.select().from(projectAdjustments).where(eq(projectAdjustments.id, id)).limit(1);
  if (!old || old.archivedAt) throw notFound('Adjustment');
  const p = await loadProject(tx, old.projectId); assertEditable(p);
  await tx.update(projectAdjustments).set({ archivedAt: new Date() }).where(eq(projectAdjustments.id, id));
  await audit(tx, ctx.actor, { action: 'adjustment.remove', entityType: 'adjustment', entityId: id, projectId: old.projectId, summary: `Removed revenue adjustment ${formatMoney(toMinor(old.amount), p.currency)} from ${p.code}`, old });
}
void invoices;
