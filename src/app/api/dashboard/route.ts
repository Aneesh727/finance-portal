import { z } from 'zod';
import { route } from '@/lib/api';
import { getDashboard } from '@/lib/services/dashboard';
import { dateStr } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'dashboard.view', query: z.object({ from: dateStr.optional(), to: dateStr.optional() }) }, async ({ query, user }) => getDashboard(user, query));
