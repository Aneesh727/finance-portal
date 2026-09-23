import { z } from 'zod';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { assertChildAccess } from '@/lib/access';
import { convertCommitted } from '@/lib/services/costs';
import { dateStr, optText, positiveMoney } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: 'costs.approve', body: z.object({ date: dateStr, amount: positiveMoney.optional(), notes: optText(300), overrideBudget: z.boolean().default(false), overrideReason: optText(500) }) }, async ({ id, body, user, actor }) => {
  const cid = id();
  await assertChildAccess(user, 'project_costs', cid);
  return db.transaction((tx) => convertCommitted(tx, { user, actor }, cid, body.date, body.amount, { overrideBudget: body.overrideBudget, overrideReason: body.overrideReason ?? undefined }));
});
