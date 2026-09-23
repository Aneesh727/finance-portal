/**
 * Row-level project access.
 *  - users with `projects.viewAll` see every project
 *  - everyone else sees only projects they manage or are a member of
 * Inaccessible projects behave as "not found" (existence is not leaked).
 */
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { db } from './db';
import type { AuthUser } from './auth';
import { projectMembers, projects } from '@/db/schema';
import { forbidden, notFound } from './errors';
import type { Perm } from './permissions';

/** SQL condition limiting a `projects` query (table aliased as `p` in raw SQL) to what the user may see. */
export function projectScopeSql(user: AuthUser, alias = 'p'): SQL {
  if (user.perms.has('projects.viewAll')) return sql`true`;
  const a = sql.raw(alias);
  return sql`(${a}.manager_id = ${user.id} OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = ${a}.id AND pm.user_id = ${user.id}))`;
}

/** drizzle-orm flavour of the same rule, for builder queries on `projects` */
export function projectScope(user: AuthUser): SQL | undefined {
  if (user.perms.has('projects.viewAll')) return undefined;
  return or(
    eq(projects.managerId, user.id),
    sql`EXISTS (SELECT 1 FROM ${projectMembers} pm WHERE pm.project_id = ${projects.id} AND pm.user_id = ${user.id})`,
  );
}

export async function isProjectAccessible(user: AuthUser, projectId: string): Promise<boolean> {
  if (user.perms.has('projects.viewAll')) {
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
    return !!p;
  }
  const [p] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), projectScope(user))).limit(1);
  return !!p;
}

/** Load a project the user may access, optionally requiring a permission. */
export async function getAccessibleProject(user: AuthUser, projectId: string, perm?: Perm) {
  if (perm && !user.perms.has(perm)) throw forbidden();
  const [p] = await db.select().from(projects).where(and(eq(projects.id, projectId), projectScope(user))).limit(1);
  if (!p) throw notFound('Project');
  return p;
}

/** resolve the owning project of a child row and enforce access (404 when inaccessible) */
export async function assertChildAccess(user: AuthUser, table: 'milestones' | 'project_resources' | 'project_adjustments' | 'project_costs' | 'invoices' | 'payments', id: string, perm?: Perm) {
  const t = { milestones: 'milestones', project_resources: 'project_resources', project_adjustments: 'project_adjustments', project_costs: 'project_costs', invoices: 'invoices', payments: 'payments' }[table];
  const r = await db.execute(sql`SELECT project_id FROM ${sql.raw(t)} WHERE id = ${id}::uuid`);
  const pid = (r.rows[0] as { project_id: string } | undefined)?.project_id;
  if (!pid) throw notFound('Record');
  await getAccessibleProject(user, pid, perm);
  return pid;
}
