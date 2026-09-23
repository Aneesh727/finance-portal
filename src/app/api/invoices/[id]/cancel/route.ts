import { z } from 'zod';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { assertChildAccess } from '@/lib/access';
import { cancelInvoice } from '@/lib/services/billing';
import { reqText } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: 'payments.manage', body: z.object({ reason: reqText(300) }) }, async ({ id, body, user, actor }) => {
  const iid = id();
  await assertChildAccess(user, 'invoices', iid);
  return db.transaction((tx) => cancelInvoice(tx, actor, iid, body.reason));
});
