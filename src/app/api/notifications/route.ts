import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { route, listQuery, reply } from '@/lib/api';
import { db } from '@/lib/db';
import { notifications } from '@/db/schema';
import { pageMeta } from '@/lib/crud';
import { unreadCount } from '@/lib/services/notifications';

export const dynamic = 'force-dynamic';

/** the caller's own notifications only */
export const GET = route({ query: listQuery.extend({ unread: z.enum(['0', '1']).default('0') }) }, async ({ query, user }) => {
  const where = and(eq(notifications.userId, user.id), query.unread === '1' ? sql`${notifications.readAt} is null` : undefined);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(where)) as { n: number }[];
  const rows = await db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
  return reply(rows.map((r) => ({ id: r.id, type: r.type, severity: r.severity, title: r.title, body: r.body, link: r.link, read: !!r.readAt, createdAt: r.createdAt })), { meta: { ...pageMeta(query.page, query.pageSize, n), unread: await unreadCount(db, user.id) } });
});
