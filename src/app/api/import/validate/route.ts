import { z } from 'zod';
import { route } from '@/lib/api';
import { IMPORT_KINDS } from '@/db/schema';
import { badRequest, forbidden } from '@/lib/errors';
import { validateImport } from '@/lib/services/import';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NEED: Record<string, 'clients.manage' | 'resources.manage' | 'projects.create' | 'expenses.create' | 'costs.create'> = { CLIENTS: 'clients.manage', RESOURCES: 'resources.manage', PROJECTS: 'projects.create', EXPENSES: 'expenses.create', COSTS: 'costs.create' };

export const POST = route({ perm: 'import.run', raw: true, rate: { name: 'import', max: 20, windowSec: 600, by: 'user' } }, async ({ req, user }) => {
  if (Number(req.headers.get('content-length') ?? '0') > env().MAX_UPLOAD_MB * 1024 * 1024 + 512 * 1024) throw badRequest('File is too large.', undefined, 'FILE_TOO_LARGE');
  let form: FormData;
  try { form = await req.formData(); } catch { throw badRequest('Send the file as multipart/form-data.'); }
  const kind = z.enum(IMPORT_KINDS).safeParse(form.get('kind'));
  const file = form.get('file');
  if (!kind.success) throw badRequest('Choose what you are importing.');
  if (!(file instanceof File)) throw badRequest('Choose a file.');
  if (!user.perms.has(NEED[kind.data])) throw forbidden();
  return validateImport(user, kind.data, Buffer.from(await file.arrayBuffer()), file.name);
});
