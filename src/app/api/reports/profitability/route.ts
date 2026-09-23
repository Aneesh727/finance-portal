import { z } from 'zod';
import { route } from '@/lib/api';
import { profitabilityBy } from '@/lib/services/reports';
import { dateStr } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: ['reports.view', 'profit.view'], query: z.object({ group: z.enum(['service', 'client', 'type', 'manager', 'status']).default('service'), from: dateStr.optional(), to: dateStr.optional() }) },
  async ({ query, user }) => profitabilityBy(user, query.group, query));
