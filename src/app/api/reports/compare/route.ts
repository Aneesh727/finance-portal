import { z } from 'zod';
import { route, uuidSchema } from '@/lib/api';
import { compareProjects } from '@/lib/services/reports';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'reports.view', query: z.object({ ids: z.string().max(400) }) }, async ({ query, user }) => {
  const ids = [...new Set(query.ids.split(',').map((s) => s.trim()).filter(Boolean))];
  return compareProjects(user, ids.map((i) => uuidSchema.parse(i)));
});
