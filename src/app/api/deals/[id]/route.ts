import { z } from 'zod';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { dealBody } from '@/lib/validators';
import { getDeal, updateDeal } from '@/lib/services/deals';
import { optUuid } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'deals.view' }, async ({ id }) => getDeal(id()));

export const PATCH = route({ perm: 'deals.manage', body: dealBody.partial().extend({ selectedScenarioId: optUuid }) }, async ({ id, body, user, actor }) => {
  await db.transaction((tx) => updateDeal(tx, { user, actor }, id(), body as never));
  return getDeal(id());
});
void z;
