import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { route } from '@/lib/api';
import { hashPassword, revokeAllSessions, validatePasswordStrength, verifyPassword } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/db/schema';
import { ApiError, unprocessable } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const body = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });

export const POST = route({ body, allowMustChangePw: true, rate: { name: 'chpw', max: 10, windowSec: 900, by: 'user' } }, async ({ user, body, audit }) => {
  const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!row || !(await verifyPassword(body.currentPassword, row.passwordHash))) throw new ApiError(400, 'WRONG_PASSWORD', 'Your current password is incorrect.');
  const weak = validatePasswordStrength(body.newPassword);
  if (weak) throw unprocessable(weak);
  if (body.newPassword === body.currentPassword) throw unprocessable('Choose a password different from the current one.');
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: await hashPassword(body.newPassword), mustChangePw: false }).where(eq(users.id, user.id));
    await audit(tx, { action: 'auth.password_changed', entityType: 'user', entityId: user.id, summary: `${user.email} changed their password` });
  });
  await revokeAllSessions(user.id, user.sessionId);
  return { ok: true };
});
