import { z } from 'zod';
import { route, isUuid } from '@/lib/api';
import { IMPORT_KINDS } from '@/db/schema';
import { badRequest, forbidden } from '@/lib/errors';
import { commitImport } from '@/lib/services/import';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NEED: Record<string, 'clients.manage' | 'resources.manage' | 'projects.create' | 'expenses.create' | 'costs.create'> = { CLIENTS: 'clients.manage', RESOURCES: 'resources.manage', PROJECTS: 'projects.create', EXPENSES: 'expenses.create', COSTS: 'costs.create' };

export const POST = route({ perm: 'import.run', raw: true, rate: { name: 'import', max: 20, windowSec: 600, by: 'user' } }, async ({ req, user, actor }) => {
  if (Number(req.headers.get('content-length') ?? '0') > env().MAX_UPLOAD_MB * 1024 * 1024 + 512 * 1024) throw badRequest('File is too large.', undefined, 'FILE_TOO_LARGE');
  let form: FormData;
  try { form = await req.formData(); } catch { throw badRequest('Send the file as multipart/form-data.'); }
  const kind = z.enum(IMPORT_KINDS).safeParse(form.get('kind'));
  const file = form.get('file');
  const batchId = String(form.get('batchId') ?? '');
  if (!kind.success || !(file instanceof File) || !isUuid(batchId)) throw badRequest('Missing kind, file or batchId.');
  if (!user.perms.has(NEED[kind.data])) throw forbidden();
  return commitImport(user, actor, kind.data, batchId, Buffer.from(await file.arrayBuffer()), file.name, { skipInvalid: form.get('skipInvalid') === 'true', allowReimport: form.get('allowReimport') === 'true' });
});
