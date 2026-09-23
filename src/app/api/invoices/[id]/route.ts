import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { invoices, payments } from '@/db/schema';
import { assertChildAccess } from '@/lib/access';
import { notFound, conflict } from '@/lib/errors';
import { dateStr, optText, version } from '@/lib/schemas';
import { updateVersioned } from '@/lib/crud';
import { audit } from '@/lib/audit';
import { INVOICE_FROM, INVOICE_SELECT, mapInvoice } from '@/lib/services/invoice-query';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'payments.view' }, async ({ id, user }) => {
  const iid = id();
  await assertChildAccess(user, 'invoices', iid);
  const r = (await db.execute(sql`SELECT ${INVOICE_SELECT} ${INVOICE_FROM} WHERE i.id = ${iid}::uuid`)).rows[0];
  if (!r) throw notFound('Invoice');
  const pays = await db.select().from(payments).where(eq(payments.invoiceId, iid)).orderBy(payments.receivedDate);
  return { invoice: mapInvoice(r), payments: pays };
});

const patch = z.object({ dueDate: dateStr.optional(), description: optText(500).optional(), version });

export const PATCH = route({ perm: 'payments.manage', body: patch }, async ({ id, body, user, actor }) => {
  const iid = id();
  await assertChildAccess(user, 'invoices', iid);
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(invoices).where(eq(invoices.id, iid)).limit(1);
    if (!old) throw notFound('Invoice');
    if (old.status === 'CANCELLED') throw conflict('A cancelled invoice cannot be edited.', 'INVALID_STATE');
    const { version: v, ...fields } = body;
    const set = Object.fromEntries(Object.entries(fields).filter(([, x]) => x !== undefined));
    if (!Object.keys(set).length) return old;
    const row = await updateVersioned(tx, invoices as never, iid, v, set, 'Invoice');
    await audit(tx, actor, { action: 'invoice.update', entityType: 'invoice', entityId: iid, projectId: old.projectId, summary: `Updated invoice ${old.number} (${Object.keys(set).join(', ')})`, old: { dueDate: old.dueDate, description: old.description }, new: set });
    return row;
  });
});
