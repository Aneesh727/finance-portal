import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { projectPatch } from '@/lib/validators';
import { getAccessibleProject } from '@/lib/access';
import { getProjectDetail, updateProject } from '@/lib/services/projects';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'projects.view' }, async ({ id, user }) => {
  await getAccessibleProject(user, id());
  return getProjectDetail(user, id());
});

export const PATCH = route({ perm: 'projects.edit', body: projectPatch }, async ({ id, body, user, actor }) => {
  const pid = id();
  await getAccessibleProject(user, pid, 'projects.edit');
  const res = await db.transaction((tx) => updateProject(tx, { user, actor }, pid, body));
  return { id: pid, version: res.project.version, pendingApproval: res.pendingApproval };
});
