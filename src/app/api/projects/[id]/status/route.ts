import { z } from 'zod';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { PROJECT_STATUSES } from '@/db/schema';
import { getAccessibleProject } from '@/lib/access';
import { changeStatus } from '@/lib/services/projects';
import { optText } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

const body = z.object({ status: z.enum(PROJECT_STATUSES), reason: optText(500) });

export const POST = route({ perm: 'projects.edit', body }, async ({ id, body, user, actor }) => {
  const pid = id();
  await getAccessibleProject(user, pid, 'projects.edit');
  if (body.status === 'CANCELLED' && !user.perms.has('projects.archive') && !user.perms.has('approvals.decide')) {
    // ordinary editors may REQUEST a cancellation; it is routed through approval below
  }
  const res = await db.transaction((tx) => changeStatus(tx, { user, actor }, pid, body.status, body.reason));
  return { id: pid, status: res.project.status, pendingApproval: res.pendingApproval };
});
