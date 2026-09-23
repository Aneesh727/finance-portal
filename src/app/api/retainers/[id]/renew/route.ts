import { z } from 'zod';
import { route, created } from '@/lib/api';
import { db } from '@/lib/db';
import { getRetainerDetail, renewRetainer } from '@/lib/services/retainers';
import { dateStr, nonNegMoney, num, optDate, positiveMoney } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

const body = z.object({ monthlyFee: positiveMoney, startDate: optDate, endDate: dateStr, includedHours: num(0, 100000).default(0), overageRate: nonNegMoney.default('0') });

export const POST = route({ perm: 'retainers.manage', body }, async ({ id, body, user, actor }) => {
  const rid = id();
  await getRetainerDetail(user, rid);
  return created(await db.transaction((tx) => renewRetainer(tx, { user, actor }, rid, { ...body, startDate: body.startDate ?? undefined })));
});
