import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { route, created } from '@/lib/api';
import { db } from '@/lib/db';
import { permissions, rolePermissions, roles } from '@/db/schema';
import { ALL_PERMS } from '@/lib/permissions';
import { conflict } from '@/lib/errors';
import { optText, reqText } from '@/lib/schemas';
import { slugify } from '@/lib/base-data';

export const dynamic = 'force-dynamic';

export const GET = route({ anyPerm: ['roles.manage', 'users.manage'] }, async () => {
  const rows = await db.execute(sql`
    SELECT r.id, r.key, r.name, r.description, r.is_system AS "isSystem",
      COALESCE((SELECT array_agg(p.key ORDER BY p.key) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id), '{}') AS perms,
      (SELECT count(*)::int FROM users u WHERE u.role_id = r.id) AS "userCount"
    FROM roles r ORDER BY r.is_system DESC, r.name`);
  return rows.rows;
});

const body = z.object({ name: reqText(60), description: optText(200), perms: z.array(z.enum(ALL_PERMS as [string, ...string[]])).max(100) });

export const POST = route({ perm: 'roles.manage', body }, async ({ body, audit }) => {
  const key = `CUSTOM_${slugify(body.name).toUpperCase().replace(/-/g, '_')}`;
  const [dup] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)).limit(1);
  if (dup) throw conflict('A role with this name already exists.', 'DUPLICATE_NAME');
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(roles).values({ key, name: body.name, description: body.description, isSystem: false }).returning();
    const perms = await tx.select().from(permissions);
    const wanted = perms.filter((p) => body.perms.includes(p.key));
    if (wanted.length) await tx.insert(rolePermissions).values(wanted.map((p) => ({ roleId: r.id, permissionId: p.id })));
    await audit(tx, { action: 'role.create', entityType: 'role', entityId: r.id, summary: `Created role ${r.name} with ${wanted.length} permissions`, new: { perms: body.perms } });
    return r;
  });
  return created(row);
});
