import { z } from 'zod';
import { route } from '@/lib/api';
import { receivablesReport } from '@/lib/services/reports';
import { dateStr } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: ['reports.view', 'payments.view'], query: z.object({ asOf: dateStr.optional() }) }, async ({ query, user }) => receivablesReport(user, query.asOf));
