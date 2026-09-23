import { z } from 'zod';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { markLost } from '@/lib/services/deals';
import { reqText } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: 'deals.manage', body: z.object({ reason: reqText(300) }) }, async ({ id, body, user, actor }) => {
  const d = await db.transaction((tx) => markLost(tx, { user, actor }, id(), body.reason));
  return { id: d.id, status: d.status };
});
