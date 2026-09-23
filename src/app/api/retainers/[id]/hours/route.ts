import { z } from 'zod';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { getRetainerDetail, setHours } from '@/lib/services/retainers';
import { dateStr, num, optText } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const PUT = route({ perm: ['retainers.manage'], body: z.object({ month: dateStr, hoursUsed: num(0, 100000), notes: optText(300) }) }, async ({ id, body, user, actor }) => {
  const rid = id();
  await getRetainerDetail(user, rid);
  return db.transaction((tx) => setHours(tx, { user, actor }, rid, body.month, body.hoursUsed, body.notes));
});
