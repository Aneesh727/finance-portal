import { z } from 'zod';
import { route, created } from '@/lib/api';
import { db } from '@/lib/db';
import { getRetainerDetail, invoiceOverage } from '@/lib/services/retainers';
import { dateStr } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/** invoice the hours beyond the included allowance for one month (once per month) */
export const POST = route({ perm: ['payments.manage', 'retainers.view'], body: z.object({ month: dateStr, dueDays: z.coerce.number().int().min(0).max(120).default(15) }) }, async ({ id, body, user, actor }) => {
  const rid = id();
  await getRetainerDetail(user, rid);
  return created(await db.transaction((tx) => invoiceOverage(tx, { user, actor }, rid, body.month, body.dueDays)));
});
