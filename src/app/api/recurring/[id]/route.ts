import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { recurringBody } from '@/lib/validators';
import { updateRule } from '@/lib/services/recurring-expenses';

export const dynamic = 'force-dynamic';

export const PATCH = route({ perm: 'expenses.edit', body: recurringBody.partial() }, async ({ id, body, user, actor }) => db.transaction((tx) => updateRule(tx, { user, actor }, id(), body)));
