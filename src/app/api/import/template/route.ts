import { z } from 'zod';
import { route } from '@/lib/api';
import { IMPORT_KINDS } from '@/db/schema';
import { templateCsv } from '@/lib/services/import';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'import.run', query: z.object({ kind: z.enum(IMPORT_KINDS) }) }, async ({ query }) =>
  new Response(templateCsv(query.kind), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${query.kind.toLowerCase()}-template.csv"`, 'Cache-Control': 'no-store' } }));
