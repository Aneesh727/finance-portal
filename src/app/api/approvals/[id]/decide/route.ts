import { z } from 'zod';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { decideApproval } from '@/lib/services/approvals';
import { optText } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: 'approvals.decide', body: z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: optText(500) }) }, async ({ id, body, user, actor }) => {
  const a = await db.transaction((tx) => decideApproval(tx, { user, actor }, id(), body.decision, body.note));
  return { id: a.id, status: a.status };
});
