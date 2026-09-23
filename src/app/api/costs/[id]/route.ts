import { eq } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { projectCosts } from '@/db/schema';
import { assertChildAccess } from '@/lib/access';
import { costPatch } from '@/lib/validators';
import { updateCost } from '@/lib/services/costs';
import { notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'costs.view' }, async ({ id, user }) => {
  const cid = id();
  await assertChildAccess(user, 'project_costs', cid);
  const [c] = await db.select().from(projectCosts).where(eq(projectCosts.id, cid)).limit(1);
  if (!c) throw notFound('Cost');
  return c;
});

export const PATCH = route({ perm: 'costs.create', body: costPatch }, async ({ id, body, user, actor }) => {
  const cid = id();
  await assertChildAccess(user, 'project_costs', cid);
  return db.transaction((tx) => updateCost(tx, { user, actor }, cid, body));
});
