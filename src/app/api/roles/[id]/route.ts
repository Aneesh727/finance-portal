import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { permissions, rolePermissions, roles } from '@/db/schema';
import { ALL_PERMS } from '@/lib/permissions';
import { invalidateRoleCache, revokeAllSessions } from '@/lib/auth';
import { conflict, forbidden, notFound } from '@/lib/errors';
import { optText, reqText } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

const patch = z.object({ name: reqText(60).optional(), description: optText(200).optional(), perms: z.array(z.enum(ALL_PERMS as [string, ...string[]])).max(100).optional() });

export const PATCH = route({ perm: 'roles.manage', body: patch }, async ({ id, body, audit }) => {
  const rid = id();
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(roles).where(eq(roles.id, rid)).limit(1);
    if (!r) throw notFound('Role');
    if (r.key === 'SUPER_ADMIN') throw forbidden('The Super Admin role cannot be changed.');
    const set: Record<string, unknown> = {};
    if (body.name !== undefined) set.name = body.name;
    if (body.description !== undefined) set.description = body.description;
    if (Object.keys(set).length) await tx.update(roles).set(set).where(eq(roles.id, rid));
    if (body.perms) {
      const all = await tx.select().from(permissions);
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, rid));
      const wanted = all.filter((p) => body.perms!.includes(p.key));
      if (wanted.length) await tx.insert(rolePermissions).values(wanted.map((p) => ({ roleId: rid, permissionId: p.id })));
    }
    await audit(tx, { action: 'role.update', entityType: 'role', entityId: rid, summary: `Updated role ${r.name}${body.perms ? ` (${body.perms.length} permissions)` : ''}`, new: body });
  });
  invalidateRoleCache();
  return { id: rid };
});

export const DELETE = route({ perm: 'roles.manage' }, async ({ id, audit }) => {
  const rid = id();
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(roles).where(eq(roles.id, rid)).limit(1);
    if (!r) throw notFound('Role');
    if (r.isSystem) throw forbidden('System roles cannot be deleted.');
    const [{ n }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM users WHERE role_id = ${rid}::uuid`)).rows as { n: number }[];
    if (n > 0) throw conflict(`${n} user(s) still have this role. Move them to another role first.`, 'ROLE_IN_USE');
    await tx.delete(roles).where(eq(roles.id, rid));
    await audit(tx, { action: 'role.delete', entityType: 'role', entityId: rid, summary: `Deleted role ${r.name}` });
  });
  invalidateRoleCache();
  return { id: rid, deleted: true };
});
void revokeAllSessions;
