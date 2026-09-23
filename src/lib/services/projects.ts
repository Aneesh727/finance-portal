import { milestonePaymentStatus } from './project-parts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { db, type Executor } from '@/lib/db';
import {
  categories, clients, exchangeRates, milestones, projectAdjustments, projectBudgets, projectCosts, projectMembers, projectResources, projects,
  resources, retainerTerms, retainers, taxRates, users, invoices,
} from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { audit, changeSummary, diffFields, type Actor } from '@/lib/audit';
import { conflict, forbidden, notFound, unprocessable } from '@/lib/errors';
import { fromMinor, formatMoney, toMinor, type Minor } from '@/lib/money';
import { getCompany, getSettings, nextSequence } from '@/lib/settings';
import { todayStr } from '@/lib/dates';
import type { projectBody, projectPatch } from '@/lib/validators';
import { calculateBudget, calculateCategoryBudgets, calculateProjectRevenue, RECOGNISED_STATUSES } from '@/lib/finance/engine';
import { loadOne, toProjectDTO } from '@/lib/finance/loaders';
import { generateSchedule } from './billing';
import { requestApproval } from './approvals-core';
import { updateVersioned } from '@/lib/crud';
import { canSeeRates } from './resources';
import { notify } from './notifications';

export type ProjectInput = z.infer<typeof projectBody>;
export type ProjectPatch = z.infer<typeof projectPatch>;
type Project = typeof projects.$inferSelect;
export interface Ctx { user: AuthUser; actor: Actor }

const PRICING_FIELDS = ['sellingPrice', 'discount', 'setupFee', 'monthlyFee', 'durationMonths', 'taxMode', 'taxRatePct', 'currency', 'fxRateToBase'] as const;

/** resolve the conversion rate of a project currency into company base currency; never silently assume 1 */
export async function resolveFx(tx: Executor, currency: string, base: string, provided?: number): Promise<string> {
  if (currency === base) return '1';
  if (provided && provided > 0) return String(provided);
  const [r] = await tx
    .select({ rate: exchangeRates.rateToBase })
    .from(exchangeRates)
    .where(and(eq(exchangeRates.currency, currency), sql`${exchangeRates.effectiveOn} <= ${todayStr()}::date`))
    .orderBy(desc(exchangeRates.effectiveOn))
    .limit(1);
  if (!r) throw unprocessable(`Missing currency conversion for ${currency}. Add an exchange rate in Settings or enter one on the project.`, { currency }, 'MISSING_FX_RATE');
  return r.rate;
}

async function defaultTaxRate(tx: Executor): Promise<number> {
  const [d] = await tx.select().from(taxRates).where(and(eq(taxRates.isDefault, true), eq(taxRates.active, true))).limit(1);
  return d ? Number(d.ratePct) : 18;
}

async function assertActiveRefs(tx: Executor, input: { clientId?: string; serviceId?: string; managerId?: string | null; salesOwnerId?: string | null; memberIds?: string[] }) {
  if (input.clientId) {
    const [c] = await tx.select().from(clients).where(eq(clients.id, input.clientId)).limit(1);
    if (!c) throw unprocessable('The selected client does not exist.', { fields: { clientId: 'Client not found' } }, 'CLIENT_NOT_FOUND');
    if (c.archivedAt) throw unprocessable('This client is archived. Restore the client before creating projects for it.', { fields: { clientId: 'Client is archived' } }, 'CLIENT_ARCHIVED');
  }
  if (input.serviceId) {
    const [s] = await tx.select().from(categories).where(and(eq(categories.id, input.serviceId), eq(categories.kind, 'SERVICE'))).limit(1);
    if (!s) throw unprocessable('The selected service category does not exist.', { fields: { serviceId: 'Service not found' } });
    if (!s.active) throw unprocessable('That service category is inactive.', { fields: { serviceId: 'Service is inactive' } });
  }
  const userIds = [input.managerId, input.salesOwnerId, ...(input.memberIds ?? [])].filter(Boolean) as string[];
  if (userIds.length) {
    const found = await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, [...new Set(userIds)]), eq(users.active, true)));
    if (found.length !== new Set(userIds).size) throw unprocessable('One of the selected users does not exist or is inactive.');
  }
}

function contractBase(i: { type: string; sellingPrice: string; setupFee: string; monthlyFee: string; durationMonths: number; milestoneTotal: Minor }): Minor {
  switch (i.type) {
    case 'FIXED_RECURRING': return toMinor(i.setupFee) + toMinor(i.monthlyFee) * i.durationMonths;
    case 'MILESTONE': return i.milestoneTotal > 0 ? i.milestoneTotal : toMinor(i.sellingPrice);
    case 'ONE_TIME': return toMinor(i.sellingPrice);
    default: return Number.POSITIVE_INFINITY; // retainer / hourly: no fixed base to cap the discount against
  }
}

function discountPct(discount: Minor, base: Minor): number {
  return base > 0 && Number.isFinite(base) ? (discount / base) * 100 : 0;
}

// ───────────────────────────── create ─────────────────────────────

export async function createProject(tx: Executor, ctx: Ctx, input: ProjectInput) {
  const { user, actor } = ctx;
  const company = await getCompany(tx);
  const base = company?.baseCurrency ?? 'INR';
  const settings = await getSettings(tx);
  await assertActiveRefs(tx, input);

  const priced = toMinor(input.sellingPrice) > 0 || toMinor(input.discount) > 0 || toMinor(input.setupFee) > 0 || toMinor(input.monthlyFee) > 0;
  if (priced && !user.perms.has('profit.view')) throw forbidden('You do not have permission to set project pricing.', 'PRICING_FORBIDDEN');
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw unprocessable('The end date cannot be before the start date.', { fields: { endDate: 'Before start date' } });

  const currencyCode = input.currency ?? base;
  const fx = await resolveFx(tx, currencyCode, base, input.fxRateToBase);
  const taxRatePct = input.taxRatePct ?? (await defaultTaxRate(tx));

  if (input.type === 'RETAINER' && !input.retainer) throw unprocessable('A retainer project needs a monthly fee and start/end dates.', { fields: { retainer: 'Required for retainers' } });
  if (input.type === 'FIXED_RECURRING' && (input.durationMonths < 1 || toMinor(input.monthlyFee) <= 0)) {
    throw unprocessable('A fixed + recurring project needs a monthly fee and a duration in months.', { fields: { monthlyFee: 'Required', durationMonths: 'Required' } });
  }
  const milestoneTotal = (input.milestones ?? []).reduce((a, m) => a + toMinor(m.price), 0);
  const baseAmt = contractBase({ ...input, milestoneTotal });
  let discount = toMinor(input.discount);
  if (discount > baseAmt) throw unprocessable('The discount cannot be more than the project price.', { fields: { discount: 'More than price' } });
  if (input.budget && input.categoryBudgets) {
    const catSum = input.categoryBudgets.reduce((a, c) => a + toMinor(c.amount), 0);
    if (toMinor(input.budget) > 0 && catSum > toMinor(input.budget)) throw unprocessable(`Category budgets (${formatMoney(catSum, currencyCode)}) add up to more than the project budget (${formatMoney(toMinor(input.budget), currencyCode)}).`);
  }

  // approvals: big discounts and (optionally) new projects wait for an approver unless the creator can approve
  const canDecide = user.perms.has('approvals.decide');
  const pendingApprovals: { type: 'DISCOUNT' | 'NEW_PROJECT'; payload: Record<string, unknown>; title: string; amountMinor?: Minor }[] = [];
  let status = input.status;
  if (!canDecide && settings.approvals.discountThresholdPct > 0 && discount > 0 && Number.isFinite(baseAmt) && discountPct(discount, baseAmt) > settings.approvals.discountThresholdPct) {
    pendingApprovals.push({ type: 'DISCOUNT', payload: { discount: fromMinor(discount) }, title: `Discount of ${formatMoney(discount, currencyCode)} (${discountPct(discount, baseAmt).toFixed(1)}%) on new project "${input.name}"`, amountMinor: discount });
    discount = 0;
  }
  if (!canDecide && settings.approvals.requireNewProjectApproval && ['WON', 'ONBOARDING', 'ACTIVE'].includes(status)) {
    pendingApprovals.push({ type: 'NEW_PROJECT', payload: { status }, title: `Approve new project "${input.name}" as ${status}` });
    status = 'LEAD';
  }

  const n = await nextSequence(tx, 'project');
  const code = `PRJ-${String(n).padStart(4, '0')}`;
  const [p] = await tx.insert(projects).values({
    code, name: input.name, clientId: input.clientId, serviceId: input.serviceId, type: input.type, description: input.description,
    managerId: input.managerId, salesOwnerId: input.salesOwnerId, startDate: input.startDate, endDate: input.endDate, contractDate: input.contractDate,
    priority: input.priority, status, currency: currencyCode, fxRateToBase: fx, taxMode: input.taxMode, taxRatePct: String(taxRatePct),
    sellingPrice: input.type === 'RETAINER' ? '0' : input.sellingPrice, discount: fromMinor(discount), setupFee: input.setupFee, monthlyFee: input.monthlyFee,
    durationMonths: input.durationMonths, paymentTerms: input.paymentTerms, notes: input.notes, budget: input.budget,
  }).returning();

  const memberIds = [...new Set([...(input.memberIds ?? []), ...(input.managerId ? [input.managerId] : [])])];
  if (memberIds.length) await tx.insert(projectMembers).values(memberIds.map((userId) => ({ projectId: p.id, userId }))).onConflictDoNothing();

  const ms: { id: string }[] = [];
  let order = 0;
  for (const m of input.milestones ?? []) {
    const [row] = await tx.insert(milestones).values({ projectId: p.id, name: m.name, description: m.description, price: m.price, cost: m.cost, startDate: m.startDate, dueDate: m.dueDate, status: m.status, sortOrder: order++ }).returning({ id: milestones.id });
    ms.push(row);
  }
  for (const b of input.categoryBudgets ?? []) await tx.insert(projectBudgets).values({ projectId: p.id, categoryId: b.categoryId, amount: b.amount });
  for (const c of input.estimatedCosts ?? []) {
    await tx.insert(projectCosts).values({ projectId: p.id, name: c.name, categoryId: c.categoryId, kind: 'ESTIMATED', status: 'PLANNED', amount: c.amount, originalAmount: c.amount, currency: currencyCode, fxRate: '1', date: input.startDate ?? todayStr(), createdById: user.id });
  }
  if (input.type === 'RETAINER' && input.retainer) {
    const r = input.retainer;
    if (r.endDate < r.startDate) throw unprocessable('The retainer end date cannot be before its start date.');
    const [ret] = await tx.insert(retainers).values({ projectId: p.id, clientId: p.clientId, serviceId: p.serviceId, accountManagerId: r.accountManagerId ?? input.managerId ?? null, billingFrequency: r.billingFrequency }).returning();
    await tx.insert(retainerTerms).values({ retainerId: ret.id, monthlyFee: r.monthlyFee, startDate: r.startDate, endDate: r.endDate, includedHours: String(r.includedHours), overageRate: r.overageRate, renewalDate: r.endDate });
  }
  await audit(tx, actor, { action: 'project.create', entityType: 'project', entityId: p.id, projectId: p.id, summary: `Created project ${code} "${p.name}"`, new: p });

  // payment schedule -> SCHEDULED invoices
  if (input.paymentSchedule?.length) {
    const rev = calculateProjectRevenue({
      type: p.type, status: p.status, sellingPrice: toMinor(p.sellingPrice), discount: toMinor(p.discount), taxMode: p.taxMode, taxRatePct: Number(p.taxRatePct),
      setupFee: toMinor(p.setupFee), monthlyFee: toMinor(p.monthlyFee), durationMonths: p.durationMonths, milestonesTotal: milestoneTotal,
    });
    await generateSchedule(tx, actor, p, rev.contractValue, input.paymentSchedule.map((s) => ({
      type: s.type, label: s.label, pct: s.pct, amount: s.amount, dueDate: s.dueDate, milestoneId: s.milestoneIndex !== undefined ? ms[s.milestoneIndex]?.id ?? null : null,
    })));
  }
  for (const a of pendingApprovals) {
    await requestApproval(tx, actor, { type: a.type, entityType: 'project', entityId: p.id, projectId: p.id, title: a.title, amountMinor: a.amountMinor, payload: a.payload, requestedById: user.id }, currencyCode);
  }
  return { project: p, pendingApprovals: pendingApprovals.length };
}

// ───────────────────────────── update ─────────────────────────────

export async function updateProject(tx: Executor, ctx: Ctx, id: string, patch: ProjectPatch) {
  const { user, actor } = ctx;
  const { version, ...fields } = patch;
  const [old] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!old) throw notFound('Project');
  if (old.archivedAt) throw unprocessable('This project is archived. Restore it before editing.', undefined, 'PROJECT_ARCHIVED');

  const touchesPricing = PRICING_FIELDS.some((f) => f in fields);
  if (touchesPricing && !user.perms.has('profit.view')) throw forbidden('You do not have permission to change project pricing.', 'PRICING_FORBIDDEN');
  await assertActiveRefs(tx, { clientId: fields.clientId !== old.clientId ? fields.clientId : undefined, serviceId: fields.serviceId !== old.serviceId ? fields.serviceId : undefined, managerId: fields.managerId, salesOwnerId: fields.salesOwnerId, memberIds: fields.memberIds });

  const set: Record<string, unknown> = { ...fields };
  delete set.memberIds;
  const sd = (fields.startDate !== undefined ? fields.startDate : old.startDate) as string | null;
  const ed = (fields.endDate !== undefined ? fields.endDate : old.endDate) as string | null;
  if (sd && ed && ed < sd) throw unprocessable('The end date cannot be before the start date.', { fields: { endDate: 'Before start date' } });

  if (fields.currency && fields.currency !== old.currency) {
    const company = await getCompany(tx);
    set.fxRateToBase = await resolveFx(tx, fields.currency, company?.baseCurrency ?? 'INR', fields.fxRateToBase);
  }
  if (fields.taxRatePct !== undefined) set.taxRatePct = String(fields.taxRatePct);
  if (fields.fxRateToBase !== undefined && !fields.currency) set.fxRateToBase = String(fields.fxRateToBase);

  // discount approval
  let discountApproval: { discount: Minor } | null = null;
  if (fields.discount !== undefined && toMinor(fields.discount) !== toMinor(old.discount)) {
    const s = await getSettings(tx);
    const price = fields.sellingPrice !== undefined ? fields.sellingPrice : old.sellingPrice;
    const base = contractBase({ type: (fields.type ?? old.type) as string, sellingPrice: price, setupFee: (fields.setupFee ?? old.setupFee) as string, monthlyFee: (fields.monthlyFee ?? old.monthlyFee) as string, durationMonths: (fields.durationMonths ?? old.durationMonths) as number, milestoneTotal: await milestoneSum(tx, id) });
    const newDisc = toMinor(fields.discount);
    if (newDisc > base) throw unprocessable('The discount cannot be more than the project price.', { fields: { discount: 'More than price' } });
    if (!user.perms.has('approvals.decide') && s.approvals.discountThresholdPct > 0 && newDisc > toMinor(old.discount) && Number.isFinite(base) && discountPct(newDisc, base) > s.approvals.discountThresholdPct) {
      discountApproval = { discount: newDisc };
      delete set.discount;
    }
  }
  if (Object.keys(set).length === 0 && !fields.memberIds) {
    if (discountApproval) {
      await requestApproval(tx, actor, { type: 'DISCOUNT', entityType: 'project', entityId: id, projectId: id, title: `Discount of ${formatMoney(discountApproval.discount, old.currency)} on ${old.code} "${old.name}"`, amountMinor: discountApproval.discount, payload: { discount: fromMinor(discountApproval.discount) }, requestedById: user.id }, old.currency);
      return { project: old, pendingApproval: true };
    }
    return { project: old, pendingApproval: false };
  }
  const row = (Object.keys(set).length ? await updateVersioned(tx, projects as never, id, version, set, 'Project') : old) as Project;
  if (fields.memberIds) {
    await tx.delete(projectMembers).where(eq(projectMembers.projectId, id));
    const ids = [...new Set([...fields.memberIds, ...(row.managerId ? [row.managerId] : [])])];
    if (ids.length) await tx.insert(projectMembers).values(ids.map((userId) => ({ projectId: id, userId })));
  } else if (fields.managerId && fields.managerId !== old.managerId) {
    await tx.insert(projectMembers).values({ projectId: id, userId: fields.managerId }).onConflictDoNothing();
  }
  const d = diffFields(old as never, row as never, Object.keys(set));
  if (d.changed.length) await audit(tx, actor, { action: 'project.update', entityType: 'project', entityId: id, projectId: id, summary: changeSummary(`Project ${old.code}:`, d, old.currency), old: d.old, new: d.new });
  if (discountApproval) {
    await requestApproval(tx, actor, { type: 'DISCOUNT', entityType: 'project', entityId: id, projectId: id, title: `Discount of ${formatMoney(discountApproval.discount, old.currency)} on ${old.code} "${old.name}"`, amountMinor: discountApproval.discount, payload: { discount: fromMinor(discountApproval.discount) }, requestedById: user.id }, old.currency);
  }
  return { project: row, pendingApproval: !!discountApproval };
}

async function milestoneSum(tx: Executor, projectId: string): Promise<Minor> {
  const [r] = (await tx.execute(sql`SELECT COALESCE(SUM(ROUND(price*100)),0)::bigint AS s FROM milestones WHERE project_id = ${projectId}::uuid AND archived_at IS NULL`)).rows as { s: string }[];
  return Number(r.s);
}

// ───────────────────────────── status ─────────────────────────────

const FROZEN = ['CANCELLED', 'LOST'];

export async function changeStatus(tx: Executor, ctx: Ctx, id: string, status: Project['status'], reason?: string | null, opts: { bypassApproval?: boolean } = {}) {
  const { user, actor } = ctx;
  const [old] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!old) throw notFound('Project');
  if (old.status === status) return { project: old, pendingApproval: false };
  if (FROZEN.includes(old.status) && !user.perms.has('projects.archive')) throw forbidden('Only someone who can archive projects may reopen a cancelled or lost project.');
  const s = await getSettings(tx);

  if (status === 'CANCELLED' && !opts.bypassApproval && s.approvals.cancellationRequiresApproval && !user.perms.has('approvals.decide')) {
    if (!reason) throw unprocessable('Please give a reason for cancelling this project.', { fields: { reason: 'Required' } });
    await requestApproval(tx, actor, { type: 'PROJECT_CANCELLATION', entityType: 'project', entityId: id, projectId: id, title: `Cancel ${old.code} "${old.name}": ${reason}`, reason, payload: { status: 'CANCELLED', reason }, requestedById: user.id }, old.currency);
    return { project: old, pendingApproval: true };
  }
  if (status === 'CANCELLED' && !reason) throw unprocessable('Please give a reason for cancelling this project.', { fields: { reason: 'Required' } });
  const [row] = await tx.update(projects).set({ status, cancelledAt: status === 'CANCELLED' ? new Date() : null, version: sql`${projects.version} + 1` }).where(eq(projects.id, id)).returning();

  if (status === 'CANCELLED') {
    // planned (not yet issued) invoices are voided; issued invoices and their payments stay (revenue = what was invoiced)
    await tx.update(invoices).set({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Project cancelled' }).where(and(eq(invoices.projectId, id), eq(invoices.status, 'SCHEDULED')));
    await tx.update(retainers).set({ status: 'CANCELLED', cancelledOn: todayStr() }).where(and(eq(retainers.projectId, id), eq(retainers.status, 'ACTIVE')));
  }
  await audit(tx, actor, { action: 'project.status', entityType: 'project', entityId: id, projectId: id, summary: `Project ${old.code} status changed from ${old.status} to ${status}${reason ? `: ${reason}` : ''}`, old: { status: old.status }, new: { status, reason } });
  return { project: row, pendingApproval: false };
}

// ───────────────────────────── budgets ─────────────────────────────

export async function setBudgets(tx: Executor, ctx: Ctx, id: string, input: { budget?: string; categoryBudgets?: { categoryId: string; amount: string }[] }) {
  const { user, actor } = ctx;
  const [p] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!p) throw notFound('Project');
  const s = await getSettings(tx);
  const newBudget = input.budget !== undefined ? toMinor(input.budget) : toMinor(p.budget);
  const oldBudget = toMinor(p.budget);
  if (input.categoryBudgets) {
    const sum = input.categoryBudgets.reduce((a, c) => a + toMinor(c.amount), 0);
    if (newBudget > 0 && sum > newBudget) throw unprocessable(`Category budgets (${formatMoney(sum, p.currency)}) add up to more than the project budget (${formatMoney(newBudget, p.currency)}).`);
    const ids = input.categoryBudgets.map((c) => c.categoryId);
    if (new Set(ids).size !== ids.length) throw unprocessable('Each category can only appear once in the budget.');
    if (ids.length) {
      const found = await tx.select({ id: categories.id }).from(categories).where(and(inArray(categories.id, ids), eq(categories.kind, 'COST')));
      if (found.length !== ids.length) throw unprocessable('One of the budget categories does not exist.');
    }
  }
  let pending = false;
  const canEditBudgets = user.perms.has('budgets.edit');
  if (!canEditBudgets) {
    // project editors may only *request* an increase of the overall budget; it always goes through approval
    if (input.categoryBudgets || input.budget === undefined || newBudget <= oldBudget) throw forbidden('You can only request a budget increase. Ask a finance user to make other budget changes.');
  }
  if (input.budget !== undefined && newBudget !== oldBudget) {
    const increase = newBudget > oldBudget && (oldBudget > 0 || !canEditBudgets);
    if (increase && (!canEditBudgets || s.approvals.budgetIncreaseRequiresApproval) && !user.perms.has('approvals.decide')) {
      await requestApproval(tx, actor, { type: 'BUDGET_INCREASE', entityType: 'project', entityId: id, projectId: id, title: `Increase budget of ${p.code} from ${formatMoney(oldBudget, p.currency)} to ${formatMoney(newBudget, p.currency)}`, amountMinor: newBudget - oldBudget, payload: { budget: fromMinor(newBudget) }, requestedById: user.id }, p.currency);
      pending = true;
    } else {
      await tx.update(projects).set({ budget: fromMinor(newBudget), version: sql`${projects.version} + 1` }).where(eq(projects.id, id));
      await audit(tx, actor, { action: 'project.budget', entityType: 'project', entityId: id, projectId: id, summary: `Budget of ${p.code} changed from ${formatMoney(oldBudget, p.currency)} to ${formatMoney(newBudget, p.currency)}`, old: { budget: p.budget }, new: { budget: fromMinor(newBudget) } });
    }
  }
  if (input.categoryBudgets) {
    const before = await tx.select().from(projectBudgets).where(eq(projectBudgets.projectId, id));
    await tx.delete(projectBudgets).where(eq(projectBudgets.projectId, id));
    for (const c of input.categoryBudgets) await tx.insert(projectBudgets).values({ projectId: id, categoryId: c.categoryId, amount: c.amount });
    await audit(tx, actor, { action: 'project.category_budgets', entityType: 'project', entityId: id, projectId: id, summary: `Category budgets of ${p.code} updated (${input.categoryBudgets.length} categories)`, old: before.map((b) => ({ categoryId: b.categoryId, amount: b.amount })), new: input.categoryBudgets });
  }
  return { pendingApproval: pending };
}

// ───────────────────────────── archive ─────────────────────────────

export async function setArchived(tx: Executor, ctx: Ctx, id: string, archived: boolean) {
  const [p] = await tx.update(projects).set({ archivedAt: archived ? new Date() : null, version: sql`${projects.version} + 1` }).where(eq(projects.id, id)).returning();
  if (!p) throw notFound('Project');
  await audit(tx, ctx.actor, { action: archived ? 'project.archive' : 'project.restore', entityType: 'project', entityId: id, projectId: id, summary: `${archived ? 'Archived' : 'Restored'} project ${p.code} "${p.name}"` });
  return p;
}

// ───────────────────────────── detail ─────────────────────────────

const minor = (v: string | null | undefined) => toMinor(v ?? '0');

export async function getProjectDetail(user: AuthUser, id: string) {
  const thresholds = (await getSettings()).thresholds;
  const fin = await loadOne(id, { thresholds });
  if (!fin) throw notFound('Project');
  const [p] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  const seeProfit = user.perms.has('profit.view');
  const seeCost = user.perms.has('costs.view');
  const rates = canSeeRates(user);

  const [catBudgets, ms, assignments, adjustments, members, invoiceCounts, ret, byCat, trend] = await Promise.all([
    db.select({ b: projectBudgets, name: categories.name }).from(projectBudgets).innerJoin(categories, eq(categories.id, projectBudgets.categoryId)).where(eq(projectBudgets.projectId, id)),
    db.select().from(milestones).where(and(eq(milestones.projectId, id), sql`${milestones.archivedAt} is null`)).orderBy(milestones.sortOrder, milestones.createdAt),
    db.select({ a: projectResources, name: resources.name, role: resources.role, type: resources.type }).from(projectResources).innerJoin(resources, eq(resources.id, projectResources.resourceId)).where(and(eq(projectResources.projectId, id), sql`${projectResources.archivedAt} is null`)),
    db.select().from(projectAdjustments).where(and(eq(projectAdjustments.projectId, id), sql`${projectAdjustments.archivedAt} is null`)).orderBy(desc(projectAdjustments.date)),
    db.select({ id: users.id, name: users.name, email: users.email }).from(projectMembers).innerJoin(users, eq(users.id, projectMembers.userId)).where(eq(projectMembers.projectId, id)),
    db.execute(sql`SELECT status, count(*)::int AS n FROM invoices WHERE project_id = ${id}::uuid GROUP BY status`),
    db.select().from(retainers).where(eq(retainers.projectId, id)).limit(1),
    db.execute(sql`
      SELECT c.id AS category_id, c.name, COALESCE(SUM(ROUND(pc.amount*100)) FILTER (WHERE pc.kind='ACTUAL' AND pc.status IN ('APPROVED','PAID')),0)::bigint AS actual,
        COALESCE(SUM(ROUND(pc.amount*100)) FILTER (WHERE pc.kind='ESTIMATED' AND pc.status NOT IN ('REJECTED','CANCELLED')),0)::bigint AS estimated,
        COALESCE(SUM(ROUND(pc.amount*100)) FILTER (WHERE pc.kind='COMMITTED' AND pc.status='APPROVED'),0)::bigint AS committed
      FROM project_costs pc JOIN categories c ON c.id = pc.category_id
      WHERE pc.project_id = ${id}::uuid AND pc.archived_at IS NULL GROUP BY c.id, c.name ORDER BY 3 DESC`),
    db.execute(sql`
      SELECT to_char(date_trunc('month', pc.date),'YYYY-MM-01') AS month, COALESCE(SUM(ROUND(pc.amount*100)),0)::bigint AS actual
      FROM project_costs pc WHERE pc.project_id = ${id}::uuid AND pc.archived_at IS NULL AND pc.kind='ACTUAL' AND pc.status IN ('APPROVED','PAID')
      GROUP BY 1 ORDER BY 1`),
  ]);

  const msPay = await milestonePaymentStatus(db, id);
  const actualByCat = new Map((byCat.rows as { category_id: string; actual: string }[]).map((r) => [r.category_id, Number(r.actual)]));
  const budgetLines = calculateCategoryBudgets(catBudgets.map((b) => ({ categoryId: b.b.categoryId, budget: minor(b.b.amount), actual: actualByCat.get(b.b.categoryId) ?? 0 })), thresholds);
  const nameOf = new Map(catBudgets.map((b) => [b.b.categoryId, b.name]));

  return {
    project: {
      ...p,
      // pricing fields only for users who may see profit; budget only for users who may see costs
      sellingPrice: seeProfit ? p.sellingPrice : undefined,
      discount: seeProfit ? p.discount : undefined,
      setupFee: seeProfit ? p.setupFee : undefined,
      monthlyFee: seeProfit ? p.monthlyFee : undefined,
      taxRatePct: seeProfit ? p.taxRatePct : undefined,
      budget: seeCost ? p.budget : undefined,
      isRecognised: RECOGNISED_STATUSES.includes(p.status),
    },
    financials: toProjectDTO(fin, user),
    categoryBudgets: seeCost ? budgetLines.map((l) => ({ ...l, name: nameOf.get(l.categoryId) ?? '' })) : undefined,
    costByCategory: seeCost ? (byCat.rows as { category_id: string; name: string; actual: string; estimated: string; committed: string }[]).map((r) => ({ categoryId: r.category_id, name: r.name, actual: Number(r.actual), estimated: Number(r.estimated), committed: Number(r.committed) })) : undefined,
    costTrend: seeCost ? (trend.rows as { month: string; actual: string }[]).map((r) => ({ month: r.month, actual: Number(r.actual) })) : undefined,
    milestones: ms.map((m) => ({ ...m, payment: seeProfit ? msPay[m.id] ?? { invoiced: 0, settled: 0, status: 'NOT_INVOICED' } : undefined, profit: seeProfit ? minor(m.price) - minor(m.cost) : undefined, price: seeProfit ? m.price : undefined, cost: seeCost ? m.cost : undefined })),
    resources: assignments.map((x) => ({
      id: x.a.id, resourceId: x.a.resourceId, name: x.name, role: x.role, type: x.type, plannedHours: x.a.plannedHours, actualHours: x.a.actualHours,
      costRate: rates ? x.a.costRate : undefined, billingRate: rates ? x.a.billingRate : undefined, paidAmount: rates ? x.a.paidAmount : undefined,
      cost: rates && x.type !== 'EMPLOYEE' ? Math.round(Number(x.a.actualHours) * minor(x.a.costRate)) : undefined,
      revenue: rates && seeProfit ? Math.round(Number(x.a.actualHours) * minor(x.a.billingRate)) : undefined,
    })),
    adjustments: seeProfit ? adjustments : [],
    members,
    invoiceCounts: seeProfit || user.perms.has('payments.view') ? invoiceCounts.rows : [],
    retainer: ret[0] ?? null,
    thresholds,
  };
}

export { calculateBudget, conflict, notify };
