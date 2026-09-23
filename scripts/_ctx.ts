/** Shared helpers for CLI scripts (seed, daily jobs, demo removal). */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { permissions, rolePermissions, roles, users } from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { ALL_PERMS } from '@/lib/permissions';
import type { Actor } from '@/lib/audit';

export const SYSTEM_ACTOR: Actor = { userId: null, email: 'system@job', ip: 'cli', userAgent: 'cli' };

/** an in-process super-admin context for scripts (never a network principal) */
export function systemUser(over: Partial<AuthUser> = {}): AuthUser {
  return {
    id: over.id ?? '00000000-0000-0000-0000-000000000000', email: over.email ?? 'system@job', name: over.name ?? 'System job', roleId: '', roleKey: 'SUPER_ADMIN', roleName: 'Super Admin',
    perms: new Set(ALL_PERMS), sessionId: 'cli', csrfToken: '', mustChangePw: false, ...over,
  };
}

export async function ctxForUser(userId: string) {
  const [u] = await db.select({ u: users, r: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, userId)).limit(1);
  if (!u) throw new Error('user not found');
  const perms = (await db.select({ k: permissions.key }).from(rolePermissions).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)).where(eq(rolePermissions.roleId, u.r.id))).map((x) => x.k);
  const user = systemUser({ id: u.u.id, email: u.u.email, name: u.u.name, roleId: u.r.id, roleKey: u.r.key, roleName: u.r.name, perms: new Set(perms) });
  return { user, actor: { userId: u.u.id, email: u.u.email, ip: 'cli', userAgent: 'seed' } as Actor };
}

/** jobs need a real user to own generated rows (created_by); use the oldest active Super Admin */
export async function jobContext() {
  const [row] = await db.select({ u: users, r: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(roles.key, 'SUPER_ADMIN')).orderBy(users.createdAt).limit(1);
  if (!row) throw new Error('No Super Admin exists yet. Complete the first-run setup before running jobs.');
  const user = systemUser({ id: row.u.id, email: row.u.email, name: 'Scheduled job', roleId: row.r.id, roleKey: row.r.key, roleName: row.r.name });
  return { user, actor: { ...SYSTEM_ACTOR, userId: null } as Actor };
}
