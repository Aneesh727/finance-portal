import { z } from 'zod';
import { route, created, listQuery, reply } from '@/lib/api';
import { db } from '@/lib/db';
import { dealBody } from '@/lib/validators';
import { createDeal, listDeals } from '@/lib/services/deals';
import { pageMeta } from '@/lib/crud';
import { DEAL_STATUSES } from '@/db/schema';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'deals.view', query: listQuery.extend({ status: z.enum(DEAL_STATUSES).optional() }) }, async ({ query }) => {
  const r = await listDeals({ status: query.status, q: query.q, page: query.page, pageSize: query.pageSize });
  return reply(r.rows, { meta: pageMeta(query.page, query.pageSize, r.total) });
});

export const POST = route({ perm: 'deals.manage', body: dealBody }, async ({ body, user, actor }) => created(await db.transaction((tx) => createDeal(tx, { user, actor }, body))));
