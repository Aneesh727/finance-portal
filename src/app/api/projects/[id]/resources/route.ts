import { route, created } from '@/lib/api';
import { db } from '@/lib/db';
import { getAccessibleProject } from '@/lib/access';
import { assignResource, assignmentBody } from '@/lib/services/project-parts';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: ['projects.edit', 'resources.view'], body: assignmentBody }, async ({ id, body, user, actor }) => {
  const pid = id();
  await getAccessibleProject(user, pid, 'projects.edit');
  return created(await db.transaction((tx) => assignResource(tx, { user, actor }, pid, body)));
});
