import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { route, created } from '@/lib/api';
import { db } from '@/lib/db';
import { projects } from '@/db/schema';
import { getAccessibleProject } from '@/lib/access';
import { scheduleItemInput } from '@/lib/validators';
import { generateSchedule } from '@/lib/services/billing';
import { loadOne } from '@/lib/finance/loaders';
import { notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** Create SCHEDULED invoices (e.g. 30% advance / 40% milestone / 30% final) from a payment plan */
export const POST = route({ perm: 'payments.manage', body: z.object({ items: z.array(scheduleItemInput).min(1).max(60) }) }, async ({ id, body, user, actor }) => {
  const pid = id();
  await getAccessibleProject(user, pid);
  return created(await db.transaction(async (tx) => {
    const [p] = await tx.select().from(projects).where(eq(projects.id, pid)).limit(1);
    if (!p) throw notFound('Project');
    const fin = await loadOne(pid, { exec: tx });
    const invs = await generateSchedule(tx, actor, p, fin?.f.revenue.contractValue ?? 0, body.items.map((s) => ({ type: s.type, label: s.label, pct: s.pct, amount: s.amount, dueDate: s.dueDate })));
    return invs.map((i) => ({ id: i.id, number: i.number, total: i.total, dueDate: i.dueDate }));
  }));
});
