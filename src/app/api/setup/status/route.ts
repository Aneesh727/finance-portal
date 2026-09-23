import { route } from '@/lib/api';
import { getCompany } from '@/lib/settings';
import { db } from '@/lib/db';
import { users } from '@/db/schema';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export const GET = route({ public: true }, async () => {
  const c = await getCompany();
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(users)) as { n: number }[];
  return { needsSetup: !c?.setupComplete && n === 0, hasUsers: n > 0 };
});
