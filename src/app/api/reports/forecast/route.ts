import { z } from 'zod';
import { route } from '@/lib/api';
import { forecast } from '@/lib/services/reports';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: ['forecast.view', 'profit.view', 'costs.view'], query: z.object({ months: z.coerce.number().int().min(1).max(24).optional() }) }, async ({ query, user }) => forecast(user, query.months));
