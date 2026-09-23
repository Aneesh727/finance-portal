import { z } from 'zod';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { assertChildAccess } from '@/lib/access';
import { issueInvoice } from '@/lib/services/billing';
import { optDate } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: 'payments.manage', body: z.object({ issueDate: optDate }) }, async ({ id, body, user, actor }) => {
  const iid = id();
  await assertChildAccess(user, 'invoices', iid);
  return db.transaction((tx) => issueInvoice(tx, actor, iid, body.issueDate ?? undefined));
});
