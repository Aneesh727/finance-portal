import type { Executor } from '@/lib/db';
import { approvals } from '@/db/schema';
import { notify } from './notifications';
import type { Actor } from '@/lib/audit';
import { audit } from '@/lib/audit';
import { fromMinor, formatMoney, type Minor } from '@/lib/money';
import type { InferSelectModel } from 'drizzle-orm';

type ApprovalType = InferSelectModel<typeof approvals>['type'];

export interface ApprovalRequest {
  type: ApprovalType;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  title: string;
  reason?: string | null;
  amountMinor?: Minor | null;
  payload?: unknown;
  requestedById: string;
}

/** Create a pending approval and notify everyone who can decide it. */
export async function requestApproval(tx: Executor, actor: Actor, r: ApprovalRequest, currency = 'INR') {
  const [a] = await tx
    .insert(approvals)
    .values({
      type: r.type, entityType: r.entityType, entityId: r.entityId ?? null, projectId: r.projectId ?? null, title: r.title, reason: r.reason ?? null,
      amount: r.amountMinor != null ? fromMinor(r.amountMinor) : null, payload: (r.payload ?? null) as never, requestedById: r.requestedById,
    })
    .returning();
  await audit(tx, actor, { action: 'approval.request', entityType: 'approval', entityId: a.id, projectId: r.projectId ?? null, summary: `Approval requested: ${r.title}${r.amountMinor != null ? ` (${formatMoney(r.amountMinor, currency)})` : ''}`, new: a });
  await notify(tx, {
    type: 'APPROVAL_REQUIRED', severity: 'warning', title: 'Approval required', body: r.title, link: '/approvals', dedupeKey: `approval:${a.id}`, permission: 'approvals.decide',
  });
  return a;
}
