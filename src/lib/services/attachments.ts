import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { attachments, ATTACHMENT_ENTITIES, clients, deals, expenses } from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { assertChildAccess, isProjectAccessible } from '@/lib/access';
import { forbidden, notFound } from '@/lib/errors';
import type { Perm } from '@/lib/permissions';

export type AttachmentEntity = (typeof ATTACHMENT_ENTITIES)[number];

const PERMS: Record<AttachmentEntity, { view: Perm; write: Perm }> = {
  PROJECT: { view: 'projects.view', write: 'projects.edit' },
  COST: { view: 'costs.view', write: 'costs.create' },
  EXPENSE: { view: 'expenses.view', write: 'expenses.create' },
  INVOICE: { view: 'payments.view', write: 'payments.manage' },
  PAYMENT: { view: 'payments.view', write: 'payments.manage' },
  CLIENT: { view: 'clients.view', write: 'clients.manage' },
  DEAL: { view: 'deals.view', write: 'deals.manage' },
};

/** enforce permission + row-level access for the parent record; returns its project id (if any) */
export async function authorizeEntity(user: AuthUser, type: AttachmentEntity, id: string, mode: 'view' | 'write'): Promise<string | null> {
  const need = PERMS[type][mode];
  if (!user.perms.has(need)) throw forbidden();
  switch (type) {
    case 'PROJECT': {
      const { getAccessibleProject } = await import('@/lib/access');
      return (await getAccessibleProject(user, id)).id;
    }
    case 'COST': return assertChildAccess(user, 'project_costs', id);
    case 'INVOICE': return assertChildAccess(user, 'invoices', id);
    case 'PAYMENT': return assertChildAccess(user, 'payments', id);
    case 'EXPENSE': {
      const [e] = await db.select({ p: expenses.projectId }).from(expenses).where(eq(expenses.id, id)).limit(1);
      if (!e) throw notFound('Expense');
      if (e.p && !(await isProjectAccessible(user, e.p))) throw notFound('Expense');
      return e.p;
    }
    case 'CLIENT': {
      const [c] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, id)).limit(1);
      if (!c) throw notFound('Client');
      return null;
    }
    case 'DEAL': {
      const [d] = await db.select({ id: deals.id }).from(deals).where(eq(deals.id, id)).limit(1);
      if (!d) throw notFound('Deal');
      return null;
    }
  }
}

export async function loadAttachment(id: string) {
  const [a] = await db.select().from(attachments).where(and(eq(attachments.id, id), sql`${attachments.archivedAt} is null`)).limit(1);
  if (!a) throw notFound('File');
  return a;
}
