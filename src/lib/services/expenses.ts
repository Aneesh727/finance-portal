/** Company / department / project expenses, their project mirror (ProjectCost) and allocation to projects. */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Executor } from '@/lib/db';
import { categories, expenseAllocations, expenses, projectCosts, projects, vendors } from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { audit, changeSummary, diffFields, type Actor } from '@/lib/audit';
import { ApiError, conflict, forbidden, notFound, unprocessable } from '@/lib/errors';
import { formatMoney, fromMinor, toMinor, type Minor } from '@/lib/money';
import { convertMinor } from '@/lib/finance/engine';
import { computeExpenseAllocations, type AllocRow } from '@/lib/finance/allocation';
import { loadOne } from '@/lib/finance/loaders';
import { getCompany, getSettings, approvalThresholdMinor } from '@/lib/settings';
import { updateVersioned } from '@/lib/crud';
import type { expenseBody, expensePatch, expenseAllocationBody } from '@/lib/validators';
import { costFx, evaluateGuard, lockProject } from './costs';
import { resolveFx } from './projects';
import { requestApproval } from './approvals-core';
import { evaluateProjectAlerts } from './alerts';
import { notify } from './notifications';

type Ctx = { user: AuthUser; actor: Actor };
export type ExpenseInput = z.infer<typeof expenseBody>;
export type ExpensePatch = z.infer<typeof expensePatch>;
type Expense = typeof expenses.$inferSelect;
type Project = typeof projects.$inferSelect;

async function checkRefs(tx: Executor, categoryId: string, vendorId?: string | null) {
  const [cat] = await tx.select().from(categories).where(and(eq(categories.id, categoryId), eq(categories.kind, 'EXPENSE'))).limit(1);
  if (!cat) throw unprocessable('The selected expense category does not exist.', { fields: { categoryId: 'Not found' } });
  if (!cat.active) throw unprocessable('That expense category is inactive.', { fields: { categoryId: 'Inactive' } });
  if (vendorId) {
    const [v] = await tx.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
    if (!v) throw unprocessable('The selected vendor does not exist.', { fields: { vendorId: 'Not found' } });
    if (v.archivedAt) throw unprocessable('That vendor is archived.', { fields: { vendorId: 'Archived' } });
  }
  return cat;
}

async function mirrorCategory(tx: Executor, expenseCatName: string, explicit?: string | null): Promise<string> {
  if (explicit) {
    const [c] = await tx.select().from(categories).where(and(eq(categories.id, explicit), eq(categories.kind, 'COST'))).limit(1);
    if (!c) throw unprocessable('The selected cost category does not exist.', { fields: { costCategoryId: 'Not found' } });
    return c.id;
  }
  const rows = await tx.select().from(categories).where(and(eq(categories.kind, 'COST'), eq(categories.active, true)));
  const same = rows.find((c) => c.name.toLowerCase() === expenseCatName.toLowerCase()) ?? rows.find((c) => c.name === 'Miscellaneous') ?? rows[0];
  if (!same) throw unprocessable('No cost categories exist. Add one in Settings.');
  return same.id;
}

/** create/refresh the ProjectCost that mirrors an approved PROJECT-scope expense */
async function syncMirror(tx: Executor, ctx: Ctx, e: Expense, project: Project | null, costCategoryId?: string | null) {
  const [existing] = await tx.select().from(projectCosts).where(eq(projectCosts.expenseId, e.id)).limit(1);
  const wanted = e.scope === 'PROJECT' && e.status === 'APPROVED' && !e.archivedAt && project;
  if (!wanted) {
    if (existing && !existing.archivedAt) await tx.update(projectCosts).set({ archivedAt: new Date(), status: 'CANCELLED', version: sql`${projectCosts.version} + 1` }).where(eq(projectCosts.id, existing.id));
    return;
  }
  const cur = e.currency;
  const fx = await costFx(tx, cur, project!, Number(e.fxRate) > 0 && cur !== project!.currency ? Number(e.fxRate) / Number(project!.fxRateToBase) : undefined);
  const original = toMinor(e.originalAmount);
  const amount = fx === '1' ? original : convertMinor(original, fx);
  const [cat] = await tx.select().from(categories).where(eq(categories.id, e.categoryId)).limit(1);
  const catId = existing?.categoryId && !costCategoryId ? existing.categoryId : await mirrorCategory(tx, cat?.name ?? '', costCategoryId);
  const values = {
    projectId: project!.id, name: e.description.slice(0, 150), categoryId: catId, kind: 'ACTUAL' as const, status: 'APPROVED' as const, amount: fromMinor(amount), originalAmount: fromMinor(original),
    currency: cur, fxRate: fx, isCredit: false, date: e.date, vendorId: e.vendorId, expenseId: e.id, notes: e.notes, archivedAt: null,
  };
  if (existing) await tx.update(projectCosts).set({ ...values, version: sql`${projectCosts.version} + 1` }).where(eq(projectCosts.id, existing.id));
  else await tx.insert(projectCosts).values({ ...values, createdById: ctx.user.id });
}

export async function createExpense(tx: Executor, ctx: Ctx, input: ExpenseInput, opts: { fromRecurring?: { ruleId: string; periodStart: string }; skipApproval?: boolean } = {}) {
  const { user, actor } = ctx;
  const cat = await checkRefs(tx, input.categoryId, input.vendorId);
  const company = await getCompany(tx);
  const base = company?.baseCurrency ?? 'INR';
  const settings = await getSettings(tx);

  let project: Project | null = null;
  if (input.scope === 'PROJECT') {
    if (!input.projectId) throw unprocessable('Choose the project this expense belongs to.', { fields: { projectId: 'Required' } });
    await lockProject(tx, input.projectId);
    [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
    if (!project) throw unprocessable('The selected project does not exist.', { fields: { projectId: 'Not found' } });
    if (project.archivedAt || project.status === 'LOST' || project.status === 'CANCELLED') throw unprocessable('This project can no longer take expenses.', { fields: { projectId: 'Project is closed' } }, 'PROJECT_CLOSED');
  } else if (input.projectId) throw unprocessable('Only project-scope expenses can name a project. Use allocation to share a company expense.', { fields: { scope: 'Set to PROJECT' } });
  if (input.scope === 'DEPARTMENT' && !input.department) throw unprocessable('Enter the department for a department expense.', { fields: { department: 'Required' } });

  const cur = input.currency ?? base;
  const fx = await resolveFx(tx, cur, base, input.fxRate);
  const original = toMinor(input.amount);
  const amountBase = cur === base ? original : convertMinor(original, fx);
  const taxOriginal = toMinor(input.taxAmount);
  const taxBase = cur === base ? taxOriginal : convertMinor(taxOriginal, fx);

  let status: Expense['status'] = 'APPROVED';
  const reasons: string[] = [];
  let approvalType: 'LARGE_EXPENSE' | 'VENDOR_EXPENSE' | 'OVER_BUDGET' | null = null;
  const canDecide = user.perms.has('approvals.decide') || opts.skipApproval;
  const thr = approvalThresholdMinor(settings);
  if (thr > 0 && amountBase > thr) { approvalType = 'LARGE_EXPENSE'; reasons.push(`Amount ${formatMoney(amountBase, base)} is above the approval threshold of ${formatMoney(thr, base)}`); }
  const vthr = settings.approvals.vendorExpenseThreshold > 0 ? toMinor(settings.approvals.vendorExpenseThreshold) : 0;
  if (input.vendorId && vthr > 0 && amountBase > vthr) { approvalType ??= 'VENDOR_EXPENSE'; reasons.push(`Vendor expense above ${formatMoney(vthr, base)}`); }
  let breach = false;
  if (project && input.scope === 'PROJECT' && !input.recurringRuleId) {
    const pf = await costFx(tx, cur, project, undefined).catch(() => '1');
    const inProject = pf === '1' ? original : convertMinor(original, pf);
    const catId = await mirrorCategory(tx, cat.name, input.costCategoryId);
    const g = await evaluateGuard(tx, project, { categoryId: catId, amountMinor: inProject, deltaMinor: inProject, hasVendor: false, counts: true });
    if (g.budgetBreach) {
      breach = true; approvalType = 'OVER_BUDGET'; reasons.push(...g.reasons.filter((r) => /budget/i.test(r)));
      if (user.perms.has('costs.approve') || canDecide) {
        if (!input.overrideBudget) throw new ApiError(422, 'BUDGET_WOULD_BE_EXCEEDED', `${g.reasons.join('. ')}. Confirm the override (with a reason) to record it anyway.`, { ...g.details, reasons: g.reasons });
        if (!input.overrideReason) throw unprocessable('Please give a reason for exceeding the budget.', { fields: { overrideReason: 'Required' } });
      }
    }
  }
  if (approvalType && !(canDecide || (breach && user.perms.has('costs.approve') && approvalType === 'OVER_BUDGET'))) status = 'PENDING_APPROVAL';
  if (input.recurringRuleId && !opts.fromRecurring) throw unprocessable('Recurring expenses are generated by their rule.');

  const [row] = await tx.insert(expenses).values({
    date: input.date, categoryId: input.categoryId, description: input.description, amount: fromMinor(amountBase), taxAmount: fromMinor(taxBase), originalAmount: fromMinor(original),
    currency: cur, fxRate: fx, vendorId: input.vendorId, paymentMethod: input.paymentMethod, scope: input.scope, projectId: input.scope === 'PROJECT' ? input.projectId : null,
    department: input.department, status, recurringRuleId: opts.fromRecurring?.ruleId ?? null, periodStart: opts.fromRecurring?.periodStart ?? null, reference: input.reference, notes: input.notes, createdById: user.id,
  }).returning();

  let approvalId: string | null = null;
  if (status === 'PENDING_APPROVAL') {
    const a = await requestApproval(tx, actor, { type: approvalType!, entityType: 'expense', entityId: row.id, projectId: row.projectId, title: `${input.description}: ${formatMoney(amountBase, base)}${project ? ` on ${project.code}` : ''}`, reason: reasons.join('. '), amountMinor: amountBase, payload: { costCategoryId: input.costCategoryId ?? null }, requestedById: user.id }, base);
    approvalId = a.id;
  } else await syncMirror(tx, ctx, row, project, input.costCategoryId);

  await audit(tx, actor, { action: 'expense.create', entityType: 'expense', entityId: row.id, projectId: row.projectId, summary: `Added ${input.scope.toLowerCase()} expense "${input.description}" ${formatMoney(amountBase, base)}${status === 'PENDING_APPROVAL' ? ' (pending approval)' : ''}${breach && status === 'APPROVED' ? ` [budget override: ${input.overrideReason}]` : ''}`, new: row });
  const largeRule = settings.notifications.largeExpense;
  if (status === 'APPROVED' && largeRule > 0 && amountBase >= toMinor(largeRule)) {
    await notify(tx, { type: 'LARGE_EXPENSE', severity: 'info', title: 'Large expense recorded', body: `${input.description}: ${formatMoney(amountBase, base)}`, link: '/expenses', dedupeKey: `large-expense:${row.id}`, permission: 'expenses.view' });
  }
  if (status === 'APPROVED' && row.projectId) await evaluateProjectAlerts(tx, row.projectId);
  return { expense: row, requiresApproval: status === 'PENDING_APPROVAL', approvalId, warnings: status === 'PENDING_APPROVAL' ? [...reasons, 'Sent for approval. It will not count until approved.'] : [] };
}

export async function updateExpense(tx: Executor, ctx: Ctx, id: string, patch: ExpensePatch) {
  const { user, actor } = ctx;
  const { version, overrideBudget, overrideReason, costCategoryId, ...fields } = patch;
  const [old] = await tx.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!old) throw notFound('Expense');
  if (old.archivedAt || old.status === 'VOID') throw unprocessable('This expense was voided and cannot be edited.', undefined, 'EXPENSE_VOIDED');
  if (old.recurringRuleId && (fields.scope || fields.projectId)) throw unprocessable('Scope of generated recurring expenses is set by the rule.');
  const own = old.createdById === user.id && old.status === 'PENDING_APPROVAL';
  if (!user.perms.has('expenses.edit') && !own) throw forbidden('You can only edit your own expenses that are waiting for approval.');
  const company = await getCompany(tx);
  const base = company?.baseCurrency ?? 'INR';

  const scope = fields.scope ?? old.scope;
  const projectId = scope === 'PROJECT' ? (fields.projectId !== undefined ? fields.projectId : old.projectId) : null;
  if (scope === 'PROJECT' && !projectId) throw unprocessable('Choose the project this expense belongs to.', { fields: { projectId: 'Required' } });
  if (scope !== 'PROJECT' && fields.projectId) throw unprocessable('Only project-scope expenses can name a project.', { fields: { scope: 'Set to PROJECT' } });
  if (scope === 'DEPARTMENT' && !(fields.department ?? old.department)) throw unprocessable('Enter the department for a department expense.', { fields: { department: 'Required' } });
  if (fields.categoryId || fields.vendorId) await checkRefs(tx, fields.categoryId ?? old.categoryId, fields.vendorId ?? undefined);
  let project: Project | null = null;
  if (projectId) {
    await lockProject(tx, projectId);
    [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw unprocessable('The selected project does not exist.', { fields: { projectId: 'Not found' } });
    if (projectId !== old.projectId && (project.archivedAt || project.status === 'LOST' || project.status === 'CANCELLED')) throw unprocessable('This project can no longer take expenses.', { fields: { projectId: 'Project is closed' } });
  }

  const set: Record<string, unknown> = {};
  for (const k of ['date', 'categoryId', 'description', 'vendorId', 'paymentMethod', 'department', 'reference', 'notes', 'scope'] as const) if (fields[k] !== undefined) set[k] = fields[k];
  set.projectId = projectId;
  let amountBase = toMinor(old.amount);
  if (fields.amount !== undefined || fields.currency !== undefined || fields.fxRate !== undefined || fields.taxAmount !== undefined) {
    const cur = fields.currency ?? old.currency;
    const fx = await resolveFx(tx, cur, base, fields.fxRate ?? (cur === old.currency ? Number(old.fxRate) : undefined));
    const original = fields.amount !== undefined ? toMinor(fields.amount) : toMinor(old.originalAmount);
    if (original <= 0) throw unprocessable('Amount must be greater than zero.', { fields: { amount: 'Must be greater than zero' } });
    amountBase = cur === base ? original : convertMinor(original, fx);
    // tax is entered in the same currency as the amount; stored value is kept in base
    const taxOriginal = fields.taxAmount !== undefined ? toMinor(fields.taxAmount) : (Number(old.fxRate) > 0 && old.currency === cur ? Math.round(toMinor(old.taxAmount) / Number(old.fxRate)) : toMinor(old.taxAmount));
    Object.assign(set, { amount: fromMinor(amountBase), originalAmount: fromMinor(original), currency: cur, fxRate: fx, taxAmount: fromMinor(cur === base ? taxOriginal : convertMinor(taxOriginal, fx)) });
  }
  if (fields.status === 'APPROVED' && old.status === 'EXPECTED') set.status = 'APPROVED';

  // approval triggers again when an edit pushes it over the threshold
  const settings = await getSettings(tx);
  const thr = approvalThresholdMinor(settings);
  let reroute = false;
  if (!user.perms.has('approvals.decide') && thr > 0 && amountBase > thr && amountBase > toMinor(old.amount) && old.status === 'APPROVED') reroute = true;
  if (reroute) {
    const a = await requestApproval(tx, actor, { type: 'LARGE_EXPENSE', entityType: 'expense', entityId: id, projectId: old.projectId, title: `Change "${old.description}" to ${formatMoney(amountBase, base)}`, reason: `Amount above the approval threshold of ${formatMoney(thr, base)}`, amountMinor: amountBase - toMinor(old.amount), payload: { patch: set, costCategoryId: costCategoryId ?? null, isChange: true }, requestedById: user.id }, base);
    await audit(tx, actor, { action: 'expense.change_requested', entityType: 'expense', entityId: id, projectId: old.projectId, summary: `Requested change to expense "${old.description}" (needs approval)`, new: fields });
    return { expense: old, requiresApproval: true, approvalId: a.id, warnings: [] };
  }
  // budget guard for increases on project expenses
  if (project && old.status === 'APPROVED' && (amountBase > toMinor(old.amount) || projectId !== old.projectId)) {
    const catId = await mirrorCategory(tx, '', costCategoryId ?? (await mirrorExisting(tx, id)));
    const delta = projectId !== old.projectId ? amountBase : amountBase - toMinor(old.amount);
    const g = await evaluateGuard(tx, project, { categoryId: catId, amountMinor: amountBase, deltaMinor: delta, hasVendor: false, counts: true });
    if (g.budgetBreach) {
      if (!user.perms.has('costs.approve') && !user.perms.has('approvals.decide')) throw forbidden(`${g.reasons.join('. ')}. Someone who can approve costs must make this change.`, 'BUDGET_APPROVAL_REQUIRED');
      if (!overrideBudget) throw new ApiError(422, 'BUDGET_WOULD_BE_EXCEEDED', `${g.reasons.join('. ')}. Confirm the override (with a reason) to save it anyway.`, { ...g.details, reasons: g.reasons });
      if (!overrideReason) throw unprocessable('Please give a reason for exceeding the budget.', { fields: { overrideReason: 'Required' } });
    }
  }
  const row = (await updateVersioned(tx, expenses as never, id, version, set, 'Expense')) as Expense;
  const d = diffFields(old as never, row as never, Object.keys(set));
  await audit(tx, actor, { action: 'expense.update', entityType: 'expense', entityId: id, projectId: row.projectId, summary: changeSummary(`Expense "${old.description}":`, d, base), old: d.old, new: d.new });
  if (row.status === 'APPROVED' || old.projectId) {
    await syncMirror(tx, ctx, row, project, costCategoryId);
    if (row.scope !== 'PROJECT' || amountBase !== toMinor(old.amount)) await reallocate(tx, actor, row);
  }
  if (old.projectId) await evaluateProjectAlerts(tx, old.projectId);
  if (row.projectId && row.projectId !== old.projectId) await evaluateProjectAlerts(tx, row.projectId);
  return { expense: row, requiresApproval: false, approvalId: null, warnings: [] };
}
async function mirrorExisting(tx: Executor, expenseId: string) {
  const [m] = await tx.select({ c: projectCosts.categoryId }).from(projectCosts).where(eq(projectCosts.expenseId, expenseId)).limit(1);
  return m?.c ?? null;
}

export async function voidExpense(tx: Executor, ctx: Ctx, id: string, reason: string) {
  const [old] = await tx.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!old) throw notFound('Expense');
  if (old.archivedAt) throw conflict('This expense is already voided.', 'INVALID_STATE');
  const own = old.createdById === ctx.user.id && old.status === 'PENDING_APPROVAL';
  if (!ctx.user.perms.has('expenses.edit') && !own) throw forbidden();
  const [row] = await tx.update(expenses).set({ status: 'VOID', archivedAt: new Date(), version: sql`${expenses.version} + 1` }).where(eq(expenses.id, id)).returning();
  const [m] = await tx.select().from(projectCosts).where(eq(projectCosts.expenseId, id)).limit(1);
  if (m && !m.archivedAt) await tx.update(projectCosts).set({ archivedAt: new Date(), status: 'CANCELLED', version: sql`${projectCosts.version} + 1` }).where(eq(projectCosts.id, m.id));
  await tx.execute(sql`UPDATE approvals SET status='CANCELLED', decision_note='Expense voided' WHERE entity_type='expense' AND entity_id=${id}::uuid AND status='PENDING'`);
  await audit(tx, ctx.actor, { action: 'expense.void', entityType: 'expense', entityId: id, projectId: old.projectId, summary: `Voided expense "${old.description}" (${formatMoney(toMinor(old.amount), 'INR')}): ${reason}`, old, new: { voided: true, reason } });
  if (old.projectId) await evaluateProjectAlerts(tx, old.projectId);
  return row;
}

// ───────────── allocation of company expenses ─────────────
type AllocInput = z.infer<typeof expenseAllocationBody>['rows'];

async function computeRows(tx: Executor, total: Minor, rows: { targetType: string; projectId: string | null; method: string; value: number }[]) {
  const ids = [...new Set(rows.map((r) => r.projectId).filter(Boolean) as string[])];
  const revenue = new Map<string, Minor>();
  if (rows.some((r) => r.method === 'REVENUE_PERCENT') && ids.length) {
    for (const id of ids) revenue.set(id, (await loadOne(id, { exec: tx }))?.f.revenue.contractValue ?? 0);
  }
  const allocRows: AllocRow[] = rows.map((r, i) => ({ key: String(i), method: r.method as AllocRow['method'], value: r.method === 'FIXED' ? toMinor(String(r.value)) : r.value, revenue: r.projectId ? revenue.get(r.projectId) : 0 }));
  try {
    return computeExpenseAllocations(total, allocRows);
  } catch (e) {
    throw unprocessable((e as Error).message, { fields: { rows: (e as Error).message } }, 'ALLOCATION_INVALID');
  }
}

export async function setAllocations(tx: Executor, ctx: Ctx, expenseId: string, input: AllocInput) {
  const [e] = await tx.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (!e) throw notFound('Expense');
  if (e.archivedAt || e.status !== 'APPROVED') throw unprocessable('Only approved expenses can be allocated.', undefined, 'EXPENSE_NOT_APPROVED');
  if (e.scope === 'PROJECT') throw unprocessable('A project expense is already charged directly to its project.', undefined, 'ALREADY_DIRECT');
  const projectIds = [...new Set(input.filter((r) => r.targetType === 'PROJECT').map((r) => r.projectId).filter(Boolean) as string[])];
  for (const r of input) {
    if (r.targetType === 'PROJECT' && !r.projectId) throw unprocessable('Choose a project for every project allocation line.', { fields: { rows: 'Project required' } });
    if (r.targetType === 'DEPARTMENT' && !r.department) throw unprocessable('Enter a department for every department allocation line.', { fields: { rows: 'Department required' } });
  }
  const dupKey = new Set<string>();
  for (const r of input) { const k = `${r.targetType}:${r.projectId ?? r.department ?? ''}`; if (dupKey.has(k)) throw unprocessable('The same target appears twice in the allocation.', { fields: { rows: 'Duplicate target' } }); dupKey.add(k); }
  if (projectIds.length) {
    const found = await tx.select({ id: projects.id, archivedAt: projects.archivedAt }).from(projects).where(inArray(projects.id, projectIds));
    if (found.length !== projectIds.length) throw unprocessable('One of the selected projects does not exist.', { fields: { rows: 'Project not found' } });
  }
  const total = toMinor(e.amount);
  const res = input.length ? await computeRows(tx, total, input.map((r) => ({ ...r, projectId: r.projectId ?? null }))) : { amounts: [] as number[], allocated: 0, overhead: total };
  const affected = new Set<string>(((await tx.select({ p: expenseAllocations.projectId }).from(expenseAllocations).where(eq(expenseAllocations.expenseId, expenseId))).map((r) => r.p).filter(Boolean)) as string[]);
  await tx.delete(expenseAllocations).where(eq(expenseAllocations.expenseId, expenseId));
  if (input.length) {
    await tx.insert(expenseAllocations).values(input.map((r, i) => ({
      expenseId, targetType: r.targetType, projectId: r.targetType === 'PROJECT' ? r.projectId : null, department: r.targetType === 'DEPARTMENT' ? r.department : null,
      method: r.method, value: String(r.value), amount: fromMinor(res.amounts[i]),
    })));
  }
  for (const id of projectIds) affected.add(id);
  await audit(tx, ctx.actor, { action: 'expense.allocate', entityType: 'expense', entityId: expenseId, summary: `Allocated ${formatMoney(res.allocated, 'INR')} of "${e.description}" across ${input.length} target(s); overhead ${formatMoney(res.overhead, 'INR')}`, new: { rows: input } });
  for (const pid of affected) await evaluateProjectAlerts(tx, pid);
  return { allocated: res.allocated, overhead: res.overhead, amounts: res.amounts };
}

/** re-compute stored allocation amounts after the expense amount changed (or clear them if the scope changed) */
async function reallocate(tx: Executor, actor: Actor, e: Expense) {
  const rows = await tx.select().from(expenseAllocations).where(eq(expenseAllocations.expenseId, e.id));
  if (!rows.length) return;
  if (e.scope === 'PROJECT' || e.status !== 'APPROVED' || e.archivedAt) {
    await tx.delete(expenseAllocations).where(eq(expenseAllocations.expenseId, e.id));
    return;
  }
  const res = await computeRows(tx, toMinor(e.amount), rows.map((r) => ({ targetType: r.targetType, projectId: r.projectId, method: r.method, value: Number(r.value) })));
  for (let i = 0; i < rows.length; i++) await tx.update(expenseAllocations).set({ amount: fromMinor(res.amounts[i]) }).where(eq(expenseAllocations.id, rows[i].id));
  await audit(tx, actor, { action: 'expense.reallocate', entityType: 'expense', entityId: e.id, summary: `Re-calculated allocation of "${e.description}" after the amount changed` });
}

export { syncMirror };
