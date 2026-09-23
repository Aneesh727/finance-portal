import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Executor } from '@/lib/db';
import { categories, projectBudgets, projectCosts, projects, resources, vendors, exchangeRates } from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { audit, changeSummary, diffFields, type Actor } from '@/lib/audit';
import { conflict, forbidden, notFound, unprocessable, ApiError } from '@/lib/errors';
import { fromMinor, formatMoney, mulDiv, toMinor, type Minor } from '@/lib/money';
import { getSettings, approvalThresholdMinor } from '@/lib/settings';
import { convertMinor, calculateBudget } from '@/lib/finance/engine';
import { loadOne } from '@/lib/finance/loaders';
import type { costBody, costPatch } from '@/lib/validators';
import { requestApproval } from './approvals-core';
import { evaluateProjectAlerts } from './alerts';
import { todayStr } from '@/lib/dates';
import { updateVersioned } from '@/lib/crud';
import { getCompany } from '@/lib/settings';

export type CostInput = z.infer<typeof costBody>;
export type CostPatch = z.infer<typeof costPatch>;
type Cost = typeof projectCosts.$inferSelect;
type Project = typeof projects.$inferSelect;
interface Ctx { user: AuthUser; actor: Actor }

/** serialize budget-guard checks per project so two concurrent spends cannot both slip under the limit */
export async function lockProject(tx: Executor, projectId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`);
}

/** rate converting `cur` into the project's currency */
export async function costFx(tx: Executor, cur: string, project: Project, provided?: number): Promise<string> {
  if (cur === project.currency) return '1';
  if (provided && provided > 0) return String(provided);
  const company = await getCompany(tx);
  const base = company?.baseCurrency ?? 'INR';
  const rateOf = async (c: string): Promise<number | null> => {
    if (c === base) return 1;
    const [r] = await tx.select({ rate: exchangeRates.rateToBase }).from(exchangeRates).where(and(eq(exchangeRates.currency, c), sql`${exchangeRates.effectiveOn} <= ${todayStr()}::date`)).orderBy(sql`${exchangeRates.effectiveOn} desc`).limit(1);
    return r ? Number(r.rate) : null;
  };
  const from = await rateOf(cur);
  const to = project.currency === base ? 1 : Number(project.fxRateToBase);
  if (!from || !to) throw unprocessable(`Missing currency conversion from ${cur} to ${project.currency}. Enter the exchange rate or add one in Settings.`, { currency: cur }, 'MISSING_FX_RATE');
  return String(Math.round((from / to) * 1e8) / 1e8);
}

async function loadRefs(tx: Executor, categoryId: string, vendorId?: string | null, resourceId?: string | null, forActual = true) {
  const [cat] = await tx.select().from(categories).where(and(eq(categories.id, categoryId), eq(categories.kind, 'COST'))).limit(1);
  if (!cat) throw unprocessable('The selected cost category does not exist.', { fields: { categoryId: 'Not found' } });
  if (!cat.active) throw unprocessable('That cost category is inactive.', { fields: { categoryId: 'Inactive' } });
  if (vendorId) {
    const [v] = await tx.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
    if (!v) throw unprocessable('The selected vendor does not exist.', { fields: { vendorId: 'Not found' } });
    if (v.archivedAt) throw unprocessable('That vendor is archived.', { fields: { vendorId: 'Archived' } });
  }
  if (resourceId) {
    const [r] = await tx.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
    if (!r) throw unprocessable('The selected resource does not exist.', { fields: { resourceId: 'Not found' } });
    if (forActual && (r.archivedAt || r.status === 'INACTIVE')) throw unprocessable(`${r.name} is ${r.archivedAt ? 'archived' : 'inactive'} and cannot take new costs. Historical costs are kept.`, { fields: { resourceId: 'Inactive' } });
  }
  return cat;
}

interface GuardResult {
  approvalType: 'LARGE_EXPENSE' | 'VENDOR_EXPENSE' | 'OVER_BUDGET' | 'COST_THRESHOLD' | null;
  reasons: string[];
  budgetBreach: boolean;
  details: Record<string, unknown>;
}

/**
 * Decide whether a spend of `deltaMinor` (project currency) needs approval.
 *  - amount above the configured expense threshold
 *  - vendor-linked amount above the vendor threshold
 *  - would push the project (or a category) past 100% of its budget
 */
export async function evaluateGuard(tx: Executor, project: Project, args: { categoryId: string; amountMinor: Minor; deltaMinor: Minor; hasVendor: boolean; counts: boolean }): Promise<GuardResult> {
  const s = await getSettings(tx);
  const thr = approvalThresholdMinor(s);
  const reasons: string[] = [];
  let approvalType: GuardResult['approvalType'] = null;
  let breach = false;
  const details: Record<string, unknown> = {};
  const fx = Number(project.fxRateToBase);
  const amountBase = fx === 1 ? args.amountMinor : convertMinor(args.amountMinor, fx);
  if (thr > 0 && amountBase > thr) {
    approvalType = 'LARGE_EXPENSE';
    reasons.push(`Amount ${formatMoney(args.amountMinor, project.currency)} is above the approval threshold of ${formatMoney(thr, 'INR')}`);
  }
  const vthr = s.approvals.vendorExpenseThreshold > 0 ? toMinor(s.approvals.vendorExpenseThreshold) : 0;
  if (args.hasVendor && vthr > 0 && amountBase > vthr) {
    approvalType ??= 'VENDOR_EXPENSE';
    reasons.push(`Vendor expense above ${formatMoney(vthr, 'INR')}`);
  }
  if (args.counts && args.deltaMinor > 0 && s.approvals.overBudgetRequiresApproval) {
    const fin = await loadOne(project.id, { exec: tx, thresholds: s.thresholds });
    if (fin) {
      const budget = fin.budgetMinor;
      if (budget > 0 && fin.f.cost.actual + args.deltaMinor > budget) {
        breach = true;
        approvalType = 'OVER_BUDGET';
        const over = fin.f.cost.actual + args.deltaMinor - budget;
        reasons.push(`This would exceed the project budget by ${formatMoney(over, project.currency)}`);
        Object.assign(details, { budget, actualBefore: fin.f.cost.actual, overBy: over });
      }
      const [cb] = await tx.select().from(projectBudgets).where(and(eq(projectBudgets.projectId, project.id), eq(projectBudgets.categoryId, args.categoryId))).limit(1);
      if (cb) {
        const [{ a }] = (await tx.execute(sql`SELECT COALESCE(SUM(ROUND(amount*100)),0)::bigint AS a FROM project_costs WHERE project_id = ${project.id}::uuid AND category_id = ${args.categoryId}::uuid AND archived_at IS NULL AND kind='ACTUAL' AND status IN ('APPROVED','PAID')`)).rows as { a: string }[];
        const cbBudget = toMinor(cb.amount);
        const st = calculateBudget(cbBudget, Number(a) + args.deltaMinor, 0, s.thresholds);
        if (cbBudget > 0 && st.state === 'EXCEEDED') {
          breach = true;
          approvalType = 'OVER_BUDGET';
          reasons.push(`This would exceed the category budget by ${formatMoney(st.overBy, project.currency)}`);
          Object.assign(details, { categoryBudget: cbBudget, categoryOverBy: st.overBy });
        }
      }
    }
  }
  return { approvalType, reasons, budgetBreach: breach, details };
}

function assertProjectAcceptsCosts(p: Project) {
  if (p.archivedAt) throw unprocessable('This project is archived. Restore it before adding costs.', undefined, 'PROJECT_ARCHIVED');
  if (p.status === 'LOST') throw unprocessable('A lost project cannot take new costs.', undefined, 'PROJECT_LOST');
}

export async function createCost(tx: Executor, ctx: Ctx, input: CostInput) {
  const { user, actor } = ctx;
  await lockProject(tx, input.projectId);
  const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) throw notFound('Project');
  assertProjectAcceptsCosts(project);
  await loadRefs(tx, input.categoryId, input.vendorId, input.resourceId, input.kind === 'ACTUAL');

  const original = toMinor(input.amount);
  if (original <= 0) throw unprocessable('Cost amount must be greater than zero. To record a refund or credit, tick "credit" and enter a positive amount.', { fields: { amount: 'Must be greater than zero' } });
  if (input.isCredit && input.kind !== 'ACTUAL') throw unprocessable('Only actual costs can be credits.');
  const cur = input.currency ?? project.currency;
  const fx = await costFx(tx, cur, project, input.fxRate);
  const inProject = fx === '1' ? original : convertMinor(original, fx);
  const signed = input.isCredit ? -inProject : inProject;
  if (input.recurrence === 'CUSTOM' && !input.recurrenceIntervalMonths) throw unprocessable('Enter the number of months between recurrences.', { fields: { recurrenceIntervalMonths: 'Required' } });

  let status: Cost['status'] = input.kind === 'ESTIMATED' ? 'PLANNED' : input.status === 'PAID' && input.kind === 'ACTUAL' ? 'PAID' : 'APPROVED';
  let approvalId: string | null = null;
  const warnings: string[] = [];

  if (input.kind !== 'ESTIMATED' && !input.isCredit) {
    const g = await evaluateGuard(tx, project, { categoryId: input.categoryId, amountMinor: inProject, deltaMinor: input.kind === 'ACTUAL' ? inProject : 0, hasVendor: !!input.vendorId, counts: input.kind === 'ACTUAL' });
    const canApprove = user.perms.has('costs.approve');
    if (g.budgetBreach && canApprove && !input.overrideBudget) {
      throw new ApiError(422, 'BUDGET_WOULD_BE_EXCEEDED', `${g.reasons.join('. ')}. Confirm the override (with a reason) to record it anyway.`, { ...g.details, reasons: g.reasons });
    }
    if (g.budgetBreach && canApprove && input.overrideBudget && !input.overrideReason) {
      throw unprocessable('Please give a reason for exceeding the budget.', { fields: { overrideReason: 'Required' } });
    }
    if (g.approvalType && !canApprove) {
      status = 'PENDING_APPROVAL';
      warnings.push(...g.reasons, 'Sent for approval. It will not count towards actual cost until approved.');
    }
    if (g.approvalType && canApprove && g.budgetBreach) warnings.push(`Recorded with a budget override by ${user.email}.`);

    const [row] = await tx.insert(projectCosts).values(buildRow(project, input, signed, original, cur, fx, status, user.id)).returning();
    if (status === 'PENDING_APPROVAL') {
      const a = await requestApproval(tx, actor, { type: g.approvalType!, entityType: 'cost', entityId: row.id, projectId: project.id, title: `${input.name}: ${formatMoney(inProject, project.currency)} on ${project.code}`, reason: g.reasons.join('. '), amountMinor: inProject, requestedById: user.id }, project.currency);
      approvalId = a.id;
    }
    await audit(tx, actor, { action: 'cost.create', entityType: 'cost', entityId: row.id, projectId: project.id, summary: `${input.kind === 'ACTUAL' ? 'Added' : 'Committed'} cost "${input.name}" ${formatMoney(signed, project.currency)} on ${project.code}${status === 'PENDING_APPROVAL' ? ' (pending approval)' : ''}${g.budgetBreach && canApprove ? ` [budget override: ${input.overrideReason}]` : ''}`, new: row });
    if (status !== 'PENDING_APPROVAL') await evaluateProjectAlerts(tx, project.id);
    return { cost: row, requiresApproval: status === 'PENDING_APPROVAL', approvalId, warnings };
  }

  const [row] = await tx.insert(projectCosts).values(buildRow(project, input, signed, original, cur, fx, status, user.id)).returning();
  await audit(tx, actor, { action: 'cost.create', entityType: 'cost', entityId: row.id, projectId: project.id, summary: `Added ${input.kind.toLowerCase()} cost "${input.name}" ${formatMoney(signed, project.currency)} on ${project.code}`, new: row });
  if (input.isCredit) await evaluateProjectAlerts(tx, project.id);
  return { cost: row, requiresApproval: false, approvalId: null, warnings };
}

function buildRow(p: Project, i: CostInput, signed: Minor, original: Minor, cur: string, fx: string, status: Cost['status'], userId: string) {
  return {
    projectId: p.id, name: i.name, categoryId: i.categoryId, description: i.description, kind: i.kind, status, amount: fromMinor(signed), originalAmount: fromMinor(original),
    currency: cur, fxRate: fx, isCredit: i.isCredit, date: i.date, vendorId: i.vendorId, resourceId: i.resourceId, recurrence: i.recurrence,
    recurrenceIntervalMonths: i.recurrence === 'CUSTOM' ? i.recurrenceIntervalMonths ?? null : null, recurrenceEnds: i.recurrenceEnds, notes: i.notes,
    overrideReason: i.overrideBudget ? i.overrideReason : null, createdById: userId,
  };
}

const countsAsActual = (c: Pick<Cost, 'kind' | 'status'>) => c.kind === 'ACTUAL' && (c.status === 'APPROVED' || c.status === 'PAID');

export async function updateCost(tx: Executor, ctx: Ctx, id: string, patch: CostPatch, opts: { skipGuard?: boolean; skipPerm?: boolean } = {}) {
  const { user, actor } = ctx;
  const { version, overrideBudget, overrideReason, ...fields } = patch;
  const [old] = await tx.select().from(projectCosts).where(eq(projectCosts.id, id)).limit(1);
  if (!old) throw notFound('Cost');
  if (old.archivedAt) throw unprocessable('This cost entry was voided and cannot be edited.', undefined, 'COST_VOIDED');
  if (old.expenseId) throw unprocessable('This cost comes from an expense. Edit the expense instead.', undefined, 'COST_FROM_EXPENSE');
  await lockProject(tx, old.projectId);
  const [project] = await tx.select().from(projects).where(eq(projects.id, old.projectId)).limit(1);
  if (!project) throw notFound('Project');
  assertProjectAcceptsCosts(project);

  // creators may edit their own PENDING entries; everything else needs costs.edit
  const own = old.createdById === user.id && old.status === 'PENDING_APPROVAL';
  if (!opts.skipPerm && !user.perms.has('costs.edit') && !own) throw forbidden('You can only edit your own entries that are still waiting for approval.');
  if (fields.kind && fields.kind !== old.kind) throw unprocessable('The kind of a cost cannot be changed. Use "convert to actual" for commitments.');
  if (fields.status && !opts.skipPerm && !user.perms.has('costs.approve')) delete fields.status;

  const categoryId = fields.categoryId ?? old.categoryId;
  if (fields.categoryId || fields.vendorId || fields.resourceId) await loadRefs(tx, categoryId, fields.vendorId ?? undefined, fields.resourceId ?? undefined, old.kind === 'ACTUAL');

  const set: Record<string, unknown> = { ...fields };
  delete set.fxRate; delete set.currency; delete set.amount; delete set.isCredit;
  let signed = toMinor(old.amount);
  if (fields.amount !== undefined || fields.currency !== undefined || fields.fxRate !== undefined || fields.isCredit !== undefined) {
    const original = fields.amount !== undefined ? toMinor(fields.amount) : toMinor(old.originalAmount);
    if (original <= 0) throw unprocessable('Cost amount must be greater than zero.', { fields: { amount: 'Must be greater than zero' } });
    const cur = fields.currency ?? old.currency;
    const fx = await costFx(tx, cur, project, fields.fxRate ?? (cur === old.currency ? Number(old.fxRate) : undefined));
    const inProject = fx === '1' ? original : convertMinor(original, fx);
    const isCredit = fields.isCredit ?? old.isCredit;
    signed = isCredit ? -inProject : inProject;
    Object.assign(set, { originalAmount: fromMinor(original), amount: fromMinor(signed), currency: cur, fxRate: fx, isCredit });
  }
  if (fields.recurrence === 'CUSTOM' && !fields.recurrenceIntervalMonths && !old.recurrenceIntervalMonths) throw unprocessable('Enter the number of months between recurrences.');

  // guard: only when the change adds counted spend
  const newStatus = (fields.status as Cost['status'] | undefined) ?? old.status;
  const oldCounted = countsAsActual(old) ? toMinor(old.amount) : 0;
  const newCounted = countsAsActual({ kind: old.kind, status: newStatus }) ? signed : 0;
  const delta = newCounted - oldCounted;
  if (!opts.skipGuard && old.kind !== 'ESTIMATED' && (delta > 0 || (signed > toMinor(old.amount) && old.status === 'APPROVED'))) {
    const g = await evaluateGuard(tx, project, { categoryId, amountMinor: Math.abs(signed), deltaMinor: Math.max(0, delta), hasVendor: !!(fields.vendorId ?? old.vendorId), counts: true });
    if (g.approvalType) {
      if (!user.perms.has('costs.approve')) {
        if (old.status === 'PENDING_APPROVAL') {
          // still waiting anyway; the approval covers the edited version
        } else {
          const a = await requestApproval(tx, actor, { type: 'COST_CHANGE', entityType: 'cost', entityId: id, projectId: project.id, title: `Change "${old.name}" on ${project.code} to ${formatMoney(signed, project.currency)}`, reason: g.reasons.join('. '), amountMinor: signed - toMinor(old.amount), payload: { patch: { ...patch, version: undefined } }, requestedById: user.id }, project.currency);
          await audit(tx, actor, { action: 'cost.change_requested', entityType: 'cost', entityId: id, projectId: project.id, summary: `Requested change to cost "${old.name}" (needs approval: ${g.reasons.join('; ')})`, new: patch });
          return { cost: old, requiresApproval: true, approvalId: a.id, warnings: g.reasons };
        }
      } else if (g.budgetBreach && !overrideBudget) {
        throw new ApiError(422, 'BUDGET_WOULD_BE_EXCEEDED', `${g.reasons.join('. ')}. Confirm the override (with a reason) to save it anyway.`, { ...g.details, reasons: g.reasons });
      } else if (g.budgetBreach && !overrideReason) {
        throw unprocessable('Please give a reason for exceeding the budget.', { fields: { overrideReason: 'Required' } });
      } else if (g.budgetBreach) set.overrideReason = overrideReason;
    }
  }
  if (Object.keys(set).length === 0) return { cost: old, requiresApproval: false, approvalId: null, warnings: [] };
  const row = (await updateVersioned(tx, projectCosts as never, id, version, set, 'Cost')) as Cost;
  const d = diffFields(old as never, row as never, Object.keys(set));
  await audit(tx, actor, { action: 'cost.update', entityType: 'cost', entityId: id, projectId: project.id, summary: changeSummary(`Cost "${old.name}" on ${project.code}:`, d, project.currency), old: d.old, new: d.new });
  await evaluateProjectAlerts(tx, project.id);
  return { cost: row, requiresApproval: false, approvalId: null, warnings: [] };
}

export async function voidCost(tx: Executor, ctx: Ctx, id: string, reason: string) {
  const { user, actor } = ctx;
  const [old] = await tx.select().from(projectCosts).where(eq(projectCosts.id, id)).limit(1);
  if (!old) throw notFound('Cost');
  if (old.archivedAt) throw conflict('This cost is already voided.', 'INVALID_STATE');
  if (old.expenseId) throw unprocessable('This cost comes from an expense. Void the expense instead.', undefined, 'COST_FROM_EXPENSE');
  const own = old.createdById === user.id && old.status === 'PENDING_APPROVAL';
  if (!user.perms.has('costs.edit') && !own) throw forbidden();
  const [row] = await tx.update(projectCosts).set({ archivedAt: new Date(), status: 'CANCELLED', version: sql`${projectCosts.version} + 1` }).where(eq(projectCosts.id, id)).returning();
  await audit(tx, actor, { action: 'cost.void', entityType: 'cost', entityId: id, projectId: old.projectId, summary: `Voided cost "${old.name}" (${formatMoney(toMinor(old.amount), old.currency)}): ${reason}`, old, new: { voided: true, reason } });
  return row;
}

/** turn a commitment into a real (actual) cost. The commitment is marked FULFILLED so nothing is counted twice. */
export async function convertCommitted(tx: Executor, ctx: Ctx, id: string, date: string, amount?: string, ov: { overrideBudget?: boolean; overrideReason?: string } = {}) {
  const [c] = await tx.select().from(projectCosts).where(eq(projectCosts.id, id)).limit(1);
  if (!c) throw notFound('Cost');
  if (c.kind !== 'COMMITTED' || c.status !== 'APPROVED' || c.archivedAt) throw conflict('Only an approved, open commitment can be converted to an actual cost.', 'INVALID_STATE');
  const res = await createCost(tx, ctx, {
    projectId: c.projectId, name: c.name, categoryId: c.categoryId, description: c.description ?? undefined, kind: 'ACTUAL', amount: amount ?? c.originalAmount, currency: c.currency,
    fxRate: Number(c.fxRate), isCredit: false, date, vendorId: c.vendorId, resourceId: c.resourceId, recurrence: 'NONE', notes: c.notes ?? undefined, overrideBudget: !!ov.overrideBudget, overrideReason: ov.overrideReason,
  } as CostInput);
  await tx.update(projectCosts).set({ status: 'FULFILLED', version: sql`${projectCosts.version} + 1` }).where(eq(projectCosts.id, id));
  await audit(tx, ctx.actor, { action: 'cost.convert', entityType: 'cost', entityId: id, projectId: c.projectId, summary: `Converted commitment "${c.name}" into an actual cost` });
  return res;
}
void mulDiv;
