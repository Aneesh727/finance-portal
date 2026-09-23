import { z } from 'zod';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { generateForRule } from '@/lib/services/recurring-expenses';
import { optDate } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/** generate every due occurrence up to today (or `asOf`). Idempotent. */
export const POST = route({ perm: 'expenses.create', body: z.object({ asOf: optDate }) }, async ({ id, body, user, actor }) =>
  db.transaction((tx) => generateForRule(tx, { user, actor }, id(), body.asOf ?? undefined)));
