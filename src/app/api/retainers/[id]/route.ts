import { z } from 'zod';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { getRetainerDetail, updateRetainer } from '@/lib/services/retainers';
import { BILLING_FREQUENCIES } from '@/db/schema';
import { optText, optUuid } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'retainers.view' }, async ({ id, user }) => getRetainerDetail(user, id()));

export const PATCH = route({ perm: 'retainers.manage', body: z.object({ accountManagerId: optUuid, notes: optText(2000), billingFrequency: z.enum(BILLING_FREQUENCIES).optional() }).partial() }, async ({ id, body, user, actor }) => {
  const rid = id();
  await getRetainerDetail(user, rid); // access check (404 when outside scope)
  return db.transaction((tx) => updateRetainer(tx, { user, actor }, rid, body as never));
});
