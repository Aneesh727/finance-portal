import { z } from 'zod';
import { route } from '@/lib/api';
import { companyPnl } from '@/lib/services/reports';
import { dateStr } from '@/lib/schemas';
import { addMonths, monthStart, todayStr } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: ['reports.view', 'profit.view', 'costs.view', 'expenses.view'], query: z.object({ from: dateStr.optional(), to: dateStr.optional() }) }, async ({ query, user }) =>
  companyPnl(user, query.from ?? addMonths(monthStart(todayStr()), -11), query.to ?? todayStr()));
