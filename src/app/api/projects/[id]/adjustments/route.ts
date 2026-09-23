import { route, created } from '@/lib/api';
import { db } from '@/lib/db';
import { getAccessibleProject } from '@/lib/access';
import { addAdjustment, adjustmentBody } from '@/lib/services/project-parts';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: ['payments.manage', 'profit.view'], body: adjustmentBody }, async ({ id, body, user, actor }) => {
  const pid = id();
  await getAccessibleProject(user, pid);
  return created(await db.transaction((tx) => addAdjustment(tx, { user, actor }, pid, body)));
});
