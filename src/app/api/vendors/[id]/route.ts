import { eq } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { vendors } from '@/db/schema';
import { notFound } from '@/lib/errors';
import { changeSummary, diffFields } from '@/lib/audit';
import { vendorBody } from '@/lib/validators';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'resources.view' }, async ({ id }) => {
  const [v] = await db.select().from(vendors).where(eq(vendors.id, id())).limit(1);
  if (!v) throw notFound('Vendor');
  return v;
});

export const PATCH = route({ perm: 'resources.manage', body: vendorBody.partial() }, async ({ id, body, audit }) => {
  const vid = id();
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(vendors).where(eq(vendors.id, vid)).limit(1);
    if (!old) throw notFound('Vendor');
    const [row] = await tx.update(vendors).set(body).where(eq(vendors.id, vid)).returning();
    const d = diffFields(old as never, row as never, Object.keys(body));
    await audit(tx, { action: 'vendor.update', entityType: 'vendor', entityId: vid, summary: changeSummary(`Vendor ${old.name}:`, d), old: d.old, new: d.new });
    return row;
  });
});
