import { eq } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { clients } from '@/db/schema';
import { notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: 'clients.manage' }, async ({ id, audit }) => {
  const cid = id();
  return db.transaction(async (tx) => {
    const [c] = await tx.update(clients).set({ archivedAt: null }).where(eq(clients.id, cid)).returning();
    if (!c) throw notFound('Client');
    await audit(tx, { action: 'client.restore', entityType: 'client', entityId: cid, summary: `Restored client ${c.companyName}` });
    return c;
  });
});
