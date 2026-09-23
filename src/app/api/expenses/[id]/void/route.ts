import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { expenses } from '@/db/schema';
import { isProjectAccessible } from '@/lib/access';
import { voidExpense } from '@/lib/services/expenses';
import { notFound } from '@/lib/errors';
import { reqText } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: 'expenses.create', body: z.object({ reason: reqText(300) }) }, async ({ id, body, user, actor }) => {
  const eid = id();
  const [e] = await db.select().from(expenses).where(eq(expenses.id, eid)).limit(1);
  if (!e || (e.projectId && !(await isProjectAccessible(user, e.projectId)))) throw notFound('Expense');
  const row = await db.transaction((tx) => voidExpense(tx, { user, actor }, eid, body.reason));
  return { id: eid, voided: true, version: row.version };
});
