import { z } from 'zod';
import { route, created } from '@/lib/api';
import { db } from '@/lib/db';
import { convertDeal } from '@/lib/services/deals';
import { optDate, optUuid } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: ['deals.manage', 'projects.create'], body: z.object({ scenarioId: optUuid, clientId: optUuid, startDate: optDate, endDate: optDate }) }, async ({ id, body, user, actor }) => {
  const p = await db.transaction((tx) => convertDeal(tx, { user, actor }, id(), { scenarioId: body.scenarioId ?? undefined, clientId: body.clientId ?? undefined, startDate: body.startDate, endDate: body.endDate }));
  return created({ projectId: p.id, code: p.code });
});
