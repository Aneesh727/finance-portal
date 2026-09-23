import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Executor } from '@/lib/db';
import { expenses, recurringRules } from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { audit, type Actor } from '@/lib/audit';
import { notFound, unprocessable } from '@/lib/errors';
import { occurrences, frequencyToMonths } from '@/lib/finance/recurring';
import { todayStr } from '@/lib/dates';
import { fromMinor, toMinor } from '@/lib/money';
import type { recurringBody } from '@/lib/validators';
import { createExpense } from './expenses';

type Ctx = { user: AuthUser; actor: Actor };
export type RecurringInput = z.infer<typeof recurringBody>;
type Rule = typeof recurringRules.$inferSelect;

export const ruleInterval = (r: Pick<Rule, 'frequency' | 'intervalMonths'>) => frequencyToMonths(r.frequency, r.intervalMonths);

function validate(i: RecurringInput) {
  if (i.endDate && i.endDate < i.startDate) throw unprocessable('The end date cannot be before the start date.', { fields: { endDate: 'Before start date' } });
  if (i.scope === 'PROJECT' && !i.projectId) throw unprocessable('Choose the project for a project-scope recurring expense.', { fields: { projectId: 'Required' } });
  if (i.scope === 'DEPARTMENT' && !i.department) throw unprocessable('Enter the department.', { fields: { department: 'Required' } });
  if (i.scope !== 'PROJECT' && i.projectId) throw unprocessable('Only project-scope rules can name a project.', { fields: { scope: 'Set to PROJECT' } });
}

export async function createRule(tx: Executor, ctx: Ctx, input: RecurringInput) {
  validate(input);
  const [row] = await tx.insert(recurringRules).values({
    name: input.name, categoryId: input.categoryId, vendorId: input.vendorId, projectId: input.projectId, department: input.department, scope: input.scope, amount: input.amount, taxAmount: input.taxAmount,
    frequency: input.frequency, intervalMonths: input.frequency === 'CUSTOM' ? input.intervalMonths : 1, startDate: input.startDate, endDate: input.endDate, active: input.active, notes: input.notes,
  }).returning();
  await audit(tx, ctx.actor, { action: 'recurring.create', entityType: 'recurring_rule', entityId: row.id, summary: `Created recurring expense "${row.name}" (${row.frequency.toLowerCase()})`, new: row });
  return row;
}

export async function updateRule(tx: Executor, ctx: Ctx, id: string, input: Partial<RecurringInput>) {
  const [old] = await tx.select().from(recurringRules).where(eq(recurringRules.id, id)).limit(1);
  if (!old) throw notFound('Recurring rule');
  const merged = { ...old, ...input } as never as RecurringInput;
  validate({ ...merged, projectId: merged.projectId ?? null } as RecurringInput);
  const set: Record<string, unknown> = { ...input, updatedAt: new Date() };
  if (input.frequency && input.frequency !== 'CUSTOM') set.intervalMonths = 1;
  const [row] = await tx.update(recurringRules).set(set).where(eq(recurringRules.id, id)).returning();
  await audit(tx, ctx.actor, { action: 'recurring.update', entityType: 'recurring_rule', entityId: id, summary: `Updated recurring expense "${old.name}"${input.active === false ? ' (paused)' : ''}`, old, new: row });
  return row;
}

/**
 * Generate every due, not yet generated occurrence (<= asOf). Safe to run repeatedly and concurrently:
 * a per-rule advisory lock plus a UNIQUE(rule, period) index make duplicates impossible.
 */
export async function generateForRule(tx: Executor, ctx: Ctx, ruleId: string, asOf = todayStr()) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'rule:' + ruleId}))`);
  const [r] = await tx.select().from(recurringRules).where(eq(recurringRules.id, ruleId)).limit(1);
  if (!r) throw notFound('Recurring rule');
  if (!r.active) return { created: 0, dates: [] as string[] };
  const dates = occurrences({ start: r.startDate, intervalMonths: ruleInterval(r), end: r.endDate, from: r.startDate, to: asOf });
  const have = new Set((await tx.select({ p: expenses.periodStart }).from(expenses).where(and(eq(expenses.recurringRuleId, ruleId), sql`${expenses.periodStart} is not null`))).map((x) => x.p));
  const created: string[] = [];
  for (const dt of dates) {
    if (have.has(dt)) continue;
    await createExpense(tx, ctx, {
      date: dt, categoryId: r.categoryId, description: r.name, amount: r.amount, taxAmount: r.taxAmount, vendorId: r.vendorId, paymentMethod: 'BANK_TRANSFER', scope: r.scope, projectId: r.scope === 'PROJECT' ? r.projectId : null,
      department: r.department, reference: null, notes: r.notes ?? undefined, overrideBudget: true, overrideReason: 'Recurring expense', currency: undefined, fxRate: undefined, recurringRuleId: ruleId, costCategoryId: null,
    } as never, { fromRecurring: { ruleId, periodStart: dt }, skipApproval: true });
    created.push(dt);
  }
  if (created.length) {
    await tx.update(recurringRules).set({ lastGeneratedThrough: created[created.length - 1] }).where(eq(recurringRules.id, ruleId));
    await audit(tx, ctx.actor, { action: 'recurring.generate', entityType: 'recurring_rule', entityId: ruleId, summary: `Generated ${created.length} expense(s) from "${r.name}"`, new: { dates: created } });
  }
  return { created: created.length, dates: created };
}

/** next scheduled dates, for the UI preview */
export function upcoming(r: Pick<Rule, 'startDate' | 'endDate' | 'frequency' | 'intervalMonths'>, from: string, n = 6): string[] {
  return occurrences({ start: r.startDate, intervalMonths: ruleInterval(r), end: r.endDate, from, to: '2100-01-01', limit: n });
}
void fromMinor; void toMinor;
