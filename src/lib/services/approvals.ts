/** Decide approval requests and apply the approved operation (atomically, with stale-state checks). */
import { and, eq, sql } from 'drizzle-orm';
import type { Executor } from '@/lib/db';
import { approvals, expenses, projectCosts, projects } from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { audit, type Actor } from '@/lib/audit';
import { conflict, forbidden, notFound, unprocessable } from '@/lib/errors';
import { formatMoney, fromMinor, toMinor } from '@/lib/money';
import { notify } from './notifications';
import { updateCost } from './costs';
import { syncMirror } from './expenses';
import { changeStatus } from './projects';
import { evaluateProjectAlerts } from './alerts';

type Ctx = { user: AuthUser; actor: Actor };
type Approval = typeof approvals.$inferSelect;
const COST_TYPES = ['LARGE_EXPENSE', 'VENDOR_EXPENSE', 'OVER_BUDGET', 'COST_THRESHOLD'];

async function applyApproved(tx: Executor, ctx: Ctx, a: Approval) {
  const payload = (a.payload ?? {}) as Record<string, unknown>;
  if (a.entityType === 'cost' && a.entityId) {
    if (a.type === 'COST_CHANGE') {
      const patch = (payload.patch ?? {}) as never;
      await updateCost(tx, ctx, a.entityId, patch, { skipGuard: true, skipPerm: true });
      return;
    }
    const [c] = await tx.select().from(projectCosts).where(eq(projectCosts.id, a.entityId)).limit(1);
    if (!c || c.archivedAt || c.status !== 'PENDING_APPROVAL') throw conflict('This cost was changed or removed after the request. Reject or cancel this approval.', 'STALE_APPROVAL');
    await tx.update(projectCosts).set({ status: 'APPROVED', version: sql`${projectCosts.version} + 1` }).where(eq(projectCosts.id, c.id));
    await evaluateProjectAlerts(tx, c.projectId);
    return;
  }
  if (a.entityType === 'expense' && a.entityId) {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, a.entityId)).limit(1);
    if (!e || e.archivedAt) throw conflict('This expense was removed after the request. Reject or cancel this approval.', 'STALE_APPROVAL');
    if (payload.isChange) {
      const set = (payload.patch ?? {}) as Record<string, unknown>;
      await tx.update(expenses).set({ ...set, version: sql`${expenses.version} + 1` } as never).where(eq(expenses.id, e.id));
    } else {
      if (e.status !== 'PENDING_APPROVAL') throw conflict('This expense is no longer waiting for approval.', 'STALE_APPROVAL');
      await tx.update(expenses).set({ status: 'APPROVED', version: sql`${expenses.version} + 1` }).where(eq(expenses.id, e.id));
    }
    const [row] = await tx.select().from(expenses).where(eq(expenses.id, e.id)).limit(1);
    const [p] = row.projectId ? await tx.select().from(projects).where(eq(projects.id, row.projectId)).limit(1) : [null];
    await syncMirror(tx, ctx, row, p ?? null, (payload.costCategoryId as string | null) ?? null);
    if (row.projectId) await evaluateProjectAlerts(tx, row.projectId);
    return;
  }
  if (a.entityType === 'project' && a.entityId) {
    const [p] = await tx.select().from(projects).where(eq(projects.id, a.entityId)).limit(1);
    if (!p) throw conflict('The project no longer exists.', 'STALE_APPROVAL');
    switch (a.type) {
      case 'DISCOUNT':
        await tx.update(projects).set({ discount: String(payload.discount), version: sql`${projects.version} + 1` }).where(eq(projects.id, p.id));
        break;
      case 'BUDGET_INCREASE':
        await tx.update(projects).set({ budget: String(payload.budget), version: sql`${projects.version} + 1` }).where(eq(projects.id, p.id));
        break;
      case 'PROJECT_CANCELLATION':
        await changeStatus(tx, ctx, p.id, 'CANCELLED', (payload.reason as string) ?? 'Approved cancellation', { bypassApproval: true });
        break;
      case 'NEW_PROJECT':
        await changeStatus(tx, ctx, p.id, payload.status as never, null, { bypassApproval: true });
        break;
      default:
        throw unprocessable(`Unsupported approval type ${a.type}`);
    }
    await evaluateProjectAlerts(tx, p.id);
    return;
  }
  throw unprocessable('This approval cannot be applied automatically.');
}

async function applyRejected(tx: Executor, a: Approval) {
  if (a.entityType === 'cost' && a.entityId && COST_TYPES.includes(a.type)) {
    await tx.update(projectCosts).set({ status: 'REJECTED', version: sql`${projectCosts.version} + 1` }).where(and(eq(projectCosts.id, a.entityId), eq(projectCosts.status, 'PENDING_APPROVAL')));
  } else if (a.entityType === 'expense' && a.entityId && !(a.payload as { isChange?: boolean } | null)?.isChange) {
    await tx.update(expenses).set({ status: 'REJECTED', version: sql`${expenses.version} + 1` }).where(and(eq(expenses.id, a.entityId), eq(expenses.status, 'PENDING_APPROVAL')));
  } else if (a.entityType === 'project' && a.type === 'NEW_PROJECT' && a.entityId) {
    // project stays in LEAD
  }
}

export async function decideApproval(tx: Executor, ctx: Ctx, id: string, decision: 'APPROVED' | 'REJECTED', note?: string | null) {
  const { user, actor } = ctx;
  const [a0] = await tx.select().from(approvals).where(eq(approvals.id, id)).limit(1);
  if (!a0) throw notFound('Approval');
  if (a0.requestedById === user.id) throw forbidden('You cannot decide your own request. Ask another approver.', 'SELF_APPROVAL');
  if (decision === 'REJECTED' && !note) throw unprocessable('Please give a reason for rejecting.', { fields: { note: 'Required' } });
  // claim atomically: only one concurrent decision can win
  const claimed = await tx.update(approvals).set({ status: decision, decidedById: user.id, decidedAt: new Date(), decisionNote: note ?? null }).where(and(eq(approvals.id, id), eq(approvals.status, 'PENDING'))).returning();
  if (!claimed.length) throw conflict(`This request was already ${a0.status.toLowerCase()}.`, 'ALREADY_DECIDED');
  const a = claimed[0];
  if (decision === 'APPROVED') await applyApproved(tx, ctx, a);
  else await applyRejected(tx, a);
  await audit(tx, actor, { action: decision === 'APPROVED' ? 'approval.approve' : 'approval.reject', entityType: 'approval', entityId: id, projectId: a.projectId, summary: `${decision === 'APPROVED' ? 'Approved' : 'Rejected'}: ${a.title}${note ? ` — ${note}` : ''}`, old: { status: 'PENDING' }, new: { status: decision, note } });
  await notify(tx, { type: 'APPROVAL_REQUIRED', severity: decision === 'APPROVED' ? 'info' : 'warning', title: `Request ${decision.toLowerCase()}`, body: a.title + (note ? ` — ${note}` : ''), link: '/approvals', dedupeKey: `approval-decided:${a.id}`, userIds: [a.requestedById] });
  return a;
}

export async function cancelApproval(tx: Executor, ctx: Ctx, id: string) {
  const [a] = await tx.select().from(approvals).where(eq(approvals.id, id)).limit(1);
  if (!a) throw notFound('Approval');
  if (a.requestedById !== ctx.user.id && !ctx.user.perms.has('approvals.decide')) throw forbidden();
  const res = await tx.update(approvals).set({ status: 'CANCELLED', decidedById: ctx.user.id, decidedAt: new Date(), decisionNote: 'Cancelled by requester' }).where(and(eq(approvals.id, id), eq(approvals.status, 'PENDING'))).returning();
  if (!res.length) throw conflict(`This request was already ${a.status.toLowerCase()}.`, 'ALREADY_DECIDED');
  await applyRejected(tx, res[0]);
  await audit(tx, ctx.actor, { action: 'approval.cancel', entityType: 'approval', entityId: id, projectId: a.projectId, summary: `Cancelled request: ${a.title}` });
  return res[0];
}
void formatMoney; void fromMinor; void toMinor;
