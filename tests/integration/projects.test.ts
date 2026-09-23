import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { H } from './api';
import { call, makeUser, makeClient, catId, uniq, newProject, getFin, addCost, R, type Session } from './helpers';
import { closeDb } from '@/lib/db';

afterAll(async () => { await closeDb(); });

let admin: Session, pm: Session, viewer: Session, finance: Session, tm: Session;
beforeAll(async () => { admin = await makeUser('SUPER_ADMIN'); pm = await makeUser('PROJECT_MANAGER'); viewer = await makeUser('VIEWER'); finance = await makeUser('FINANCE'); tm = await makeUser('TEAM_MEMBER'); });

const post = (body: Record<string, unknown>, s = admin) => call(H.projects.POST, 'POST', '/api/projects', { session: s, body });

describe('project creation validation (spec §47 edge cases)', () => {
  it('rejects empty name, missing client/service, negative price, negative discount', async () => {
    const client = await makeClient(); const svc = await catId('SERVICE');
    const base = { name: 'X', clientId: client.id, serviceId: svc, type: 'ONE_TIME', sellingPrice: '1000' };
    expect((await post({ ...base, name: '   ' })).status).toBe(422);
    expect((await post({ ...base, clientId: undefined })).status).toBe(422);
    expect((await post({ ...base, serviceId: undefined })).status).toBe(422);
    expect((await post({ ...base, sellingPrice: '-5' })).status).toBe(422);
    expect((await post({ ...base, discount: '-1' })).status).toBe(422);
    expect((await post({ ...base, sellingPrice: 'abc' })).status).toBe(422);
    expect((await post({ ...base, sellingPrice: null })).status).toBe(422);
    expect((await post({ ...base, sellingPrice: { x: 1 } })).status).toBe(422);
    expect((await post({ ...base, sellingPrice: '-5' })).status).toBe(422);
    expect((await post({ ...base, type: 'NOPE' })).status).toBe(422);
  });
  it('rejects end date before start date', async () => {
    const r = await post({ name: 'D', clientId: (await makeClient()).id, serviceId: await catId('SERVICE'), type: 'ONE_TIME', startDate: '2026-05-10', endDate: '2026-05-01' });
    expect(r.status).toBe(422); expect(r.error?.message).toMatch(/end date/i);
  });
  it('rejects a discount larger than the price', async () => {
    const r = await post({ name: 'D', clientId: (await makeClient()).id, serviceId: await catId('SERVICE'), type: 'ONE_TIME', sellingPrice: '1000', discount: '2000' });
    expect(r.status).toBe(422);
  });
  it('rejects unknown and archived clients', async () => {
    const svc = await catId('SERVICE');
    expect((await post({ name: 'N', clientId: '11111111-1111-4111-8111-111111111111', serviceId: svc, type: 'ONE_TIME' })).status).toBe(422);
    const c = await makeClient();
    await call(H.clientArchive.POST, 'POST', `/api/clients/${c.id}/archive`, { session: admin, params: { id: c.id } });
    const r = await post({ name: 'N', clientId: c.id, serviceId: svc, type: 'ONE_TIME' });
    expect(r.status).toBe(422); expect(r.error?.code).toBe('CLIENT_ARCHIVED');
  });
  it('category budgets may not exceed the project budget', async () => {
    const r = await post({ name: 'B', clientId: (await makeClient()).id, serviceId: await catId('SERVICE'), type: 'ONE_TIME', sellingPrice: '1000', budget: '100', categoryBudgets: [{ categoryId: await catId('COST', 'Developer'), amount: '200' }] });
    expect(r.status).toBe(422);
  });
  it('generates unique sequential project codes under concurrency', async () => {
    const client = await makeClient(); const svc = await catId('SERVICE');
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => post({ name: `P${i}`, clientId: client.id, serviceId: svc, type: 'ONE_TIME' })));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(new Set(rs.map((r) => r.data.code)).size).toBe(8);
  });
  it('a zero-price project works and has no divide-by-zero (margin is null, not NaN)', async () => {
    const p = await newProject(admin, { sellingPrice: '0', budget: '0' });
    const d = await getFin(admin, p.id);
    expect(d.financials.revenue.revenue).toBe(0);
    expect(d.financials.profit.grossMarginPct).toBeNull();
    expect(d.financials.budget.state).not.toBe('EXCEEDED');
  });
  it('MILESTONE type takes revenue from milestone prices; FIXED_RECURRING from setup + monthly × months', async () => {
    const ms = await post({ name: 'M', clientId: (await makeClient()).id, serviceId: await catId('SERVICE'), type: 'MILESTONE', status: 'ACTIVE', taxMode: 'NONE', milestones: [{ name: 'A', price: '30000' }, { name: 'B', price: '20000' }] });
    expect((await getFin(admin, ms.data.id)).financials.revenue.revenue).toBe(R(50000));
    const fr = await post({ name: 'F', clientId: (await makeClient()).id, serviceId: await catId('SERVICE'), type: 'FIXED_RECURRING', status: 'ACTIVE', taxMode: 'NONE', setupFee: '10000', monthlyFee: '5000', durationMonths: 12 });
    expect((await getFin(admin, fr.data.id)).financials.revenue.revenue).toBe(R(70000));
    expect((await post({ name: 'F2', clientId: (await makeClient()).id, serviceId: await catId('SERVICE'), type: 'FIXED_RECURRING', monthlyFee: '0' })).status).toBe(422);
  });
  it('GST exclusive adds 18% on top; inclusive extracts it from the price', async () => {
    const ex = await newProject(admin, { taxMode: 'EXCLUSIVE', taxRatePct: 18, sellingPrice: '100000' });
    const f1 = (await getFin(admin, ex.id)).financials.revenue;
    expect(f1.revenue).toBe(R(100000)); expect(f1.tax).toBe(R(18000)); expect(f1.total).toBe(R(118000));
    const inc = await newProject(admin, { taxMode: 'INCLUSIVE', taxRatePct: 18, sellingPrice: '118000' });
    const f2 = (await getFin(admin, inc.id)).financials.revenue;
    expect(f2.revenue).toBe(R(100000)); expect(f2.tax).toBe(R(18000)); expect(f2.total).toBe(R(118000));
  });
});

describe('project lifecycle', () => {
  it('optimistic concurrency: a stale edit is rejected with 409', async () => {
    const p = await newProject(admin);
    const d = await getFin(admin, p.id);
    const v = d.project.version;
    const a = await call(H.projectById.PATCH, 'PATCH', `/api/projects/${p.id}`, { session: admin, params: { id: p.id }, body: { name: 'first edit', version: v } });
    expect(a.status).toBe(200);
    const b = await call(H.projectById.PATCH, 'PATCH', `/api/projects/${p.id}`, { session: admin, params: { id: p.id }, body: { name: 'stale edit', version: v } });
    expect(b.status).toBe(409); expect(b.error?.code).toBe('STALE_VERSION');
  });
  it('status changes are audited; cancelling needs a reason and voids scheduled invoices but keeps issued ones', async () => {
    const p = await newProject(admin, { sellingPrice: '100000' });
    await call(H.projectSchedule.POST, 'POST', `/api/projects/${p.id}/schedule`, { session: admin, params: { id: p.id }, body: { items: [{ type: 'ADVANCE', pct: 50, dueDate: '2026-10-01' }, { type: 'FINAL', pct: 50, dueDate: '2026-12-01' }] } });
    const noReason = await call(H.projectStatus.POST, 'POST', `/api/projects/${p.id}/status`, { session: admin, params: { id: p.id }, body: { status: 'CANCELLED' } });
    expect(noReason.status).toBe(422);
    const ok = await call(H.projectStatus.POST, 'POST', `/api/projects/${p.id}/status`, { session: admin, params: { id: p.id }, body: { status: 'CANCELLED', reason: 'Client withdrew' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const inv = await call(H.invoices.GET, 'GET', '/api/invoices', { session: admin, query: { projectId: p.id } });
    expect(inv.data.every((i: any) => i.status === 'CANCELLED')).toBe(true);
    // a cancelled project cannot be invoiced (new billing), but real wind-up spend can still be recorded
    const newInv = await call(H.invoices.POST, 'POST', '/api/invoices', { session: admin, body: { projectId: p.id, type: 'CUSTOM', subtotal: '1000', dueDate: '2026-12-31' } });
    expect(newInv.status).toBe(422); expect(newInv.error?.code).toBe('PROJECT_NOT_BILLABLE');
    expect((await addCost(admin, p.id, '10')).status).toBe(201);
  });
  it('cancellation by a non-approver becomes an approval request; approver decides', async () => {
    const p = await newProject(admin);
    const pmp = await call(H.projectById.PATCH, 'PATCH', `/api/projects/${p.id}`, { session: admin, params: { id: p.id }, body: { managerId: pm.userId } });
    expect(pmp.status).toBe(200);
    const r = await call(H.projectStatus.POST, 'POST', `/api/projects/${p.id}/status`, { session: pm, params: { id: p.id }, body: { status: 'CANCELLED', reason: 'Not needed' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.data.pendingApproval).toBe(true);
    expect((await getFin(admin, p.id)).project.status).toBe('ACTIVE');
    const list = await call(H.approvals.GET, 'GET', '/api/approvals', { session: finance, query: { status: 'PENDING' } });
    const a = list.data.find((x: any) => x.projectId === p.id && x.type === 'PROJECT_CANCELLATION');
    expect(a).toBeTruthy();
    expect((await call(H.approvalDecide.POST, 'POST', `/api/approvals/${a.id}/decide`, { session: finance, params: { id: a.id }, body: { decision: 'APPROVED' } })).status).toBe(200);
    expect((await getFin(admin, p.id)).project.status).toBe('CANCELLED');
  });
  it('archive hides from default list, restore brings it back; archived projects reject costs', async () => {
    const p = await newProject(admin, { name: uniq('ArchiveMe') });
    expect((await call(H.projectArchive.POST, 'POST', `/api/projects/${p.id}/archive`, { session: admin, params: { id: p.id } })).status).toBe(200);
    const list = await call(H.projects.GET, 'GET', '/api/projects', { session: admin, query: { pageSize: 200 } });
    expect(list.data.find((x: any) => x.id === p.id)).toBeUndefined();
    const r = await addCost(admin, p.id, '100');
    expect(r.status).toBe(422); expect(r.error?.code).toBe('PROJECT_ARCHIVED');
    await call(H.projectRestore.POST, 'POST', `/api/projects/${p.id}/restore`, { session: admin, params: { id: p.id } });
    expect((await addCost(admin, p.id, '100')).status).toBe(201);
  });
  it('budget increase by a non-approver needs approval; a budget lower than spend is allowed but shows EXCEEDED', async () => {
    const p = await newProject(admin, { budget: '50000', managerId: pm.userId });
    const r = await call(H.projectBudgets.PUT, 'PUT', `/api/projects/${p.id}/budgets`, { session: pm, params: { id: p.id }, body: { budget: '80000' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.data.pendingApproval).toBe(true);
    expect((await getFin(admin, p.id)).financials.budget.budget).toBe(R(50000));
    // a PM may not lower budgets or edit category budgets directly
    const pmLower = await call(H.projectBudgets.PUT, 'PUT', `/api/projects/${p.id}/budgets`, { session: pm, params: { id: p.id }, body: { budget: '10000' } });
    expect(pmLower.status).toBe(403);
    await addCost(admin, p.id, '40000');
    const lower = await call(H.projectBudgets.PUT, 'PUT', `/api/projects/${p.id}/budgets`, { session: admin, params: { id: p.id }, body: { budget: '30000' } });
    expect(lower.status).toBe(200);
    expect((await getFin(admin, p.id)).financials.budget.state).toBe('EXCEEDED');
  });
});

describe('milestones, adjustments, resources', () => {
  it('milestone CRUD with payment status derived from invoices', async () => {
    const p = await newProject(admin, { type: 'MILESTONE', sellingPrice: '0', milestones: [{ name: 'Design', price: '40000' }] });
    const d = await getFin(admin, p.id);
    const m = d.milestones[0];
    expect(m.payment.status).toBe('NOT_INVOICED');
    const inv = await call(H.invoices.POST, 'POST', '/api/invoices', { session: finance, body: { projectId: p.id, type: 'MILESTONE', milestoneId: m.id, subtotal: '40000', dueDate: '2026-12-01' } });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect((await getFin(admin, p.id)).milestones[0].payment.status).toBe('INVOICED');
    await call(H.payments.POST, 'POST', '/api/payments', { session: finance, body: { invoiceId: inv.data.id, amount: '20000', receivedDate: '2026-09-02' } });
    expect((await getFin(admin, p.id)).milestones[0].payment.status).toBe('PARTIALLY_PAID');
    const del = await call(H.milestoneById.DELETE, 'DELETE', `/api/milestones/${m.id}`, { session: admin, params: { id: m.id } });
    expect(del.status).toBe(409);
    const price = await call(H.milestoneById.PATCH, 'PATCH', `/api/milestones/${m.id}`, { session: admin, params: { id: m.id }, body: { price: '50000' } });
    expect(price.status).toBe(409);
  });
  it('revenue adjustments (scope change / credit note) change contract value; zero is rejected', async () => {
    const p = await newProject(admin, { sellingPrice: '100000' });
    const up = await call(H.projectAdjustments.POST, 'POST', `/api/projects/${p.id}/adjustments`, { session: admin, params: { id: p.id }, body: { amount: '25000', reason: 'Extra module', date: '2026-09-01' } });
    expect(up.status).toBe(201);
    expect((await getFin(admin, p.id)).financials.revenue.revenue).toBe(R(125000));
    const down = await call(H.projectAdjustments.POST, 'POST', `/api/projects/${p.id}/adjustments`, { session: admin, params: { id: p.id }, body: { amount: '-5000', reason: 'Credit note', date: '2026-09-02' } });
    expect(down.status).toBe(201);
    expect((await getFin(admin, p.id)).financials.revenue.revenue).toBe(R(120000));
    expect((await call(H.projectAdjustments.POST, 'POST', `/api/projects/${p.id}/adjustments`, { session: admin, params: { id: p.id }, body: { amount: '0', reason: 'x', date: '2026-09-02' } })).status).toBe(422);
    await call(H.adjustmentById.DELETE, 'DELETE', `/api/adjustments/${up.data.id}`, { session: admin, params: { id: up.data.id } });
    expect((await getFin(admin, p.id)).financials.revenue.revenue).toBe(R(95000));
  });
  it('freelancer hours cost = hours × snapshot rate; changing the rate later does not rewrite history; employees are NOT double counted', async () => {
    const { makeResource } = await import('./helpers');
    const p = await newProject(admin, { budget: '100000' });
    const f = await makeResource({ type: 'FREELANCER', hourlyCost: '500', billingRate: '1000' });
    const a = await call(H.projectResources.POST, 'POST', `/api/projects/${p.id}/resources`, { session: admin, params: { id: p.id }, body: { resourceId: f.id, plannedHours: 100, actualHours: 40 } });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(R(20000));
    await call(H.resourceById.PATCH, 'PATCH', `/api/resources/${f.id}`, { session: admin, params: { id: f.id }, body: { hourlyCost: '900', version: 1 } });
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(R(20000));
    const dup = await call(H.projectResources.POST, 'POST', `/api/projects/${p.id}/resources`, { session: admin, params: { id: p.id }, body: { resourceId: f.id } });
    expect(dup.status).toBe(409);
    const emp = await makeResource({ type: 'EMPLOYEE', hourlyCost: '600', monthlyCost: '96000' });
    const e = await call(H.projectResources.POST, 'POST', `/api/projects/${p.id}/resources`, { session: admin, params: { id: p.id }, body: { resourceId: emp.id, plannedHours: 50, actualHours: 50 } });
    expect(e.status).toBe(201);
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(R(20000)); // employee hours add no cost by themselves
    const over = await call(H.projectResourceById.PATCH, 'PATCH', `/api/project-resources/${a.data.id}`, { session: admin, params: { id: a.data.id }, body: { actualHours: 500 } });
    expect(over.status).toBe(422); expect(over.error?.code).toBe('BUDGET_WOULD_BE_EXCEEDED');
  });
});

describe('row-level access and redaction', () => {
  it('a team member only sees assigned projects; others are 404 (no existence leak)', async () => {
    const mine = await newProject(admin, { name: uniq('Mine') });
    const other = await newProject(admin, { name: uniq('Other') });
    await call(H.projectById.PATCH, 'PATCH', `/api/projects/${mine.id}`, { session: admin, params: { id: mine.id }, body: { memberIds: [tm.userId] } });
    expect((await call(H.projectById.GET, 'GET', `/api/projects/${mine.id}`, { session: tm, params: { id: mine.id } })).status).toBe(200);
    expect((await call(H.projectById.GET, 'GET', `/api/projects/${other.id}`, { session: tm, params: { id: other.id } })).status).toBe(404);
    const list = await call(H.projects.GET, 'GET', '/api/projects', { session: tm, query: { pageSize: 200 } });
    expect(list.data.every((x: any) => x.id !== other.id)).toBe(true);
    expect((await call(H.costs.POST, 'POST', '/api/costs', { session: tm, body: { projectId: other.id, name: 'x', categoryId: await catId('COST'), amount: '1', date: '2026-09-01' } })).status).toBe(404);
  });
  it('PM (no profit.view) never receives revenue/profit/receivables fields', async () => {
    const p = await newProject(admin, { managerId: pm.userId, sellingPrice: '90000' });
    const d = await getFin(pm, p.id);
    expect(d.financials.revenue).toBeUndefined(); expect(d.financials.profit).toBeUndefined(); expect(d.financials.receivables).toBeUndefined();
    expect(d.financials.cost).toBeDefined();
    expect(JSON.stringify(d)).not.toContain('90000');
    const pricing = await call(H.projectById.PATCH, 'PATCH', `/api/projects/${p.id}`, { session: pm, params: { id: p.id }, body: { sellingPrice: '1' } });
    expect(pricing.status).toBe(403);
  });
  it('viewer is read-only', async () => {
    const p = await newProject(admin);
    expect((await call(H.projectById.PATCH, 'PATCH', `/api/projects/${p.id}`, { session: viewer, params: { id: p.id }, body: { name: 'hack' } })).status).toBe(403);
    expect((await addCost(viewer, p.id, '5')).status).toBe(403);
  });
});
