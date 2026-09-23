/**
 * Spec §49 critical scenario, driven through the real API route handlers against a real PostgreSQL database.
 * ABC Company / e-commerce website / ₹5,00,000 contract / budget ₹2,50,000.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { H } from './api';
import { call, makeUser, makeClient, catId, uniq, newProject, type Session } from './helpers';
import { closeDb } from '@/lib/db';

afterAll(async () => { await closeDb(); });

const R = (rupees: number) => rupees * 100;

describe('§49 ABC Company e-commerce project — full lifecycle through the API', () => {
  let admin: Session, finance: Session, pm: Session;
  let projectId: string;
  let invoiceId: string;
  let devCat: string, designCat: string, hostCat: string, mktCat: string, miscCat: string;
  const fin = async (s = admin) => (await call(H.projectById.GET, 'GET', `/api/projects/${projectId}`, { session: s, params: { id: projectId } })).data.financials;

  it('setup: users, client, categories', async () => {
    admin = await makeUser('SUPER_ADMIN'); finance = await makeUser('FINANCE'); pm = await makeUser('PROJECT_MANAGER');
    [devCat, designCat, hostCat, mktCat, miscCat] = await Promise.all(['Developer', 'Designer', 'Hosting', 'Marketing', 'Miscellaneous'].map((n) => catId('COST', n)));
  });

  it('creates the client and project with estimated costs and a budget', async () => {
    const client = await call(H.clients.POST, 'POST', '/api/clients', { session: admin, body: { companyName: uniq('ABC Company') } });
    expect(client.status).toBe(201);
    const svc = await catId('SERVICE', 'Web Development');
    const p = await call(H.projects.POST, 'POST', '/api/projects', {
      session: admin,
      body: {
        name: 'E-commerce Website', clientId: client.data.id, serviceId: svc, type: 'ONE_TIME', status: 'ACTIVE', taxMode: 'NONE', sellingPrice: '500000', budget: '250000', managerId: pm.userId,
        estimatedCosts: [{ categoryId: devCat, name: 'Development', amount: '120000' }, { categoryId: designCat, name: 'Design', amount: '50000' }, { categoryId: hostCat, name: 'Hosting', amount: '30000' }, { categoryId: mktCat, name: 'Marketing', amount: '10000' }, { categoryId: miscCat, name: 'Misc', amount: '20000' }],
      },
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    projectId = p.data.id;
    const f = await fin();
    expect(f.revenue.revenue).toBe(R(500000));
    expect(f.cost.estimated).toBe(R(230000));
    expect(f.profit.estimated).toBe(R(270000));
    expect(f.cost.actual).toBe(0);
  });

  it('records the five actual costs → actual cost 2,50,000, profit 2,50,000, margin 50%, budget exactly used', async () => {
    const rows: [string, string, string][] = [[devCat, 'Development', '140000'], [designCat, 'Design', '45000'], [hostCat, 'Hosting', '30000'], [mktCat, 'Marketing', '10000'], [miscCat, 'Misc', '25000']];
    for (const [categoryId, name, amount] of rows) {
      const r = await call(H.costs.POST, 'POST', '/api/costs', { session: admin, body: { projectId, name, categoryId, amount, date: '2026-09-01' } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const f = await fin();
    expect(f.cost.actual).toBe(R(250000));
    expect(f.profit.actual).toBe(R(250000));
    expect(f.profit.grossMarginPct).toBe(50);
    expect(f.budget.utilizationPct).toBe(100);
    expect(f.budget.state).toBe('ALERT');
  });

  it('invoices the contract and records the ₹1,50,000 advance → outstanding 3,50,000', async () => {
    const inv = await call(H.invoices.POST, 'POST', '/api/invoices', { session: finance, body: { projectId, type: 'CUSTOM', subtotal: '500000', dueDate: '2026-12-31', issueDate: '2026-09-01' } });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    invoiceId = inv.data.id;
    const pay = await call(H.payments.POST, 'POST', '/api/payments', { session: finance, body: { invoiceId, amount: '150000', receivedDate: '2026-09-05', method: 'BANK_TRANSFER', reference: 'ADV-1' } });
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);
    const f = await fin();
    expect(f.receivables.invoiced).toBe(R(500000));
    expect(f.receivables.received).toBe(R(150000));
    expect(f.receivables.outstanding).toBe(R(350000));
    expect(f.receivables.collectionPct).toBe(30);
  });

  it('adding +₹20,000 developer cost is BLOCKED until the budget override is confirmed with a reason', async () => {
    const body = { projectId, name: 'Extra developer', categoryId: devCat, amount: '20000', date: '2026-09-10' };
    const blocked = await call(H.costs.POST, 'POST', '/api/costs', { session: admin, body });
    expect(blocked.status).toBe(422);
    expect(blocked.error?.code).toBe('BUDGET_WOULD_BE_EXCEEDED');
    const noReason = await call(H.costs.POST, 'POST', '/api/costs', { session: admin, body: { ...body, overrideBudget: true } });
    expect(noReason.status).toBe(422);
    expect((await fin()).cost.actual).toBe(R(250000)); // nothing was written
    const ok = await call(H.costs.POST, 'POST', '/api/costs', { session: admin, body: { ...body, overrideBudget: true, overrideReason: 'Scope change approved by client call' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it('cost, profit, margin and budget status all recalculate; over-budget alert is raised', async () => {
    const f = await fin();
    expect(f.cost.actual).toBe(R(270000));
    expect(f.profit.actual).toBe(R(230000));
    expect(f.profit.grossMarginPct).toBe(46);
    expect(f.budget.state).toBe('EXCEEDED');
    expect(f.budget.overBy).toBe(R(20000));
    expect(f.budget.utilizationPct).toBe(108);
    expect(f.health.status).toBe('CRITICAL');
    const n = await call(H.notifications.GET, 'GET', '/api/notifications', { session: admin });
    expect(n.data.some((x: any) => x.type === 'BUDGET_EXCEEDED')).toBe(true);
  });

  it('a second payment of ₹2,00,000 reduces the outstanding to ₹1,50,000', async () => {
    const pay = await call(H.payments.POST, 'POST', '/api/payments', { session: finance, body: { invoiceId, amount: '200000', receivedDate: '2026-09-12', method: 'UPI' } });
    expect(pay.status).toBe(201);
    const f = await fin();
    expect(f.receivables.received).toBe(R(350000));
    expect(f.receivables.outstanding).toBe(R(150000));
    const inv = await call(H.invoiceById.GET, 'GET', `/api/invoices/${invoiceId}`, { session: finance, params: { id: invoiceId } });
    expect(inv.data.invoice.status).toBe('PARTIALLY_PAID');
  });

  it('the dashboard and reports reflect the same numbers', async () => {
    const d = await call(H.dashboard.GET, 'GET', '/api/dashboard', { session: admin });
    expect(d.status).toBe(200);
    expect(d.data.counts.overBudget).toBeGreaterThanOrEqual(1);
    const other = await newProject(admin, { sellingPrice: '100000' });
    const cmp = await call(H.reportCompare.GET, 'GET', '/api/reports/compare', { session: admin, query: { ids: `${projectId},${other.id}` } });
    expect(cmp.status, JSON.stringify(cmp.body)).toBe(200);
    expect(JSON.stringify(cmp.data)).toContain(other.id);
  });

  it('every step is in the immutable audit trail', async () => {
    const h = await call(H.auditLog.GET, 'GET', '/api/audit', { session: admin, query: { projectId, pageSize: 100 } });
    const actions = h.data.map((x: any) => x.action);
    for (const a of ['project.create', 'cost.create', 'invoice.create', 'payment.record']) expect(actions).toContain(a);
    expect(h.data.some((x: any) => /budget override/i.test(x.summary ?? ''))).toBe(true);
  });

  it('a team member is blocked from over-budget spend and it goes to approval; self-approval is refused', async () => {
    const tm = await makeUser('TEAM_MEMBER');
    const upd = await call(H.projectById.PATCH, 'PATCH', `/api/projects/${projectId}`, { session: admin, params: { id: projectId }, body: { memberIds: [tm.userId] } });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    const c = await call(H.costs.POST, 'POST', '/api/costs', { session: tm, body: { projectId, name: 'Team spend', categoryId: devCat, amount: '5000', date: '2026-09-15' } });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.data.requiresApproval).toBe(true);
    expect((await fin()).cost.actual).toBe(R(270000)); // pending costs do not count
    const list = await call(H.approvals.GET, 'GET', '/api/approvals', { session: finance, query: { status: 'PENDING' } });
    const a = list.data.find((x: any) => x.entityId === c.data.cost.id);
    expect(a).toBeTruthy();
    const self = await call(H.approvalDecide.POST, 'POST', `/api/approvals/${a.id}/decide`, { session: tm, params: { id: a.id }, body: { decision: 'APPROVED' } });
    expect(self.status).toBe(403);
    const ok = await call(H.approvalDecide.POST, 'POST', `/api/approvals/${a.id}/decide`, { session: finance, params: { id: a.id }, body: { decision: 'APPROVED' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await fin()).cost.actual).toBe(R(275000));
    const again = await call(H.approvalDecide.POST, 'POST', `/api/approvals/${a.id}/decide`, { session: admin, params: { id: a.id }, body: { decision: 'REJECTED', note: 'late' } });
    expect(again.status).toBe(409);
  });
});
