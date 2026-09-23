import { z } from 'zod';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { route, created, listQuery, likePattern, reply } from '@/lib/api';
import { db } from '@/lib/db';
import { roles, users, projects } from '@/db/schema';
import { hashPassword, validatePasswordStrength } from '@/lib/auth';
import { orderBy, pageMeta } from '@/lib/crud';
import { conflict, forbidden, unprocessable } from '@/lib/errors';
import { reqText, uuid } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

const query = listQuery.extend({ active: z.enum(['0', '1', 'all']).default('all'), lookup: z.enum(['1']).optional() });

const publicUser = { id: users.id, name: users.name, email: users.email, active: users.active, roleId: users.roleId, roleName: roles.name, roleKey: roles.key, lastLoginAt: users.lastLoginAt, lockedUntil: users.lockedUntil, mustChangePw: users.mustChangePw, createdAt: users.createdAt };

/** users.manage sees the full list; anyone with project rights gets a slim id/name lookup (for manager / owner pickers) */
export const GET = route({ anyPerm: ['users.manage', 'projects.create', 'projects.edit'], query }, async ({ query, user }) => {
  const full = user.perms.has('users.manage');
  const conds = [
    query.active === 'all' && full ? undefined : query.active === '0' && full ? eq(users.active, false) : eq(users.active, true),
    query.q ? or(ilike(users.name, likePattern(query.q)), ilike(users.email, likePattern(query.q))) : undefined,
  ].filter(Boolean) as never[];
  const where = conds.length ? and(...conds) : undefined;
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(users).where(where)) as { n: number }[];
  const rows = await db.select(publicUser).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(where)
    .orderBy(...orderBy({ id: users.id, name: users.name, email: users.email, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt }, query.sort, query.dir, 'name'))
    .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
  return reply(full ? rows : rows.map((r) => ({ id: r.id, name: r.name })), { meta: pageMeta(query.page, query.pageSize, n) });
});

const body = z.object({
  name: reqText(100),
  email: z.string().trim().toLowerCase().email().max(200),
  roleId: uuid,
  password: z.string().min(1).max(200),
  mustChangePw: z.boolean().default(true),
});

export const POST = route({ perm: 'users.manage', body }, async ({ body, user, audit }) => {
  const weak = validatePasswordStrength(body.password);
  if (weak) throw unprocessable(weak, { fields: { password: weak } });
  const [role] = await db.select().from(roles).where(eq(roles.id, body.roleId)).limit(1);
  if (!role) throw unprocessable('That role does not exist.', { fields: { roleId: 'Not found' } });
  // privilege-escalation guard: only a Super Admin may create another Super Admin
  if (role.key === 'SUPER_ADMIN' && user.roleKey !== 'SUPER_ADMIN') throw forbidden('Only a Super Admin can create another Super Admin.');
  const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
  if (dup) throw conflict('A user with this email already exists.', 'DUPLICATE_EMAIL', { fields: { email: 'Already in use' } });
  const hash = await hashPassword(body.password);
  const row = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ name: body.name, email: body.email, roleId: body.roleId, passwordHash: hash, mustChangePw: body.mustChangePw }).returning({ id: users.id, email: users.email, name: users.name });
    await audit(tx, { action: 'user.create', entityType: 'user', entityId: u.id, summary: `Created user ${u.email} with role ${role.name}`, new: { email: u.email, role: role.name } });
    return u;
  });
  return created(row);
});
void projects;
