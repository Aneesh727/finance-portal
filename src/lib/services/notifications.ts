import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '@/lib/db';
import { notifications, permissions, rolePermissions, users } from '@/db/schema';
import { getSettings, type NotificationType } from '@/lib/settings';
import type { Perm } from '@/lib/permissions';

export interface NotifyArgs {
  type: NotificationType;
  severity?: 'info' | 'warning' | 'critical';
  title: string;
  body?: string;
  link?: string;
  /** stable key: the same condition never notifies the same user twice */
  dedupeKey?: string;
  /** everyone whose role has this permission */
  permission?: Perm;
  /** explicit users (in addition to permission holders) */
  userIds?: string[];
  /** every recipient must hold this permission (so a notification never carries figures the user cannot otherwise see) */
  requirePerm?: Perm;
}

/** Insert notifications for the audience. Honors admin toggles and per-user muted types. Returns how many were created. */
export async function notify(exec: Executor, a: NotifyArgs): Promise<number> {
  const s = await getSettings(exec);
  if (s.notifications.enabled[a.type] === false) return 0;
  const ids = new Set<string>(a.userIds ?? []);
  if (a.permission) {
    const rows = await exec
      .selectDistinct({ id: users.id })
      .from(users)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, users.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(permissions.key, a.permission), eq(users.active, true)));
    rows.forEach((r) => ids.add(r.id));
  }
  if (a.requirePerm && ids.size) {
    const ok = await exec
      .selectDistinct({ id: users.id })
      .from(users)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, users.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(permissions.key, a.requirePerm), inArray(users.id, [...ids])));
    const allowed = new Set(ok.map((r) => r.id));
    for (const id of [...ids]) if (!allowed.has(id)) ids.delete(id);
  }
  if (!ids.size) return 0;
  const recips = await exec.select({ id: users.id, prefs: users.notifyPrefs }).from(users).where(and(inArray(users.id, [...ids]), eq(users.active, true)));
  const values = recips
    .filter((u) => !((u.prefs as { muted?: string[] } | null)?.muted ?? []).includes(a.type))
    .map((u) => ({ userId: u.id, type: a.type, severity: a.severity ?? 'info', title: a.title, body: a.body ?? null, link: a.link ?? null, dedupeKey: a.dedupeKey ?? null }));
  if (!values.length) return 0;
  const res = await exec.insert(notifications).values(values).onConflictDoNothing().returning({ id: notifications.id });
  return res.length;
}

export async function unreadCount(exec: Executor, userId: string): Promise<number> {
  const [r] = await exec.select({ c: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), sql`${notifications.readAt} is null`));
  return r?.c ?? 0;
}
