import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { route, created, isUuid } from '@/lib/api';
import { db } from '@/lib/db';
import { attachments, ATTACHMENT_ENTITIES, users } from '@/db/schema';
import { env } from '@/lib/env';
import { badRequest } from '@/lib/errors';
import { saveFile } from '@/lib/storage';
import { authorizeEntity } from '@/lib/services/attachments';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const query = z.object({ entityType: z.enum(ATTACHMENT_ENTITIES), entityId: z.string() });

export const GET = route({ query }, async ({ query, user }) => {
  if (!isUuid(query.entityId)) throw badRequest('Invalid entityId.');
  await authorizeEntity(user, query.entityType, query.entityId, 'view');
  const rows = await db.select({ a: attachments, by: users.name }).from(attachments).leftJoin(users, eq(users.id, attachments.uploadedById))
    .where(and(eq(attachments.entityType, query.entityType), eq(attachments.entityId, query.entityId), sql`${attachments.archivedAt} is null`)).orderBy(desc(attachments.createdAt));
  return rows.map((r) => ({ id: r.a.id, fileName: r.a.fileName, mimeType: r.a.mimeType, sizeBytes: r.a.sizeBytes, label: r.a.label, uploadedBy: r.by, createdAt: r.a.createdAt }));
});

export const POST = route({ raw: true, rate: { name: 'upload', max: 60, windowSec: 600, by: 'user' } }, async ({ req, user, audit }) => {
  const max = env().MAX_UPLOAD_MB * 1024 * 1024;
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > max + 512 * 1024) throw badRequest(`File is too large. The limit is ${env().MAX_UPLOAD_MB} MB.`, undefined, 'FILE_TOO_LARGE');
  let form: FormData;
  try { form = await req.formData(); } catch { throw badRequest('Send the file as multipart/form-data.'); }
  const file = form.get('file');
  const entityType = z.enum(ATTACHMENT_ENTITIES).safeParse(form.get('entityType'));
  const entityId = String(form.get('entityId') ?? '');
  if (!(file instanceof File)) throw badRequest('Choose a file to upload.');
  if (!entityType.success || !isUuid(entityId)) throw badRequest('Missing or invalid entityType / entityId.');
  const label = String(form.get('label') ?? '').slice(0, 120) || null;
  const projectId = await authorizeEntity(user, entityType.data, entityId, 'write');
  const buf = Buffer.from(await file.arrayBuffer());
  const stored = await saveFile(file.name, buf); // validates size, extension, magic bytes
  const row = await db.transaction(async (tx) => {
    const [a] = await tx.insert(attachments).values({ entityType: entityType.data, entityId, projectId, fileName: stored.fileName, storageKey: stored.storageKey, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, sha256: stored.sha256, label, uploadedById: user.id }).returning();
    await audit(tx, { action: 'attachment.upload', entityType: 'attachment', entityId: a.id, projectId, summary: `Uploaded ${a.fileName} (${(a.sizeBytes / 1024).toFixed(0)} KB) to ${entityType.data.toLowerCase()}`, new: { fileName: a.fileName, sizeBytes: a.sizeBytes, sha256: a.sha256 } });
    return a;
  });
  return created({ id: row.id, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes });
});
