import { z } from 'zod';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { generateRetainerInvoices, getRetainerDetail } from '@/lib/services/retainers';
import { optDate } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/** issue the retainer fee invoices that are due (idempotent) */
export const POST = route({ perm: ['payments.manage', 'retainers.view'], body: z.object({ asOf: optDate, dueDays: z.coerce.number().int().min(0).max(120).default(15) }) }, async ({ id, body, user, actor }) => {
  const rid = id();
  await getRetainerDetail(user, rid);
  const made = await db.transaction((tx) => generateRetainerInvoices(tx, { user, actor }, rid, body.asOf ?? undefined, body.dueDays));
  return { created: made.length, invoices: made };
});
