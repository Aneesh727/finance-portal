import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { company, users, categories, clients, resources, vendors } from '@/db/schema';
import { ensureBaseData, findRoleId } from '@/lib/base-data';
import { createSession, hashPassword, SESSION_COOKIE } from '@/lib/auth';
import type { RoleKey } from '@/lib/permissions';

type Handler = (req: NextRequest, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;

export interface Session { userId: string; email: string; cookie: string; csrf: string }
let seq = 0;
export const uniq = (p = 'x') => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

let baseDone: Promise<void> | null = null;
export function ensureBase() {
  baseDone ??= (async () => {
    await ensureBaseData(db);
    await db.insert(company).values({ id: 'singleton', name: 'Test Co', baseCurrency: 'INR', fyStartMonth: 4, stateCode: '27', gstin: '27AAAAA0000A1Z5', setupComplete: true }).onConflictDoNothing();
  })();
  return baseDone;
}

export async function makeUser(role: RoleKey = 'ADMIN', email = `${uniq('u')}@test.local`): Promise<Session> {
  await ensureBase();
  const roleId = await findRoleId(db, role);
  const [u] = await db.insert(users).values({ email, name: `${role} user`, passwordHash: await hashPassword('Passw0rd!Passw0rd'), roleId }).returning();
  const s = await createSession(u.id, { ip: 'test' });
  return { userId: u.id, email, cookie: `${SESSION_COOKIE}=${s.token}`, csrf: s.csrf };
}

export interface CallOpts { session?: Session | null; body?: unknown; params?: Record<string, string>; query?: Record<string, string | number | undefined>; headers?: Record<string, string>; noCsrf?: boolean; rawBody?: string; form?: FormData }
export interface Res<T = any> { status: number; body: any; data: T; headers: Headers; buf: Buffer; text: string; error?: { code: string; message: string; details?: any; requestId?: string } }

export async function call<T = any>(handler: Handler, method: string, path: string, o: CallOpts = {}): Promise<Res<T>> {
  const url = new URL(path, 'http://localhost:3000');
  for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { host: 'localhost:3000', ...(o.headers ?? {}) };
  if (o.session) { headers.cookie = o.session.cookie; if (!o.noCsrf && method !== 'GET') headers['x-csrf-token'] = o.session.csrf; }
  let body: string | undefined;
  let bodyInit: BodyInit | undefined;
  if (o.form) bodyInit = o.form;
  else if (o.rawBody !== undefined) body = o.rawBody;
  else if (o.body !== undefined) { body = JSON.stringify(o.body); headers['content-type'] = 'application/json'; }
  const req = new NextRequest(url, { method, headers, body: bodyInit ?? body });
  const res = await handler(req, { params: Promise.resolve(o.params ?? {}) });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, data: json?.data, headers: res.headers, error: json?.error, buf, text };
}

export const catId = async (kind: 'COST' | 'SERVICE' | 'EXPENSE', name?: string) => {
  await ensureBase();
  const rows = await db.select().from(categories).where(eq(categories.kind, kind));
  const c = name ? rows.find((r) => r.name === name) : rows[0];
  if (!c) throw new Error(`category ${kind}/${name} missing`);
  return c.id;
};

export async function makeClient(name = uniq('Client'), extra: Record<string, unknown> = {}) {
  await ensureBase();
  const [c] = await db.insert(clients).values({ companyName: name, ...extra } as never).returning();
  return c;
}
export async function makeVendor(name = uniq('Vendor')) {
  const [v] = await db.insert(vendors).values({ name }).returning();
  return v;
}
export async function makeResource(o: Partial<typeof resources.$inferInsert> = {}) {
  const [r] = await db.insert(resources).values({ name: uniq('Res'), role: 'Developer', type: 'FREELANCER', hourlyCost: '500', dailyCost: '4000', monthlyCost: '0', billingRate: '1000', ...o } as never).returning();
  return r;
}

// ───────────── scenario builders ─────────────
import { H } from './api';
export const R = (rupees: number) => Math.round(rupees * 100);

export async function newProject(session: Session, o: Record<string, unknown> = {}) {
  const client = (o.clientId as string) ?? (await makeClient()).id;
  const svc = (o.serviceId as string) ?? (await catId('SERVICE', 'Web Development'));
  const res = await call(H.projects.POST, 'POST', '/api/projects', { session, body: { name: uniq('Proj'), clientId: client, serviceId: svc, type: 'ONE_TIME', status: 'ACTIVE', taxMode: 'NONE', sellingPrice: '100000', budget: '60000', ...o } });
  if (res.status !== 201) throw new Error(`newProject failed: ${JSON.stringify(res.body)}`);
  return { id: res.data.id as string, code: res.data.code as string, clientId: client };
}
export async function getFin(session: Session, id: string) {
  const r = await call(H.projectById.GET, 'GET', `/api/projects/${id}`, { session, params: { id } });
  if (r.status !== 200) throw new Error(`getFin ${r.status} ${JSON.stringify(r.body)}`);
  return r.data;
}
export async function addCost(session: Session, projectId: string, amount: string, o: Record<string, unknown> = {}) {
  return call(H.costs.POST, 'POST', '/api/costs', { session, body: { projectId, name: uniq('cost'), categoryId: await catId('COST', 'Developer'), amount, date: '2026-09-01', ...o } });
}
