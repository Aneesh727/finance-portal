import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { cancelApproval } from '@/lib/services/approvals';

export const dynamic = 'force-dynamic';

export const POST = route({}, async ({ id, user, actor }) => {
  const a = await db.transaction((tx) => cancelApproval(tx, { user, actor }, id()));
  return { id: a.id, status: a.status };
});
