import { z } from 'zod';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { assertChildAccess } from '@/lib/access';
import { voidCost } from '@/lib/services/costs';
import { reqText } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: 'costs.create', body: z.object({ reason: reqText(300) }) }, async ({ id, body, user, actor }) => {
  const cid = id();
  await assertChildAccess(user, 'project_costs', cid);
  const row = await db.transaction((tx) => voidCost(tx, { user, actor }, cid, body.reason));
  return { id: cid, voided: true, version: row.version };
});
