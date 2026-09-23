import { eq } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { vendors } from '@/db/schema';
import { notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: 'resources.manage' }, async ({ id, audit }) => {
  const rid = id();
  return db.transaction(async (tx) => {
    const [v] = await tx.update(vendors).set({ archivedAt: null }).where(eq(vendors.id, rid)).returning();
    if (!v) throw notFound('Vendor');
    await audit(tx, { action: 'vendor.restore', entityType: 'vendor', entityId: rid, summary: `Restored vendor ${v.name}` });
    return v;
  });
});
