import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { clients } from '@/db/schema';
import { notFound } from '@/lib/errors';
import { updateVersioned } from '@/lib/crud';
import { changeSummary, diffFields } from '@/lib/audit';
import { stateFromGstin, version } from '@/lib/schemas';
import { clientBody } from '@/lib/validators';
import { clientStats } from '@/lib/services/clients';
import { loadProjectFinancials } from '@/lib/finance/loaders';
import { toProjectDTO } from '@/lib/finance/loaders';
import { projectScopeSql } from '@/lib/access';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'clients.view' }, async ({ id, user }) => {
  const [c] = await db.select().from(clients).where(eq(clients.id, id())).limit(1);
  if (!c) throw notFound('Client');
  const stats = (await clientStats([c.id], user)).get(c.id);
  const rows = await loadProjectFinancials({ where: sql`p.client_id = ${c.id}::uuid AND ${projectScopeSql(user)}`, order: sql`p.created_at DESC` });
  return { client: c, stats, projects: rows.map((r) => toProjectDTO(r, user)) };
});

const patch = clientBody.partial().extend({ version });

export const PATCH = route({ perm: 'clients.manage', body: patch }, async ({ id, body, audit }) => {
  const cid = id();
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(clients).where(eq(clients.id, cid)).limit(1);
    if (!old) throw notFound('Client');
    const { version: v, ...fields } = body;
    const set: Record<string, unknown> = { ...fields };
    if ('gstin' in fields) set.stateCode = stateFromGstin(fields.gstin as string | null);
    const row = await updateVersioned(tx, clients as never, cid, v, set, 'Client');
    const d = diffFields(old as never, row as never, Object.keys(fields));
    await audit(tx, { action: 'client.update', entityType: 'client', entityId: cid, summary: changeSummary(`Client ${old.companyName}:`, d), old: d.old, new: d.new });
    return row;
  });
});
void z;
