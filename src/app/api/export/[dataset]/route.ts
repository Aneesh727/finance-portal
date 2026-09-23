import { z } from 'zod';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { badRequest } from '@/lib/errors';
import { DATASETS, buildDataset, toCsv, toPdf, toXlsx, type DatasetName } from '@/lib/services/export';
import { getCompany } from '@/lib/settings';
import { dateStr } from '@/lib/schemas';
import { isUuid } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const query = z.object({
  format: z.enum(['csv', 'xlsx', 'pdf']).default('csv'), from: dateStr.optional(), to: dateStr.optional(), q: z.string().max(100).optional(),
  projectId: z.string().optional(), status: z.string().max(30).optional(), group: z.enum(['service', 'client', 'type', 'manager', 'status']).optional(),
});
const TYPES = { csv: 'text/csv; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' } as const;

export const GET = route({ perm: 'reports.export', query, rate: { name: 'export', max: 30, windowSec: 600, by: 'user' } }, async ({ params, query, user, audit }) => {
  const name = params.dataset as DatasetName;
  if (!DATASETS.includes(name)) throw badRequest('Unknown export.');
  if (query.projectId && !isUuid(query.projectId)) throw badRequest('Invalid projectId.');
  const ds = await buildDataset(name, user, query);
  let body: Buffer | string;
  if (query.format === 'csv') body = toCsv(ds);
  else if (query.format === 'xlsx') body = await toXlsx(ds);
  else body = await toPdf(ds, { company: (await getCompany())?.name ?? 'Finance Portal', by: user.name });
  await audit(db, { action: 'export.run', entityType: 'export', entityId: name, summary: `Exported ${ds.title} as ${query.format.toUpperCase()} (${ds.rows.length} rows)` });
  const file = `${name}-${new Date().toISOString().slice(0, 10)}.${query.format}`;
  return new Response(typeof body === 'string' ? body : new Uint8Array(body), {
    headers: { 'Content-Type': TYPES[query.format], 'Content-Disposition': `attachment; filename="${file}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Row-Count': String(ds.rows.length) },
  });
});
