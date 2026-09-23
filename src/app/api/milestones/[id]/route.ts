import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { assertChildAccess } from '@/lib/access';
import { deleteMilestone, milestonePatch, updateMilestone } from '@/lib/services/project-parts';

export const dynamic = 'force-dynamic';

export const PATCH = route({ perm: 'projects.edit', body: milestonePatch }, async ({ id, body, user, actor }) => {
  const mid = id();
  await assertChildAccess(user, 'milestones', mid, 'projects.edit');
  return db.transaction((tx) => updateMilestone(tx, { user, actor }, mid, body));
});

export const DELETE = route({ perm: 'projects.edit' }, async ({ id, user, actor }) => {
  const mid = id();
  await assertChildAccess(user, 'milestones', mid, 'projects.edit');
  await db.transaction((tx) => deleteMilestone(tx, { user, actor }, mid));
  return { id: mid, deleted: true };
});
