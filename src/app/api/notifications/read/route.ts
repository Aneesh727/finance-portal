import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { route, uuidSchema } from '@/lib/api';
import { db } from '@/lib/db';
import { notifications } from '@/db/schema';

export const dynamic = 'force-dynamic';

export const POST = route({ body: z.object({ ids: z.array(uuidSchema).max(200).optional(), all: z.boolean().optional() }) }, async ({ body, user }) => {
  const own = eq(notifications.userId, user.id);
  const res = await db.update(notifications).set({ readAt: new Date() })
    .where(and(own, sql`${notifications.readAt} is null`, body.all ? undefined : inArray(notifications.id, body.ids?.length ? body.ids : ['00000000-0000-0000-0000-000000000000']))).returning({ id: notifications.id });
  return { updated: res.length };
});
