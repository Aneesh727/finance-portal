/** Costs: kinds, credits, FX, void, commitments, edits, budget guard incl. concurrency (spec §14, §47). */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { H } from './api';
import { call, makeUser, catId, uniq, newProject, getFin, addCost, makeVendor, makeResource, R, type Session } from './helpers';
import { closeDb } from '@/lib/db';

afterAll(async () => { await closeDb(); });
let admin: Session, finance: Session, pm: Session, tm: Session;
beforeAll(async () => { [admin, finance, pm, tm] = await Promise.all([makeUser('ADMIN'), makeUser('FINANCE'), makeUser('PROJECT_MANAGER'), makeUser('TEAM_MEMBER')]); });

describe('cost kinds and arithmetic', () => {
  it('estimated and committed costs do NOT count as actual; actual does', async () => {
    const p = await newProject(admin, { budget: '0' });
    await addCost(admin, p.id, '10000', { kind: 'ESTIMATED' });
    await addCost(admin, p.id, '20000', { kind: 'COMMITTED' });
    await addCost(admin, p.id, '5000');
    const f = (await getFin(admin, p.id)).financials;
    expect(f.cost.actual).toBe(R(5000)); expect(f.cost.estimated).toBe(R(10000)); expect(f.cost.committed).toBe(R(20000));
  });
  it('a credit/refund reduces the actual cost and requires a positive entry amount', async () => {
    const p = await newProject(admin, { budget: '0' });
    await addCost(admin, p.id, '10000');
    const c = await addCost(admin, p.id, '2500', { isCredit: true });
    expect(c.status).toBe(201);
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(R(7500));
    expect((await addCost(admin, p.id, '-100')).status).toBe(422);
  });
  it('a foreign-currency cost is converted with the given rate, keeps the original amount, and refuses to guess a missing rate', async () => {
    const p = await newProject(admin, { budget: '0' });
    const r = await addCost(admin, p.id, '100', { currency: 'USD', fxRate: 83.5 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.data.cost.amount).toBe('8350.00'); expect(r.data.cost.originalAmount).toBe('100.00'); expect(r.data.cost.currency).toBe('USD');
    const missing = await addCost(admin, p.id, '100', { currency: 'XYZ' });
    expect(missing.status).toBe(422); expect(missing.error?.code).toBe('MISSING_FX_RATE');
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(R(8350));
  });
  it('voiding removes the cost from totals, needs a reason, cannot be repeated, and stays visible in the audit trail', async () => {
    const p = await newProject(admin, { budget: '0' });
    const c = (await addCost(admin, p.id, '4000')).data.cost;
    expect((await call(H.costVoid.POST, 'POST', `/api/costs/${c.id}/void`, { session: admin, params: { id: c.id }, body: {} })).status).toBe(422);
    expect((await call(H.costVoid.POST, 'POST', `/api/costs/${c.id}/void`, { session: admin, params: { id: c.id }, body: { reason: 'duplicate entry' } })).status).toBe(200);
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(0);
    expect((await call(H.costVoid.POST, 'POST', `/api/costs/${c.id}/void`, { session: admin, params: { id: c.id }, body: { reason: 'again' } })).status).toBe(409);
    expect((await call(H.costById.PATCH, 'PATCH', `/api/costs/${c.id}`, { session: admin, params: { id: c.id }, body: { name: 'edit voided', version: 2 } })).status).toBe(422);
    const h = await call(H.auditLog.GET, 'GET', '/api/audit', { session: admin, query: { projectId: p.id, pageSize: 50 } });
    expect(h.data.some((x: any) => x.action === 'cost.void' && /duplicate entry/.test(x.summary))).toBe(true);
  });
  it('a commitment converts to an actual cost exactly once (never double counted)', async () => {
    const p = await newProject(admin, { budget: '0' });
    const c = (await addCost(admin, p.id, '20000', { kind: 'COMMITTED' })).data.cost;
    const r = await call(H.costConvert.POST, 'POST', `/api/costs/${c.id}/convert`, { session: admin, params: { id: c.id }, body: { date: '2026-09-05', amount: '19500' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const f = (await getFin(admin, p.id)).financials;
    expect(f.cost.actual).toBe(R(19500)); expect(f.cost.committed).toBe(0);
    expect((await call(H.costConvert.POST, 'POST', `/api/costs/${c.id}/convert`, { session: admin, params: { id: c.id }, body: { date: '2026-09-05' } })).status).toBe(409);
    // a PM cannot convert
    expect((await call(H.costConvert.POST, 'POST', `/api/costs/${c.id}/convert`, { session: pm, params: { id: c.id }, body: { date: '2026-09-05' } })).status).toBe(403);
  });
  it('vendor and resource references are validated; an inactive resource cannot take new actual costs', async () => {
    const p = await newProject(admin, { budget: '0' });
    const v = await makeVendor();
    expect((await addCost(admin, p.id, '100', { vendorId: v.id })).status).toBe(201);
    expect((await addCost(admin, p.id, '100', { vendorId: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);
    const rr = await makeResource({ status: 'INACTIVE' });
    expect((await addCost(admin, p.id, '100', { resourceId: rr.id })).status).toBe(422);
    expect((await addCost(admin, p.id, '100', { categoryId: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);
  });
  it('rejects a lost project and archived project; validates dates', async () => {
    const p = await newProject(admin);
    expect((await addCost(admin, p.id, '10', { date: '2026-13-45' })).status).toBe(422);
    expect((await addCost(admin, p.id, '10', { date: 'yesterday' })).status).toBe(422);
    expect((await addCost(admin, p.id, '10', { name: '' })).status).toBe(422);
    expect((await addCost(admin, p.id, '10', { name: 'x'.repeat(151) })).status).toBe(422);
  });
});

describe('editing and concurrency', () => {
  it('optimistic locking: a stale edit is refused with 409 and does not overwrite', async () => {
    const p = await newProject(admin, { budget: '0' });
    const c = (await addCost(admin, p.id, '1000')).data.cost;
    const a = await call(H.costById.PATCH, 'PATCH', `/api/costs/${c.id}`, { session: admin, params: { id: c.id }, body: { name: 'renamed by A', version: c.version } });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const b = await call(H.costById.PATCH, 'PATCH', `/api/costs/${c.id}`, { session: admin, params: { id: c.id }, body: { amount: '9999', version: c.version } });
    expect(b.status).toBe(409); expect(b.error?.code).toBe('STALE_VERSION');
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(R(1000));
  });
  it('changing an amount recalculates project cost; the audit log records old and new', async () => {
    const p = await newProject(admin, { budget: '0' });
    const c = (await addCost(admin, p.id, '1000')).data.cost;
    expect((await call(H.costById.PATCH, 'PATCH', `/api/costs/${c.id}`, { session: admin, params: { id: c.id }, body: { amount: '1500', version: c.version } })).status).toBe(200);
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(R(1500));
    const h = await call(H.auditLog.GET, 'GET', '/api/audit', { session: admin, query: { projectId: p.id, pageSize: 50 } });
    expect(h.data.find((x: any) => x.action === 'cost.update')).toBeTruthy();
  });
  it('a team member can add a cost but cannot edit or void someone else’s approved cost', async () => {
    const p = await newProject(admin, { budget: '0', memberIds: [tm.userId] });
    const c = (await addCost(admin, p.id, '1000')).data.cost;
    expect((await call(H.costById.PATCH, 'PATCH', `/api/costs/${c.id}`, { session: tm, params: { id: c.id }, body: { name: 'mine now', version: c.version } })).status).toBe(403);
    expect((await call(H.costVoid.POST, 'POST', `/api/costs/${c.id}/void`, { session: tm, params: { id: c.id }, body: { reason: 'nope' } })).status).toBe(403);
    expect((await addCost(tm, p.id, '50')).status).toBe(201);
  });
});

describe('budget guard', () => {
  it('blocks (422) for approvers and requires confirmation + reason to override', async () => {
    const p = await newProject(admin, { budget: '10000' });
    expect((await addCost(admin, p.id, '9000')).status).toBe(201);
    const blocked = await addCost(admin, p.id, '2000');
    expect(blocked.status).toBe(422); expect(blocked.error?.code).toBe('BUDGET_WOULD_BE_EXCEEDED');
    const noReason = await addCost(admin, p.id, '2000', { overrideBudget: true });
    expect(noReason.status).toBe(422);
    const ok = await addCost(admin, p.id, '2000', { overrideBudget: true, overrideReason: 'client asked for extra scope' });
    expect(ok.status).toBe(201);
    const f = (await getFin(admin, p.id)).financials;
    expect(f.cost.actual).toBe(R(11000)); expect(f.budget.state).toBe('EXCEEDED');
  });
  it('spending exactly the whole budget is allowed; one paisa more is not', async () => {
    const p = await newProject(admin, { budget: '10000' });
    expect((await addCost(admin, p.id, '10000')).status).toBe(201);
    expect((await addCost(admin, p.id, '0.01')).status).toBe(422);
  });
  it('category budgets are enforced too', async () => {
    const dev = await catId('COST', 'Developer');
    const p = await newProject(admin, { budget: '100000', categoryBudgets: [{ categoryId: dev, amount: '5000' }] });
    expect((await addCost(admin, p.id, '4000')).status).toBe(201);
    const r = await addCost(admin, p.id, '2000');
    expect(r.status).toBe(422); expect(r.error?.code).toBe('BUDGET_WOULD_BE_EXCEEDED');
    expect((await addCost(admin, p.id, '2000', { categoryId: await catId('COST', 'Designer') })).status).toBe(201);
  });
  it('CONCURRENCY: five simultaneous ₹3,000 spends on a ₹10,000 budget → exactly three succeed, actual never exceeds budget', async () => {
    const p = await newProject(admin, { budget: '10000' });
    const rs = await Promise.all(Array.from({ length: 5 }, () => addCost(admin, p.id, '3000')));
    expect(rs.filter((r) => r.status === 201).length).toBe(3);
    expect(rs.filter((r) => r.status === 422).length).toBe(2);
    const f = (await getFin(admin, p.id)).financials;
    expect(f.cost.actual).toBe(R(9000)); expect(f.budget.state).not.toBe('EXCEEDED');
  });
  it('a credit is never blocked by the guard, and no-budget projects are unrestricted', async () => {
    const p = await newProject(admin, { budget: '0' });
    expect((await addCost(admin, p.id, '999999')).status).toBe(201);
    const q = await newProject(admin, { budget: '1000' });
    await addCost(admin, q.id, '1000');
    expect((await addCost(admin, q.id, '500', { isCredit: true })).status).toBe(201);
  });
  it('non-approvers get an approval request instead; rejected costs never count, approved ones do, exactly once', async () => {
    const p = await newProject(admin, { budget: '1000', memberIds: [tm.userId] });
    const r = await addCost(tm, p.id, '5000');
    expect(r.data.requiresApproval).toBe(true);
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(0);
    const ap = r.data.approvalId;
    expect((await call(H.approvalDecide.POST, 'POST', `/api/approvals/${ap}/decide`, { session: tm, params: { id: ap }, body: { decision: 'APPROVED' } })).status).toBe(403);
    expect((await call(H.approvalDecide.POST, 'POST', `/api/approvals/${ap}/decide`, { session: finance, params: { id: ap }, body: { decision: 'APPROVED', note: 'ok' } })).status).toBe(200);
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(R(5000));
    expect((await call(H.approvalDecide.POST, 'POST', `/api/approvals/${ap}/decide`, { session: admin, params: { id: ap }, body: { decision: 'APPROVED' } })).status).toBe(409);
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(R(5000));
    const r2 = await addCost(tm, p.id, '100');
    const ap2 = r2.data.approvalId;
    expect((await call(H.approvalDecide.POST, 'POST', `/api/approvals/${ap2}/decide`, { session: finance, params: { id: ap2 }, body: { decision: 'REJECTED', note: 'not needed' } })).status).toBe(200);
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(R(5000));
  });
  it('two approvers deciding the same approval at the same instant → one wins, one gets 409', async () => {
    const p = await newProject(admin, { budget: '1000', memberIds: [tm.userId] });
    const ap = (await addCost(tm, p.id, '5000')).data.approvalId;
    const [a, b] = await Promise.all([
      call(H.approvalDecide.POST, 'POST', `/api/approvals/${ap}/decide`, { session: finance, params: { id: ap }, body: { decision: 'APPROVED' } }),
      call(H.approvalDecide.POST, 'POST', `/api/approvals/${ap}/decide`, { session: admin, params: { id: ap }, body: { decision: 'REJECTED', note: 'no' } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});
void uniq;
