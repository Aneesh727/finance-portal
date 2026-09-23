/**
 * Idempotent bootstrap of reference data. Safe to run on every deploy.
 * NEVER overwrites things an admin has customised (roles' permissions, categories, tax rates ...):
 * defaults are only inserted when missing. SUPER_ADMIN is always synced to the full permission list.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Executor } from './db';
import { categories, paymentTerms, permissions, rolePermissions, roles, taxRates } from '@/db/schema';
import { PERMISSIONS, ROLE_DEFAULTS, ROLE_KEYS, ALL_PERMS } from './permissions';

export const DEFAULT_SERVICES = [
  'Web Development', 'App Development', 'Software Development', 'UI/UX Design', 'Digital Marketing', 'SEO', 'Social Media Marketing',
  'Branding', 'Graphic Design', 'Event Management', 'Consulting', 'Maintenance', 'Retainer', 'Other',
];
export const DEFAULT_COST_CATEGORIES = [
  'Developer', 'Designer', 'QA', 'Project Manager', 'Marketing', 'SEO', 'Copywriter', 'Video', 'Photography', 'Hosting', 'Domain', 'Software',
  'API', 'AI Services', 'Cloud', 'Third Party', 'Vendor', 'Freelancer', 'Travel', 'Event', 'Printing', 'Advertising', 'Miscellaneous',
];
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Office', 'Software', 'Subscriptions', 'Marketing', 'Travel', 'Equipment', 'Salary', 'Freelancers', 'Vendors', 'Events', 'Cloud', 'Hosting', 'Other',
];

export const slugify = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';

export async function ensureBaseData(exec: Executor) {
  // permissions
  for (const [group, key, description] of PERMISSIONS) {
    await exec.insert(permissions).values({ group, key, description }).onConflictDoUpdate({ target: permissions.key, set: { group, description } });
  }
  const permRows = await exec.select().from(permissions);
  const permId = new Map(permRows.map((p) => [p.key, p.id]));

  // roles
  for (const key of ROLE_KEYS) {
    const def = ROLE_DEFAULTS[key];
    const existing = await exec.select().from(roles).where(eq(roles.key, key)).limit(1);
    let roleId: string;
    let isNew = false;
    if (existing[0]) roleId = existing[0].id;
    else {
      const [r] = await exec.insert(roles).values({ key, name: def.name, description: def.description, isSystem: true }).returning({ id: roles.id });
      roleId = r.id;
      isNew = true;
    }
    const want = key === 'SUPER_ADMIN' ? ALL_PERMS : isNew ? def.perms : [];
    for (const p of want) {
      await exec.insert(rolePermissions).values({ roleId, permissionId: permId.get(p)! }).onConflictDoNothing();
    }
  }

  // categories (only when the kind has none yet)
  const seedKind = async (kind: 'SERVICE' | 'COST' | 'EXPENSE', names: string[]) => {
    const [{ c }] = (await exec.select({ c: sql<number>`count(*)::int` }).from(categories).where(eq(categories.kind, kind))) as { c: number }[];
    if (c > 0) return;
    let i = 0;
    for (const name of names) {
      await exec.insert(categories).values({ kind, name, slug: slugify(name), sortOrder: i++ }).onConflictDoNothing();
    }
  };
  await seedKind('SERVICE', DEFAULT_SERVICES);
  await seedKind('COST', DEFAULT_COST_CATEGORIES);
  await seedKind('EXPENSE', DEFAULT_EXPENSE_CATEGORIES);

  // GST slabs
  const [{ tc }] = (await exec.select({ tc: sql<number>`count(*)::int` }).from(taxRates)) as { tc: number }[];
  if (tc === 0) {
    for (const [name, rate, def] of [['GST 0%', '0', false], ['GST 5%', '5', false], ['GST 12%', '12', false], ['GST 18%', '18', true], ['GST 28%', '28', false]] as const) {
      await exec.insert(taxRates).values({ name, ratePct: rate, isDefault: def }).onConflictDoNothing();
    }
  }
  // payment terms
  const [{ pc }] = (await exec.select({ pc: sql<number>`count(*)::int` }).from(paymentTerms)) as { pc: number }[];
  if (pc === 0) {
    const terms: [string, number][] = [['Due on receipt', 0], ['Net 15', 15], ['Net 30', 30], ['Net 45', 45], ['Net 60', 60]];
    let i = 0;
    for (const [name, days] of terms) await exec.insert(paymentTerms).values({ name, days, sortOrder: i++ }).onConflictDoNothing();
  }
}

export async function findRoleId(exec: Executor, key: string): Promise<string> {
  const [r] = await exec.select({ id: roles.id }).from(roles).where(and(eq(roles.key, key))).limit(1);
  if (!r) throw new Error(`Role ${key} not found. Run migrations/seed first.`);
  return r.id;
}
