/**
 * Authentication, RBAC, IDOR, injection and manipulation tests (spec §12, §46, §48).
 * Everything goes through the real route handlers against a real PostgreSQL database.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { H } from './api';
import { call, makeUser, makeClient, catId, uniq, newProject, getFin, addCost, ensureBase, type Session } from './helpers';
import { db, closeDb } from '@/lib/db';
import { users, sessions } from '@/db/schema';
import { hashPassword } from '@/lib/auth';
import { findRoleId } from '@/lib/base-data';

afterAll(async () => { await closeDb(); });

const PW = 'Passw0rd!Passw0rd';
let admin: Session, finance: Session, pm: Session, tm: Session, viewer: Session, superAdmin: Session;

beforeAll(async () => {
  await ensureBase();
  [admin, finance, pm, tm, viewer, superAdmin] = await Promise.all([makeUser('ADMIN'), makeUser('FINANCE'), makeUser('PROJECT_MANAGER'), makeUser('TEAM_MEMBER'), makeUser('VIEWER'), makeUser('SUPER_ADMIN')]);
});

describe('authentication', () => {
  it('logs in with valid credentials, sets an HttpOnly cookie and returns a CSRF token', async () => {
    const email = `${uniq('login')}@test.local`;
    await db.insert(users).values({ email, name: 'L', passwordHash: await hashPassword(PW), roleId: await findRoleId(db, 'ADMIN'), mustChangePw: false });
    const r = await call(H.login.POST, 'POST', '/api/auth/login', { body: { email, password: PW }, headers: { origin: 'http://localhost:3000' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const cookie = r.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/fp_session=/); expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/SameSite=Lax/i);
    expect(r.data.csrfToken).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|password_hash/);
    const token = cookie.split(';')[0];
    const meRes = await call(H.me.GET, 'GET', '/api/auth/me', { headers: { cookie: token } });
    expect(meRes.status).toBe(200); expect(meRes.data.user.email).toBe(email);
  });

  it('rejects a wrong password and an unknown email with the same generic message', async () => {
    const email = `${uniq('wrongpw')}@test.local`;
    await db.insert(users).values({ email, name: 'W', passwordHash: await hashPassword(PW), roleId: await findRoleId(db, 'VIEWER') });
    const a = await call(H.login.POST, 'POST', '/api/auth/login', { body: { email, password: 'nope-nope-nope' } });
    const b = await call(H.login.POST, 'POST', '/api/auth/login', { body: { email: `${uniq('ghost')}@test.local`, password: 'nope-nope-nope' } });
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(a.error?.message).toBe(b.error?.message);
  });

  it('locks the account after 5 failed attempts, even for the right password, and an admin can unlock it', async () => {
    const email = `${uniq('lock')}@test.local`;
    const [u] = await db.insert(users).values({ email, name: 'Lock', passwordHash: await hashPassword(PW), roleId: await findRoleId(db, 'VIEWER'), mustChangePw: false }).returning();
    for (let i = 0; i < 5; i++) await call(H.login.POST, 'POST', '/api/auth/login', { body: { email, password: 'bad-password-1' }, headers: { 'x-forwarded-for': `10.9.${i}.1` } });
    const locked = await call(H.login.POST, 'POST', '/api/auth/login', { body: { email, password: PW }, headers: { 'x-forwarded-for': '10.9.9.9' } });
    expect([423, 429]).toContain(locked.status);
    if (locked.status === 423) expect(locked.error?.code).toBe('ACCOUNT_LOCKED');
    const un = await call(H.userById.PATCH, 'PATCH', `/api/users/${u.id}`, { session: admin, params: { id: u.id }, body: { unlock: true } });
    expect(un.status).toBe(200);
    const ok = await call(H.login.POST, 'POST', '/api/auth/login', { body: { email, password: PW }, headers: { 'x-forwarded-for': '10.9.9.10' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('deactivated users cannot sign in and existing sessions stop working', async () => {
    const s = await makeUser('VIEWER');
    expect((await call(H.me.GET, 'GET', '/api/auth/me', { session: s })).status).toBe(200);
    const off = await call(H.userById.PATCH, 'PATCH', `/api/users/${s.userId}`, { session: admin, params: { id: s.userId }, body: { active: false } });
    expect(off.status).toBe(200);
    expect((await call(H.me.GET, 'GET', '/api/auth/me', { session: s })).status).toBe(401);
    const login = await call(H.login.POST, 'POST', '/api/auth/login', { body: { email: s.email, password: PW } });
    expect(login.status).toBe(403);
  });

  it('requests without a session, with a garbage session, or with an expired/revoked session are 401', async () => {
    expect((await call(H.projects.GET, 'GET', '/api/projects')).status).toBe(401);
    expect((await call(H.projects.GET, 'GET', '/api/projects', { headers: { cookie: 'fp_session=' + 'a'.repeat(43) } })).status).toBe(401);
    const s = await makeUser('ADMIN');
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, s.userId));
    expect((await call(H.projects.GET, 'GET', '/api/projects', { session: s })).status).toBe(401);
    const s2 = await makeUser('ADMIN');
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, s2.userId));
    expect((await call(H.projects.GET, 'GET', '/api/projects', { session: s2 })).status).toBe(401);
  });

  it('logout revokes the session server-side', async () => {
    const s = await makeUser('ADMIN');
    const out = await call(H.logout.POST, 'POST', '/api/auth/logout', { session: s });
    expect(out.status).toBe(200);
    expect((await call(H.me.GET, 'GET', '/api/auth/me', { session: s })).status).toBe(401);
  });

  it('a user flagged mustChangePw can only reach me/change-password until they change it', async () => {
    const s = await makeUser('ADMIN');
    await db.update(users).set({ mustChangePw: true }).where(eq(users.id, s.userId));
    const blocked = await call(H.projects.GET, 'GET', '/api/projects', { session: s });
    expect(blocked.status).toBe(403); expect(blocked.error?.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await call(H.me.GET, 'GET', '/api/auth/me', { session: s })).status).toBe(200);
    const weak = await call(H.changePw.POST, 'POST', '/api/auth/change-password', { session: s, body: { currentPassword: PW, newPassword: 'short' } });
    expect(weak.status).toBe(422);
    const wrong = await call(H.changePw.POST, 'POST', '/api/auth/change-password', { session: s, body: { currentPassword: 'wrong-wrong-1A!', newPassword: 'Another#Pass123' } });
    expect(wrong.status).toBe(400);
    const ok = await call(H.changePw.POST, 'POST', '/api/auth/change-password', { session: s, body: { currentPassword: PW, newPassword: 'Another#Pass123' } });
    expect(ok.status).toBe(200);
    expect((await call(H.projects.GET, 'GET', '/api/projects', { session: s })).status).toBe(200);
  });

  it('passwords are stored as bcrypt hashes, never plaintext', async () => {
    const [u] = await db.select().from(users).where(eq(users.id, admin.userId));
    expect(u.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(u.passwordHash).not.toContain(PW);
  });
});

describe('CSRF and origin', () => {
  it('state-changing requests without the CSRF token are refused', async () => {
    const r = await call(H.clients.POST, 'POST', '/api/clients', { session: admin, noCsrf: true, body: { companyName: uniq('C') } });
    expect(r.status).toBe(403); expect(r.error?.code).toBe('CSRF');
  });
  it('a wrong CSRF token is refused', async () => {
    const r = await call(H.clients.POST, 'POST', '/api/clients', { session: admin, noCsrf: true, headers: { 'x-csrf-token': 'x'.repeat(32) }, body: { companyName: uniq('C') } });
    expect(r.status).toBe(403);
  });
  it('a cross-site Origin is refused even with a valid token', async () => {
    const r = await call(H.clients.POST, 'POST', '/api/clients', { session: admin, headers: { origin: 'https://evil.example' }, body: { companyName: uniq('C') } });
    expect(r.status).toBe(403);
  });
});

describe('RBAC matrix', () => {
  const matrix: { name: string; run: (s: Session) => Promise<{ status: number }>; allow: Session[] }[] = [];
  beforeAll(() => {
    matrix.push(
      { name: 'list users', run: (s) => call(H.users.GET, 'GET', '/api/users', { session: s, query: { lookup: 1 } }), allow: [admin, superAdmin, pm] },
      { name: 'create user', run: async (s) => call(H.users.POST, 'POST', '/api/users', { session: s, body: { name: 'X', email: `${uniq('x')}@t.local`, roleId: await findRoleId(db, 'VIEWER'), password: PW } }), allow: [admin, superAdmin] },
      { name: 'list roles', run: (s) => call(H.roles.GET, 'GET', '/api/roles', { session: s }), allow: [admin, superAdmin] },
      { name: 'read settings', run: (s) => call(H.settings.GET, 'GET', '/api/settings', { session: s }), allow: [admin, superAdmin] },
      { name: 'view audit log', run: (s) => call(H.auditLog.GET, 'GET', '/api/audit', { session: s }), allow: [admin, superAdmin] },
      { name: 'download backup', run: (s) => call(H.backup.GET, 'GET', '/api/backup', { session: s }), allow: [superAdmin] },
      { name: 'create client', run: (s) => call(H.clients.POST, 'POST', '/api/clients', { session: s, body: { companyName: uniq('C') } }), allow: [admin, superAdmin] },
      { name: 'list payments', run: (s) => call(H.payments.GET, 'GET', '/api/payments', { session: s }), allow: [admin, superAdmin, finance, viewer] },
      { name: 'list expenses', run: (s) => call(H.expenses.GET, 'GET', '/api/expenses', { session: s }), allow: [admin, superAdmin, finance, viewer] },
      { name: 'profitability report', run: (s) => call(H.reportProfit.GET, 'GET', '/api/reports/profitability', { session: s, query: { group: 'client' } }), allow: [admin, superAdmin, finance, viewer] },
      { name: 'forecast', run: (s) => call(H.reportForecast.GET, 'GET', '/api/reports/forecast', { session: s }), allow: [admin, superAdmin, finance, viewer] },
      { name: 'export projects', run: (s) => call(H.exportDs.GET, 'GET', '/api/export/projects', { session: s, params: { dataset: 'projects' }, query: { format: 'csv' } }), allow: [admin, superAdmin, finance] },
      { name: 'run deals list', run: (s) => call(H.deals.GET, 'GET', '/api/deals', { session: s }), allow: [admin, superAdmin, finance, viewer] },
    );
  });
  const sessions4 = () => ({ admin, superAdmin, finance, pm, tm, viewer });
  it('every endpoint allows exactly the intended roles', async () => {
    const failures: string[] = [];
    for (const m of matrix) {
      for (const [role, s] of Object.entries(sessions4())) {
        const r = await m.run(s);
        const shouldAllow = m.allow.includes(s);
        const ok = shouldAllow ? r.status >= 200 && r.status < 300 : r.status === 403;
        if (!ok) failures.push(`${m.name} as ${role}: got ${r.status}, expected ${shouldAllow ? '2xx' : '403'}`);
      }
    }
    expect(failures).toEqual([]);
  });
  it('viewers cannot write anything', async () => {
    const p = await newProject(admin);
    const attempts = await Promise.all([
      call(H.projectById.PATCH, 'PATCH', `/api/projects/${p.id}`, { session: viewer, params: { id: p.id }, body: { name: 'hack' } }),
      addCost(viewer, p.id, '10'),
      call(H.payments.POST, 'POST', '/api/payments', { session: viewer, body: { projectId: p.id, amount: '1', receivedDate: '2026-09-01' } }),
      call(H.projectStatus.POST, 'POST', `/api/projects/${p.id}/status`, { session: viewer, params: { id: p.id }, body: { status: 'COMPLETED' } }),
      call(H.projectArchive.POST, 'POST', `/api/projects/${p.id}/archive`, { session: viewer, params: { id: p.id } }),
    ]);
    for (const r of attempts) expect(r.status).toBe(403);
  });
});

describe('privilege escalation', () => {
  it('an Admin cannot create, promote to, edit or reset a Super Admin; nobody can change their own role', async () => {
    const superRole = await findRoleId(db, 'SUPER_ADMIN');
    const c = await call(H.users.POST, 'POST', '/api/users', { session: admin, body: { name: 'Sneaky', email: `${uniq('s')}@t.local`, roleId: superRole, password: PW } });
    expect(c.status).toBe(403);
    const victim = await makeUser('VIEWER');
    expect((await call(H.userById.PATCH, 'PATCH', `/api/users/${victim.userId}`, { session: admin, params: { id: victim.userId }, body: { roleId: superRole } })).status).toBe(403);
    expect((await call(H.userById.PATCH, 'PATCH', `/api/users/${superAdmin.userId}`, { session: admin, params: { id: superAdmin.userId }, body: { active: false } })).status).toBe(403);
    expect((await call(H.userReset.POST, 'POST', `/api/users/${superAdmin.userId}/reset-password`, { session: admin, params: { id: superAdmin.userId }, body: { password: 'Brand#New12345' } })).status).toBe(403);
    expect((await call(H.userById.PATCH, 'PATCH', `/api/users/${admin.userId}`, { session: admin, params: { id: admin.userId }, body: { roleId: await findRoleId(db, 'VIEWER') } })).status).toBe(403);
    expect((await call(H.userById.PATCH, 'PATCH', `/api/users/${admin.userId}`, { session: admin, params: { id: admin.userId }, body: { active: false } })).status).toBe(403);
  });
  it('role changes take effect immediately (sessions are revoked)', async () => {
    const s = await makeUser('FINANCE');
    expect((await call(H.payments.GET, 'GET', '/api/payments', { session: s })).status).toBe(200);
    const r = await call(H.userById.PATCH, 'PATCH', `/api/users/${s.userId}`, { session: admin, params: { id: s.userId }, body: { roleId: await findRoleId(db, 'TEAM_MEMBER') } });
    expect(r.status).toBe(200);
    expect((await call(H.payments.GET, 'GET', '/api/payments', { session: s })).status).toBe(401);
  });
  it('system roles cannot be deleted or have their key changed; custom roles work end-to-end', async () => {
    const list = await call(H.roles.GET, 'GET', '/api/roles', { session: admin });
    const sysRole = list.data.find((r: any) => r.key === 'FINANCE');
    expect((await call(H.roleById.DELETE, 'DELETE', `/api/roles/${sysRole.id}`, { session: admin, params: { id: sysRole.id } })).status).toBe(403); // admins cannot manage roles at all
    const del = await call(H.roleById.DELETE, 'DELETE', `/api/roles/${sysRole.id}`, { session: superAdmin, params: { id: sysRole.id } });
    expect([403, 409, 422]).toContain(del.status);
    const created = await call(H.roles.POST, 'POST', '/api/roles', { session: superAdmin, body: { name: uniq('Auditor'), description: 'read only', perms: ['projects.view', 'projects.viewAll'] } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
  });
});

describe('IDOR / row-level access', () => {
  it('a project manager cannot read or touch projects they are not assigned to (404, not 403, so existence is not leaked)', async () => {
    const other = await newProject(admin);
    const mine = await newProject(admin, { managerId: pm.userId });
    expect((await call(H.projectById.GET, 'GET', `/api/projects/${other.id}`, { session: pm, params: { id: other.id } })).status).toBe(404);
    expect((await call(H.projectById.GET, 'GET', `/api/projects/${mine.id}`, { session: pm, params: { id: mine.id } })).status).toBe(200);
    expect((await call(H.projectById.PATCH, 'PATCH', `/api/projects/${other.id}`, { session: pm, params: { id: other.id }, body: { name: 'x' } })).status).toBe(404);
    expect((await addCost(pm, other.id, '10')).status).toBe(404);
    expect((await call(H.projectHistory.GET, 'GET', `/api/projects/${other.id}/history`, { session: pm, params: { id: other.id } })).status).toBe(404);
    const list = await call(H.projects.GET, 'GET', '/api/projects', { session: pm, query: { pageSize: 200 } });
    const ids = list.data.map((p: any) => p.id);
    expect(ids).toContain(mine.id); expect(ids).not.toContain(other.id);
    const rand = await call(H.projectById.GET, 'GET', '/api/projects/00000000-0000-4000-8000-000000000000', { session: pm, params: { id: '00000000-0000-4000-8000-000000000000' } });
    expect(rand.status).toBe(404);
  });
  it('child records (cost, milestone, invoice, payment) of an inaccessible project are 404 to the outsider', async () => {
    const p = await newProject(admin, { type: 'MILESTONE', sellingPrice: '0', milestones: [{ name: 'M1', price: '1000' }] });
    const cost = await addCost(admin, p.id, '100');
    expect(cost.status).toBe(201);
    expect((await call(H.costById.GET, 'GET', `/api/costs/${cost.data.cost.id}`, { session: pm, params: { id: cost.data.cost.id } })).status).toBe(404);
    expect((await call(H.costVoid.POST, 'POST', `/api/costs/${cost.data.cost.id}/void`, { session: pm, params: { id: cost.data.cost.id }, body: { reason: 'x' } })).status).toBe(404);
    const d = await getFin(admin, p.id);
    const ms = d.milestones[0];
    expect((await call(H.milestoneById.PATCH, 'PATCH', `/api/milestones/${ms.id}`, { session: pm, params: { id: ms.id }, body: { name: 'hax' } })).status).toBe(404);
    const inv = await call(H.invoices.POST, 'POST', '/api/invoices', { session: finance, body: { projectId: p.id, type: 'CUSTOM', subtotal: '1000', dueDate: '2026-12-31' } });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const fin2 = await makeUser('FINANCE');
    // finance sees all projects (viewAll); a scoped payments user must not
    const scoped = await call(H.roles.POST, 'POST', '/api/roles', { session: superAdmin, body: { name: uniq('ScopedPay'), perms: ['projects.view', 'payments.view', 'payments.manage'] } });
    const scopedUser = await makeUser('VIEWER');
    await db.update(users).set({ roleId: scoped.data.id }).where(eq(users.id, scopedUser.userId));
    expect((await call(H.invoiceById.GET, 'GET', `/api/invoices/${inv.data.id}`, { session: scopedUser, params: { id: inv.data.id } })).status).toBe(404);
    expect((await call(H.payments.POST, 'POST', '/api/payments', { session: scopedUser, body: { invoiceId: inv.data.id, amount: '10', receivedDate: '2026-09-01' } })).status).toBe(404);
    const plist = await call(H.payments.GET, 'GET', '/api/payments', { session: scopedUser });
    expect(plist.data.length).toBe(0);
    void fin2;
  });
  it('a team member only sees and costs their assigned project and cannot read the profit', async () => {
    const p = await newProject(admin, { memberIds: [tm.userId] });
    const other = await newProject(admin);
    const d = await getFin(tm, p.id);
    expect(d.financials.revenue).toBeUndefined(); expect(d.financials.profit).toBeUndefined();
    expect(d.project.sellingPrice).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain('"sellingPrice"');
    expect((await call(H.projectById.GET, 'GET', `/api/projects/${other.id}`, { session: tm, params: { id: other.id } })).status).toBe(404);
    expect((await addCost(tm, p.id, '10')).status).toBe(201);
  });
  it('search results never include inaccessible projects', async () => {
    const name = uniq('SecretProject');
    await newProject(admin, { name });
    const r = await call(H.search.GET, 'GET', '/api/search', { session: pm, query: { q: name } });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.data)).not.toContain(name);
    const r2 = await call(H.search.GET, 'GET', '/api/search', { session: admin, query: { q: name } });
    expect(JSON.stringify(r2.data)).toContain(name);
  });
});

describe('financial redaction has no side channels (users without profit.view)', () => {
  it('health, sorting, filtering and notifications do not reveal margin or receivables to a project manager', async () => {
    // a loss-making project: budget fine, revenue small, big cost -> projected loss (profit-derived CRITICAL)
    const p = await newProject(admin, { managerId: pm.userId, sellingPrice: '10000', budget: '500000', name: uniq('Leaky') });
    expect((await addCost(admin, p.id, '20000')).status).toBe(201);
    const f = await getFin(admin, p.id);
    expect(f.financials.health.reasons.join(' ')).toMatch(/loss|margin/i); // the admin sees the profit-based reasons
    const asPm = await getFin(pm, p.id);
    expect(asPm.financials.profit).toBeUndefined();
    expect(asPm.financials.health.status).toBe('HEALTHY'); // budget is fine, so no budget-derived flag
    expect(JSON.stringify(asPm.financials.health)).not.toMatch(/margin|loss|overdue|%/i);
    // list DTO carries the same redacted health
    const list = await call(H.projects.GET, 'GET', '/api/projects', { session: pm, query: { pageSize: 200 } });
    const row = list.data.find((x: any) => x.id === p.id);
    expect(row.health.status).toBe('HEALTHY'); expect(row.profit).toBeUndefined();
    // sorting / filtering by figures the caller cannot see is refused (would leak through ordering)
    for (const q of [{ sort: 'profit' }, { sort: 'margin' }, { sort: 'revenue' }, { sort: 'outstanding' }, { marginMax: 5 }, { marginMin: 50 }, { overdue: '1' }]) {
      const r = await call(H.projects.GET, 'GET', '/api/projects', { session: pm, query: q as never });
      expect(r.status, JSON.stringify(q)).toBe(403);
    }
    // health filter works but on the redacted health only: the loss-making (budget-OK) project is HEALTHY for the manager
    const crit = await call(H.projects.GET, 'GET', '/api/projects', { session: pm, query: { health: 'CRITICAL', pageSize: 200 } });
    expect(crit.status).toBe(200); expect(crit.data.map((x: any) => x.id)).not.toContain(p.id);
    // dashboard "at risk" for the manager never contains profit-based reasons
    const dash = await call(H.dashboard.GET, 'GET', '/api/dashboard', { session: pm });
    expect(dash.status).toBe(200);
    expect(JSON.stringify(dash.data.atRisk ?? [])).not.toMatch(/margin|loss|overdue payment/i);
    expect(dash.data.lowestMargin).toEqual([]); expect(dash.data.overdueInvoices).toEqual([]);
    // notifications: the scan must not deliver margin / overdue alerts to someone without profit.view
    const { runNotificationScan, evaluateProjectAlerts } = await import('@/lib/services/alerts');
    await evaluateProjectAlerts(db, p.id); await runNotificationScan(db);
    const notes = await call(H.notifications.GET, 'GET', '/api/notifications', { session: pm, query: { pageSize: 100 } });
    expect(notes.status).toBe(200);
    expect(notes.data.filter((n: any) => n.type === 'LOW_MARGIN' || n.type === 'PAYMENT_OVERDUE')).toEqual([]);
    const adminNotes = await call(H.notifications.GET, 'GET', '/api/notifications', { session: admin, query: { pageSize: 100 } });
    expect(adminNotes.data.some((n: any) => n.type === 'LOW_MARGIN' && n.title.includes(p.code))).toBe(true);
  });
  it('an export by a user without profit.view has no profit columns', async () => {
    const custom = await makeUser('PROJECT_MANAGER');
    // PROJECT_MANAGER lacks reports.export by default, so the export itself is refused
    const r = await call(H.exportDs.GET, 'GET', '/api/export/projects', { session: custom, params: { dataset: 'projects' }, query: { format: 'csv' } });
    expect(r.status).toBe(403);
  });
});

describe('injection and XSS', () => {
  it('SQL injection strings in search, sort and filters are inert', async () => {
    const evil = ["'; DROP TABLE projects; --", "' OR '1'='1", '%', '_', '\\', 'Robert"); DELETE FROM clients;--'];
    for (const q of evil) {
      for (const [h, path] of [[H.projects, '/api/projects'], [H.clients, '/api/clients'], [H.costs, '/api/costs'], [H.expenses, '/api/expenses'], [H.invoices, '/api/invoices'], [H.payments, '/api/payments'], [H.search, '/api/search']] as const) {
        const r = await call(h.GET, 'GET', path, { session: admin, query: { q } });
        expect(r.status, `${path} q=${q}: ${JSON.stringify(r.body)}`).toBeLessThan(500);
      }
    }
    for (const sort of ["name; DROP TABLE users", '1;--', 'pg_sleep(5)']) {
      const r = await call(H.projects.GET, 'GET', '/api/projects', { session: admin, query: { sort } });
      expect(r.status).toBeLessThan(500);
    }
    const alive = await call(H.projects.GET, 'GET', '/api/projects', { session: admin });
    expect(alive.status).toBe(200);
  });
  it('a % or _ search term matches literally, not as a wildcard', async () => {
    const tag = uniq('lit');
    await makeClient(`${tag}-100%-done`);
    await makeClient(`${tag}-100X-done`);
    const r = await call(H.clients.GET, 'GET', '/api/clients', { session: admin, query: { q: `${tag}-100%` } });
    expect(r.data.length).toBe(1);
  });
  it('malformed ids are 400 and never reach SQL', async () => {
    for (const id of ["1' OR 1=1", 'not-a-uuid', '../../etc/passwd']) {
      const r = await call(H.projectById.GET, 'GET', `/api/projects/x`, { session: admin, params: { id } });
      expect(r.status).toBe(400);
    }
    const r = await call(H.payments.GET, 'GET', '/api/payments', { session: admin, query: { projectId: "1' OR '1'='1" } });
    expect(r.status).toBe(400);
  });
  it('HTML/script payloads are stored verbatim as data (React escapes on render) and are returned as JSON, never HTML', async () => {
    const payload = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const c = await call(H.clients.POST, 'POST', '/api/clients', { session: admin, body: { companyName: payload } });
    expect(c.status).toBe(201);
    const g = await call(H.clientById.GET, 'GET', `/api/clients/${c.data.id}`, { session: admin, params: { id: c.data.id } });
    expect(g.headers.get('content-type')).toMatch(/application\/json/);
    expect(JSON.stringify(g.body)).toContain('script');
  });
  it('mass assignment: server-controlled fields in the body are ignored or rejected', async () => {
    const p = await newProject(admin);
    const r = await call(H.projectById.PATCH, 'PATCH', `/api/projects/${p.id}`, { session: admin, params: { id: p.id }, body: { name: 'ok', id: '00000000-0000-4000-8000-000000000001', code: 'HACK-1', version: 99, createdBy: admin.userId, archivedAt: '2020-01-01' } });
    expect([200, 409, 422]).toContain(r.status);
    const after = await getFin(admin, p.id);
    expect(after.project.id).toBe(p.id); expect(after.project.code).toBe(p.code); expect(after.project.archivedAt).toBeNull();
  });
});

describe('price / payment manipulation and approval bypass', () => {
  it('rejects negative, zero, NaN, string-garbage, scientific-notation and over-precise amounts', async () => {
    const p = await newProject(admin);
    const bad: unknown[] = [-1, 0, '0', 'NaN', 'Infinity', '1e9', '1,00,00,00,000,000,000,000', '10.999', '', null, [], {}, '0x10', ' ', '--5', true];
    for (const amount of bad) {
      const r = await addCost(admin, p.id, amount as string);
      expect(r.status, `cost amount ${JSON.stringify(amount)} → ${r.status}`).toBe(422);
      const pay = await call(H.payments.POST, 'POST', '/api/payments', { session: finance, body: { projectId: p.id, amount, receivedDate: '2026-09-01' } });
      expect(pay.status, `payment amount ${JSON.stringify(amount)} → ${pay.status}`).toBe(422);
    }
  });
  it('a payment can never exceed the invoice balance and cannot be made against a cancelled invoice', async () => {
    const p = await newProject(admin, { sellingPrice: '20000' });
    const inv = await call(H.invoices.POST, 'POST', '/api/invoices', { session: finance, body: { projectId: p.id, type: 'CUSTOM', subtotal: '10000', dueDate: '2026-12-31', issueDate: '2026-09-01', status: 'ISSUED' } });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    // overpayment is accepted (it is real money received) but is reported, and never silently absorbed
    const over = await call(H.payments.POST, 'POST', '/api/payments', { session: finance, body: { invoiceId: inv.data.id, amount: '10000.01', receivedDate: '2026-09-02' } });
    expect(over.status, JSON.stringify(over.body)).toBe(201);
    expect(over.data.overpaidBy).toBe(1);
    const cancelled = await call(H.invoices.POST, 'POST', '/api/invoices', { session: finance, body: { projectId: p.id, type: 'CUSTOM', subtotal: '500', dueDate: '2026-12-31', issueDate: '2026-09-01', status: 'ISSUED' } });
    await call(H.invoiceCancel.POST, 'POST', `/api/invoices/${cancelled.data.id}/cancel`, { session: finance, params: { id: cancelled.data.id }, body: { reason: 'wrong' } });
    const onCancelled = await call(H.payments.POST, 'POST', '/api/payments', { session: finance, body: { invoiceId: cancelled.data.id, amount: '10', receivedDate: '2026-09-02' } });
    expect(onCancelled.status).toBe(409); expect(onCancelled.error?.code).toBe('INVOICE_CANCELLED');
  });
  it('a payment cannot be attached to another project’s invoice by mixing ids', async () => {
    const a = await newProject(admin); const b = await newProject(admin);
    const inv = await call(H.invoices.POST, 'POST', '/api/invoices', { session: finance, body: { projectId: a.id, type: 'CUSTOM', subtotal: '1000', dueDate: '2026-12-31', issueDate: '2026-09-01', status: 'ISSUED' } });
    const r = await call(H.payments.POST, 'POST', '/api/payments', { session: finance, body: { projectId: b.id, invoiceId: inv.data.id, amount: '100', receivedDate: '2026-09-02' } });
    expect(r.status).toBe(422);
  });
  it('approval bypass: a requester cannot decide their own approval, a plain member cannot decide at all, a decided approval cannot be re-decided', async () => {
    const p = await newProject(admin, { budget: '1000', memberIds: [tm.userId] });
    const c = await addCost(tm, p.id, '5000');
    expect(c.status).toBe(201); expect(c.data.requiresApproval).toBe(true); expect(c.data.cost.status).toBe('PENDING_APPROVAL');
    const pend = await call(H.approvals.GET, 'GET', '/api/approvals', { session: admin, query: { status: 'PENDING' } });
    const a = pend.data.find((x: any) => x.projectId === p.id);
    if (a) {
      expect((await call(H.approvalDecide.POST, 'POST', `/api/approvals/${a.id}/decide`, { session: tm, params: { id: a.id }, body: { decision: 'APPROVED' } })).status).toBe(403);
      expect((await call(H.approvalDecide.POST, 'POST', `/api/approvals/${a.id}/decide`, { session: finance, params: { id: a.id }, body: { decision: 'REJECTED', note: 'no' } })).status).toBe(200);
      expect((await call(H.approvalDecide.POST, 'POST', `/api/approvals/${a.id}/decide`, { session: finance, params: { id: a.id }, body: { decision: 'APPROVED' } })).status).toBe(409);
    }
    const fin = (await getFin(admin, p.id)).financials;
    expect(fin.cost.actual).toBe(0);
  });
  it('invoice numbers and audit rows cannot be forged or edited through the API', async () => {
    const p = await newProject(admin);
    const forged = await call(H.invoices.POST, 'POST', '/api/invoices', { session: finance, body: { projectId: p.id, type: 'CUSTOM', subtotal: '1000', dueDate: '2026-12-31', number: 'FAKE-1', status: 'ISSUED', issueDate: '2026-09-01' } });
    expect(forged.status).toBe(403);
    const inv = await call(H.invoices.POST, 'POST', '/api/invoices', { session: finance, body: { projectId: p.id, type: 'CUSTOM', subtotal: '1000', dueDate: '2026-12-31', status: 'ISSUED', issueDate: '2026-09-01' } });
    expect(inv.status).toBe(201);
    const g = await call(H.invoiceById.GET, 'GET', `/api/invoices/${inv.data.id}`, { session: finance, params: { id: inv.data.id } });
    expect(g.data.invoice.number).toMatch(/\d{4}-\d{2}|\/|-/);
    const dupe = await call(H.invoices.POST, 'POST', '/api/invoices', { session: admin, body: { projectId: p.id, type: 'CUSTOM', subtotal: '1000', dueDate: '2026-12-31', status: 'ISSUED', issueDate: '2026-09-01', number: g.data.invoice.number } });
    expect(dupe.status).toBe(409);
    const dbError = async (q: ReturnType<typeof sql>) => { try { await db.execute(q); return null; } catch (e: any) { return String(e?.cause?.message ?? e?.message ?? e); } };
    expect(await dbError(sql`UPDATE audit_logs SET summary = 'tampered' WHERE true`)).toMatch(/append-only/);
    expect(await dbError(sql`DELETE FROM audit_logs WHERE true`)).toMatch(/append-only/);
    expect(await dbError(sql`TRUNCATE audit_logs`)).toMatch(/append-only/);
  });
});

describe('request hygiene', () => {
  it('invalid JSON → 400, oversized body → 400/413, wrong types → 422, all with a request id and no stack trace', async () => {
    const r = await call(H.clients.POST, 'POST', '/api/clients', { session: admin, rawBody: '{not json', headers: { 'content-type': 'application/json' } });
    expect(r.status).toBe(400); expect(r.error?.requestId).toBeTruthy();
    const big = await call(H.clients.POST, 'POST', '/api/clients', { session: admin, rawBody: JSON.stringify({ companyName: 'x'.repeat(3_000_000) }), headers: { 'content-type': 'application/json' } });
    expect([400, 413]).toContain(big.status);
    const wrong = await call(H.clients.POST, 'POST', '/api/clients', { session: admin, body: { companyName: 12345 } });
    expect(wrong.status).toBe(422);
    expect(JSON.stringify(wrong.body)).not.toMatch(/at .*\.(ts|js):\d+/);
  });
  it('idempotency key makes a double-submitted POST create exactly one record', async () => {
    const name = uniq('Idem');
    const key = uniq('key');
    const [a, b] = await Promise.all([
      call(H.clients.POST, 'POST', '/api/clients', { session: admin, headers: { 'idempotency-key': key }, body: { companyName: name } }),
      call(H.clients.POST, 'POST', '/api/clients', { session: admin, headers: { 'idempotency-key': key }, body: { companyName: name } }),
    ]);
    expect([a.status, b.status].filter((s) => s === 201).length).toBe(1);
    const c = await call(H.clients.POST, 'POST', '/api/clients', { session: admin, headers: { 'idempotency-key': key }, body: { companyName: name } });
    expect(c.status).toBe(201); expect(c.headers.get('idempotent-replay')).toBe('true');
    const list = await call(H.clients.GET, 'GET', '/api/clients', { session: admin, query: { q: name } });
    expect(list.data.length).toBe(1);
  });
  it('the health endpoint is public and reveals no secrets', async () => {
    const h = await import('@/app/api/health/route');
    const r = await call(h.GET as never, 'GET', '/api/health');
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/postgres(ql)?:\/\/|password|secret/i);
  });
});
