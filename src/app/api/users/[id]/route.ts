import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { roles, users, projects, projectMembers } from '@/db/schema';
import { revokeAllSessions } from '@/lib/auth';
import { conflict, forbidden, notFound, unprocessable } from '@/lib/errors';
import { reqText, uuid } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const GET = route({ perm: 'users.manage' }, async ({ id }) => {
  const uid = id();
  const [u] = await db.select({ id: users.id, name: users.name, email: users.email, active: users.active, roleId: users.roleId, roleName: roles.name, roleKey: roles.key, lastLoginAt: users.lastLoginAt, lockedUntil: users.lockedUntil, failedLogins: users.failedLogins, mustChangePw: users.mustChangePw, createdAt: users.createdAt })
    .from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, uid)).limit(1);
  if (!u) throw notFound('User');
  const assigned = await db.select({ id: projects.id, name: projects.name, code: projects.code }).from(projectMembers).innerJoin(projects, eq(projects.id, projectMembers.projectId)).where(eq(projectMembers.userId, uid));
  return { user: u, projects: assigned };
});

const patch = z.object({ name: reqText(100).optional(), roleId: uuid.optional(), active: z.boolean().optional(), unlock: z.boolean().optional() });

async function activeSuperAdmins(tx: typeof db, exceptId: string) {
  const [{ n }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = 'SUPER_ADMIN' AND u.active AND u.id <> ${exceptId}::uuid`)).rows as { n: number }[];
  return n;
}

export const PATCH = route({ perm: 'users.manage', body: patch }, async ({ id, body, user, audit }) => {
  const uid = id();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(834722)`);
    const [old] = await tx.select({ u: users, roleKey: roles.key }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, uid)).limit(1);
    if (!old) throw notFound('User');
    const set: Record<string, unknown> = {};
    if (old.roleKey === 'SUPER_ADMIN' && user.roleKey !== 'SUPER_ADMIN') throw forbidden('Only a Super Admin can change a Super Admin.');
    if (body.name !== undefined) set.name = body.name;
    let newRole: typeof roles.$inferSelect | undefined;
    if (body.roleId && body.roleId !== old.u.roleId) {
      [newRole] = await tx.select().from(roles).where(eq(roles.id, body.roleId)).limit(1);
      if (!newRole) throw unprocessable('That role does not exist.', { fields: { roleId: 'Not found' } });
      if (newRole.key === 'SUPER_ADMIN' && user.roleKey !== 'SUPER_ADMIN') throw forbidden('Only a Super Admin can grant the Super Admin role.');
      if (uid === user.id) throw forbidden('You cannot change your own role.');
      set.roleId = body.roleId;
    }
    if (body.active !== undefined && body.active !== old.u.active) {
      if (uid === user.id && !body.active) throw forbidden('You cannot deactivate your own account.');
      set.active = body.active;
    }
    const losesSuper = old.roleKey === 'SUPER_ADMIN' && ((newRole && newRole.key !== 'SUPER_ADMIN') || set.active === false);
    if (losesSuper && (await activeSuperAdmins(tx as never, uid)) === 0) throw conflict('This is the last active Super Admin. Create or promote another one first.', 'LAST_SUPER_ADMIN');
    if (body.unlock) Object.assign(set, { failedLogins: 0, lockedUntil: null });
    if (!Object.keys(set).length) return { id: uid };
    await tx.update(users).set({ ...set, updatedAt: new Date() }).where(eq(users.id, uid));
    const parts = [set.name !== undefined && 'name', newRole && `role → ${newRole.name}`, set.active !== undefined && (set.active ? 'activated' : 'deactivated'), body.unlock && 'unlocked'].filter(Boolean);
    await audit(tx, { action: 'user.update', entityType: 'user', entityId: uid, summary: `Updated user ${old.u.email}: ${parts.join(', ')}`, old: { name: old.u.name, roleId: old.u.roleId, active: old.u.active }, new: set });
    if (newRole || set.active === false) await revokeAllSessions(uid); // permissions changed or access removed: force re-login
    return { id: uid };
  });
});
void and;
