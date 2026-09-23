import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { assertChildAccess } from '@/lib/access';
import { removeAdjustment } from '@/lib/services/project-parts';

export const dynamic = 'force-dynamic';

export const DELETE = route({ perm: ['payments.manage', 'profit.view'] }, async ({ id, user, actor }) => {
  const aid = id();
  await assertChildAccess(user, 'project_adjustments', aid);
  await db.transaction((tx) => removeAdjustment(tx, { user, actor }, aid));
  return { id: aid, deleted: true };
});
