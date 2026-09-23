import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { expenseAllocationBody } from '@/lib/validators';
import { setAllocations } from '@/lib/services/expenses';

export const dynamic = 'force-dynamic';

export const PUT = route({ perm: 'allocations.manage', body: expenseAllocationBody }, async ({ id, body, user, actor }) => {
  return db.transaction((tx) => setAllocations(tx, { user, actor }, id(), body.rows));
});
