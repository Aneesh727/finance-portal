import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { roles, users } from '@/db/schema';
import { hashPassword, revokeAllSessions, validatePasswordStrength } from '@/lib/auth';
import { forbidden, notFound, unprocessable } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export const POST = route({ perm: 'users.manage', body: z.object({ password: z.string().min(1).max(200) }), rate: { name: 'pwreset', max: 20, windowSec: 3600, by: 'user' } }, async ({ id, body, user, audit }) => {
  const uid = id();
  const weak = validatePasswordStrength(body.password);
  if (weak) throw unprocessable(weak, { fields: { password: weak } });
  const [u] = await db.select({ u: users, roleKey: roles.key }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, uid)).limit(1);
  if (!u) throw notFound('User');
  if (u.roleKey === 'SUPER_ADMIN' && user.roleKey !== 'SUPER_ADMIN') throw forbidden('Only a Super Admin can reset a Super Admin password.');
  const hash = await hashPassword(body.password);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: hash, mustChangePw: true, failedLogins: 0, lockedUntil: null }).where(eq(users.id, uid));
    await audit(tx, { action: 'user.password_reset', entityType: 'user', entityId: uid, summary: `Reset password for ${u.u.email} (must change at next login)` });
  });
  await revokeAllSessions(uid);
  return { ok: true };
});
