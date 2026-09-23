import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { route, likePattern } from '@/lib/api';
import { db } from '@/lib/db';
import { projectScopeSql } from '@/lib/access';

export const dynamic = 'force-dynamic';

/** global search across the entities the caller may see */
export const GET = route({ query: z.object({ q: z.string().trim().min(2).max(80) }) }, async ({ query, user }) => {
  const like = likePattern(query.q);
  const out: { type: string; id: string; title: string; subtitle?: string; href: string }[] = [];
  if (user.perms.has('projects.view')) {
    const r = (await db.execute(sql`SELECT p.id, p.code, p.name, c.company_name FROM projects p JOIN clients c ON c.id = p.client_id WHERE ${projectScopeSql(user, 'p')} AND (p.name ILIKE ${like} OR p.code ILIKE ${like} OR c.company_name ILIKE ${like}) ORDER BY p.created_at DESC LIMIT 6`)).rows as { id: string; code: string; name: string; company_name: string }[];
    r.forEach((x) => out.push({ type: 'Project', id: x.id, title: `${x.code} · ${x.name}`, subtitle: x.company_name, href: `/projects/${x.id}` }));
  }
  if (user.perms.has('clients.view')) {
    const r = (await db.execute(sql`SELECT id, company_name, contact_person FROM clients WHERE archived_at IS NULL AND (company_name ILIKE ${like} OR contact_person ILIKE ${like} OR email ILIKE ${like}) ORDER BY company_name LIMIT 5`)).rows as { id: string; company_name: string; contact_person: string | null }[];
    r.forEach((x) => out.push({ type: 'Client', id: x.id, title: x.company_name, subtitle: x.contact_person ?? undefined, href: `/clients/${x.id}` }));
  }
  if (user.perms.has('resources.view')) {
    const r = (await db.execute(sql`SELECT id, name, role FROM resources WHERE archived_at IS NULL AND (name ILIKE ${like} OR role ILIKE ${like}) ORDER BY name LIMIT 4`)).rows as { id: string; name: string; role: string }[];
    r.forEach((x) => out.push({ type: 'Resource', id: x.id, title: x.name, subtitle: x.role, href: `/resources?q=${encodeURIComponent(x.name)}` }));
    const v = (await db.execute(sql`SELECT id, name FROM vendors WHERE archived_at IS NULL AND name ILIKE ${like} ORDER BY name LIMIT 4`)).rows as { id: string; name: string }[];
    v.forEach((x) => out.push({ type: 'Vendor', id: x.id, title: x.name, href: `/vendors?q=${encodeURIComponent(x.name)}` }));
  }
  if (user.perms.has('payments.view')) {
    const r = (await db.execute(sql`SELECT i.id, i.number, p.name FROM invoices i JOIN projects p ON p.id = i.project_id WHERE ${projectScopeSql(user, 'p')} AND i.number ILIKE ${like} ORDER BY i.created_at DESC LIMIT 4`)).rows as { id: string; number: string; name: string }[];
    r.forEach((x) => out.push({ type: 'Invoice', id: x.id, title: x.number, subtitle: x.name, href: `/billing?q=${encodeURIComponent(x.number)}` }));
  }
  if (user.perms.has('expenses.view')) {
    const r = (await db.execute(sql`SELECT e.id, e.description FROM expenses e LEFT JOIN projects p ON p.id = e.project_id WHERE e.archived_at IS NULL AND (e.scope <> 'PROJECT' OR ${projectScopeSql(user, 'p')}) AND e.description ILIKE ${like} ORDER BY e.date DESC LIMIT 4`)).rows as { id: string; description: string }[];
    r.forEach((x) => out.push({ type: 'Expense', id: x.id, title: x.description, href: `/expenses?q=${encodeURIComponent(query.q)}` }));
  }
  return out;
});
