import { z } from 'zod';
import { route, created, listQuery, reply } from '@/lib/api';
import { db } from '@/lib/db';
import { retainerCreate } from '@/lib/validators';
import { createRetainer, listRetainers } from '@/lib/services/retainers';
import { pageMeta } from '@/lib/crud';
import { getAccessibleProject } from '@/lib/access';

export const dynamic = 'force-dynamic';

const query = listQuery.extend({ status: z.enum(['ACTIVE', 'EXPIRED', 'CANCELLED']).optional() });

export const GET = route({ perm: 'retainers.view', query }, async ({ query, user }) => {
  const r = await listRetainers(user, { status: query.status, q: query.q, page: query.page, pageSize: query.pageSize });
  return reply(r.rows, { meta: { ...pageMeta(query.page, query.pageSize, r.total), mrrMinor: r.mrr, activeCount: r.activeCount } });
});

export const POST = route({ perm: ['retainers.manage', 'projects.create'], body: retainerCreate }, async ({ body, user, actor }) => {
  const res = await db.transaction((tx) => createRetainer(tx, { user, actor }, body));
  return created({ id: res.retainer.id, projectId: res.project.id, code: res.project.code });
});
