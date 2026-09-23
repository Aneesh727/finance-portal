import { z } from 'zod';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { cancelRetainer, getRetainerDetail } from '@/lib/services/retainers';
import { dateStr, reqText } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: 'retainers.manage', body: z.object({ cancelOn: dateStr, reason: reqText(300) }) }, async ({ id, body, user, actor }) => {
  const rid = id();
  await getRetainerDetail(user, rid);
  return db.transaction((tx) => cancelRetainer(tx, { user, actor }, rid, body.cancelOn, body.reason));
});
