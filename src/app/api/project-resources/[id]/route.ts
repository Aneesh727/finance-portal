import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { assertChildAccess } from '@/lib/access';
import { assignmentPatch, removeAssignment, updateAssignment } from '@/lib/services/project-parts';

export const dynamic = 'force-dynamic';

export const PATCH = route({ perm: 'projects.edit', body: assignmentPatch }, async ({ id, body, user, actor }) => {
  const rid = id();
  await assertChildAccess(user, 'project_resources', rid, 'projects.edit');
  return db.transaction((tx) => updateAssignment(tx, { user, actor }, rid, body));
});

export const DELETE = route({ perm: 'projects.edit' }, async ({ id, user, actor }) => {
  const rid = id();
  await assertChildAccess(user, 'project_resources', rid, 'projects.edit');
  await db.transaction((tx) => removeAssignment(tx, { user, actor }, rid));
  return { id: rid, deleted: true };
});
