import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { getAccessibleProject } from '@/lib/access';
import { setArchived } from '@/lib/services/projects';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: 'projects.archive' }, async ({ id, user, actor }) => {
  const pid = id();
  await getAccessibleProject(user, pid);
  const p = await db.transaction((tx) => setArchived(tx, { user, actor }, pid, false));
  return { id: p.id, archived: !!p.archivedAt };
});
