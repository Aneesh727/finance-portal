import { eq } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { attachments } from '@/db/schema';
import { readFile } from '@/lib/storage';
import { authorizeEntity, loadAttachment } from '@/lib/services/attachments';
import { notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** authorised download: forced attachment, nosniff, never inline */
export const GET = route({}, async ({ id, user, audit }) => {
  const a = await loadAttachment(id());
  await authorizeEntity(user, a.entityType, a.entityId, 'view');
  let data: Buffer;
  try { data = await readFile(a.storageKey); } catch { throw notFound('File'); }
  await audit(db, { action: 'attachment.download', entityType: 'attachment', entityId: a.id, projectId: a.projectId, summary: `Downloaded ${a.fileName}` });
  const safeName = a.fileName.replace(/[^\w.\- ()]/g, '_');
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': a.mimeType, 'Content-Length': String(data.length), 'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
});

export const DELETE = route({}, async ({ id, user, audit }) => {
  const a = await loadAttachment(id());
  await authorizeEntity(user, a.entityType, a.entityId, 'write');
  await db.transaction(async (tx) => {
    await tx.update(attachments).set({ archivedAt: new Date() }).where(eq(attachments.id, a.id));
    await audit(tx, { action: 'attachment.delete', entityType: 'attachment', entityId: a.id, projectId: a.projectId, summary: `Removed ${a.fileName}` });
  });
  return { id: a.id, deleted: true };
});
