/** Expenses, allocations, recurring rules, employee cost allocation (spec §19–§22, §47). */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { H } from './api';
import { call, makeUser, catId, newProject, getFin, makeResource, uniq, R, type Session } from './helpers';
import { closeDb } from '@/lib/db';

afterAll(async () => { await closeDb(); });
let admin: Session, finance: Session, pm: Session;
beforeAll(async () => { [admin, finance, pm] = await Promise.all([makeUser('ADMIN'), makeUser('FINANCE'), makeUser('PROJECT_MANAGER')]); });

const expense = async (o: Record<string, unknown> = {}, s = admin) =>
  call(H.expenses.POST, 'POST', '/api/expenses', { session: s, body: { date: '2026-09-05', categoryId: await catId('EXPENSE', 'Software'), description: uniq('exp'), amount: '10000', scope: 'COMPANY', ...o } });
const ex = (d: any) => d.expense ?? d;
const alloc = (id: string, rows: unknown[], s = admin) => call(H.expenseAlloc.PUT, 'PUT', `/api/expenses/${id}/allocations`, { session: s, params: { id }, body: { rows } });

describe('company expenses and allocation', () => {
  it('a company expense does not touch any project until it is allocated', async () => {
    const p = await newProject(admin, { budget: '0' });
    const e = await expense();
    expect(e.status, JSON.stringify(e.body)).toBe(201);
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(0);
  });
  it('PERCENT allocation splits the expense; the remainder stays as overhead; project cost appears in the project', async () => {
    const a = await newProject(admin, { budget: '0' }); const b = await newProject(admin, { budget: '0' });
    const e = ex((await expense({ amount: '10000' })).data);
    const r = await alloc(e.id, [{ targetType: 'PROJECT', projectId: a.id, method: 'PERCENT', value: 40 }, { targetType: 'PROJECT', projectId: b.id, method: 'PERCENT', value: 35 }]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await getFin(admin, a.id)).financials.cost.actual).toBe(R(4000));
    expect((await getFin(admin, b.id)).financials.cost.actual).toBe(R(3500));
    // re-allocation replaces, never adds
    await alloc(e.id, [{ targetType: 'PROJECT', projectId: a.id, method: 'PERCENT', value: 10 }]);
    expect((await getFin(admin, a.id)).financials.cost.actual).toBe(R(1000));
    expect((await getFin(admin, b.id)).financials.cost.actual).toBe(0);
  });
  it('allocations can never exceed the expense (percent > 100 or fixed > amount are refused) and odd splits sum exactly', async () => {
    const a = await newProject(admin, { budget: '0' }); const b = await newProject(admin, { budget: '0' }); const c = await newProject(admin, { budget: '0' });
    const e = ex((await expense({ amount: '100.01' })).data);
    expect((await alloc(e.id, [{ targetType: 'PROJECT', projectId: a.id, method: 'PERCENT', value: 60 }, { targetType: 'PROJECT', projectId: b.id, method: 'PERCENT', value: 50 }])).status).toBe(422);
    expect((await alloc(e.id, [{ targetType: 'PROJECT', projectId: a.id, method: 'FIXED', value: 100.02 }])).status).toBe(422);
    expect((await alloc(e.id, [{ targetType: 'PROJECT', projectId: a.id, method: 'PERCENT', value: 33.34 }, { targetType: 'PROJECT', projectId: b.id, method: 'PERCENT', value: 33.33 }, { targetType: 'PROJECT', projectId: c.id, method: 'PERCENT', value: 33.33 }])).status).toBe(200);
    const tot = (await Promise.all([a, b, c].map(async (x) => (await getFin(admin, x.id)).financials.cost.actual))).reduce((x, y) => x + y, 0);
    expect(tot).toBe(R(100.01));
    expect((await alloc(e.id, [{ targetType: 'PROJECT', projectId: a.id, method: 'PERCENT', value: -5 }])).status).toBe(422);
  });
  it('a project-scope expense mirrors into the project cost; editing/voiding the expense updates it; the mirror cannot be edited directly', async () => {
    const p = await newProject(admin, { budget: '0' });
    const e = (await expense({ scope: 'PROJECT', projectId: p.id, amount: '2500' })).data;
    expect(e.expense.projectId ?? e.projectId).toBe(p.id);
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(R(2500));
    const id = e.expense?.id ?? e.id;
    const upd = await call(H.expenseById.PATCH, 'PATCH', `/api/expenses/${id}`, { session: admin, params: { id }, body: { amount: '3000', version: e.expense?.version ?? e.version } });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(R(3000));
    const costs = await call(H.costs.GET, 'GET', '/api/costs', { session: admin, query: { projectId: p.id } });
    const mirror = costs.data.find((c: any) => c.expenseId === id);
    expect(mirror).toBeTruthy();
    expect((await call(H.costVoid.POST, 'POST', `/api/costs/${mirror.id}/void`, { session: admin, params: { id: mirror.id }, body: { reason: 'x' } })).status).toBe(422);
    expect((await call(H.expenseVoid.POST, 'POST', `/api/expenses/${id}/void`, { session: admin, params: { id }, body: { reason: 'entered twice' } })).status).toBe(200);
    expect((await getFin(admin, p.id)).financials.cost.actual).toBe(0);
  });
  it('a project-scope expense that would break the project budget is blocked/needs approval like any cost', async () => {
    const p = await newProject(admin, { budget: '1000' });
    const r = await expense({ scope: 'PROJECT', projectId: p.id, amount: '5000' });
    expect(r.status).toBe(422); expect(r.error?.code).toBe('BUDGET_WOULD_BE_EXCEEDED');
    const ok = await expense({ scope: 'PROJECT', projectId: p.id, amount: '5000', overrideBudget: true, overrideReason: 'approved by client' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });
  it('validation: amount, date, category, project scope without a project', async () => {
    expect((await expense({ amount: '0' })).status).toBe(422);
    expect((await expense({ amount: '-5' })).status).toBe(422);
    expect((await expense({ date: '2026-02-30' })).status).toBe(422);
    expect((await expense({ description: '' })).status).toBe(422);
    expect((await expense({ scope: 'PROJECT' })).status).toBe(422);
    expect((await expense({ categoryId: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);
  });
  it('a project manager cannot create or read company expenses', async () => {
    expect((await expense({}, pm)).status).toBe(403);
    expect((await call(H.expenses.GET, 'GET', '/api/expenses', { session: pm })).status).toBe(403);
  });
});

describe('recurring expenses', () => {
  const rule = async (o: Record<string, unknown> = {}) => call(H.recurring.POST, 'POST', '/api/recurring', { session: finance, body: { name: uniq('Rule'), categoryId: await catId('EXPENSE', 'Subscriptions'), amount: '1000', frequency: 'MONTHLY', startDate: '2026-07-01', ...o } });
  it('generates one expense per due month (Jul, Aug, Sep) and is idempotent', async () => {
    const r = await rule();
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.data.id ?? r.data.rule?.id;
    const g1 = await call(H.recurringGen.POST, 'POST', `/api/recurring/${id}/generate`, { session: finance, params: { id }, body: { asOf: '2026-09-20' } });
    expect(g1.status, JSON.stringify(g1.body)).toBe(200);
    expect(g1.data.created).toBe(3);
    const g2 = await call(H.recurringGen.POST, 'POST', `/api/recurring/${id}/generate`, { session: finance, params: { id }, body: { asOf: '2026-09-20' } });
    expect(g2.data.created).toBe(0);
  });
  it('CONCURRENCY: parallel generation creates each occurrence exactly once', async () => {
    const r = await rule({ startDate: '2026-01-01' });
    const id = r.data.id ?? r.data.rule?.id;
    const rs = await Promise.all(Array.from({ length: 6 }, () => call(H.recurringGen.POST, 'POST', `/api/recurring/${id}/generate`, { session: finance, params: { id }, body: { asOf: '2026-09-20' } })));
    expect(rs.every((x) => x.status === 200)).toBe(true);
    expect(rs.reduce((a, x) => a + x.data.created, 0)).toBe(9);
    const list = await call(H.expenses.GET, 'GET', '/api/expenses', { session: finance, query: { recurringRuleId: id, pageSize: 100 } });
    expect(list.data.filter((e: any) => e.recurringRuleId === id).length).toBe(9);
  });
  it('an end date stops generation; a paused (inactive) rule generates nothing; quarterly and yearly steps are right', async () => {
    const ended = await rule({ startDate: '2026-01-01', endDate: '2026-03-31' });
    const eid = ended.data.id ?? ended.data.rule?.id;
    expect((await call(H.recurringGen.POST, 'POST', `/api/recurring/${eid}/generate`, { session: finance, params: { id: eid }, body: { asOf: '2026-09-20' } })).data.created).toBe(3);
    const q = await rule({ startDate: '2026-01-01', frequency: 'QUARTERLY' });
    const qid = q.data.id ?? q.data.rule?.id;
    expect((await call(H.recurringGen.POST, 'POST', `/api/recurring/${qid}/generate`, { session: finance, params: { id: qid }, body: { asOf: '2026-09-20' } })).data.created).toBe(3); // Jan, Apr, Jul
    const y = await rule({ startDate: '2025-09-01', frequency: 'YEARLY' });
    const yid = y.data.id ?? y.data.rule?.id;
    expect((await call(H.recurringGen.POST, 'POST', `/api/recurring/${yid}/generate`, { session: finance, params: { id: yid }, body: { asOf: '2026-09-20' } })).data.created).toBe(2); // Sep 2025, Sep 2026
    const off = await rule({ startDate: '2026-01-01', active: false });
    const oid = off.data.id ?? off.data.rule?.id;
    expect((await call(H.recurringGen.POST, 'POST', `/api/recurring/${oid}/generate`, { session: finance, params: { id: oid }, body: { asOf: '2026-09-20' } })).data.created).toBe(0);
  });
  it('month-end start dates clamp (31 Jan → 28 Feb 2026, not skipped)', async () => {
    const r = await rule({ startDate: '2026-01-31' });
    const id = r.data.id ?? r.data.rule?.id;
    await call(H.recurringGen.POST, 'POST', `/api/recurring/${id}/generate`, { session: finance, params: { id }, body: { asOf: '2026-04-30' } });
    const list = await call(H.expenses.GET, 'GET', '/api/expenses', { session: finance, query: { recurringRuleId: id, pageSize: 100 } });
    const dates = list.data.filter((e: any) => e.recurringRuleId === id).map((e: any) => e.date).sort();
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
});

describe('employee cost allocation', () => {
  const put = (resourceId: string, rows: unknown[], month = '2026-09-01', s = finance) => call(H.empAlloc.PUT, 'PUT', '/api/employee-allocations', { session: s, body: { resourceId, month, rows } });
  it('a ₹1,00,000 employee split 60/40 costs the projects exactly their share; >100% is refused; leftover is internal cost', async () => {
    const emp = await makeResource({ type: 'EMPLOYEE', monthlyCost: '100000', hourlyCost: '0', dailyCost: '0' });
    const a = await newProject(admin, { budget: '0' }); const b = await newProject(admin, { budget: '0' });
    expect((await put(emp.id, [{ projectId: a.id, method: 'PERCENT', value: 60 }, { projectId: b.id, method: 'PERCENT', value: 50 }])).status).toBe(422);
    const ok = await put(emp.id, [{ projectId: a.id, method: 'PERCENT', value: 60 }, { projectId: b.id, method: 'PERCENT', value: 30 }]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await getFin(admin, a.id)).financials.cost.actual).toBe(R(60000));
    expect((await getFin(admin, b.id)).financials.cost.actual).toBe(R(30000));
    const view = await call(H.empAlloc.GET, 'GET', '/api/employee-allocations', { session: finance, query: { month: '2026-09-01' } });
    const me = view.data.employees.find((e: any) => e.id === emp.id);
    expect(me.internal).toBe(R(10000));
    // change → replaced, not added
    await put(emp.id, [{ projectId: a.id, method: 'PERCENT', value: 20 }]);
    expect((await getFin(admin, a.id)).financials.cost.actual).toBe(R(20000));
    expect((await getFin(admin, b.id)).financials.cost.actual).toBe(0);
  });
  it('hours allocation uses the standard month (160h): 40h = 25%', async () => {
    const emp = await makeResource({ type: 'EMPLOYEE', monthlyCost: '80000', hourlyCost: '0', dailyCost: '0' });
    const a = await newProject(admin, { budget: '0' });
    expect((await put(emp.id, [{ projectId: a.id, method: 'HOURS', value: 40 }])).status).toBe(200);
    expect((await getFin(admin, a.id)).financials.cost.actual).toBe(R(20000));
  });
  it('a mid-month joiner is prorated by days; freelancers cannot be allocated as employees; only finance may allocate', async () => {
    const emp = await makeResource({ type: 'EMPLOYEE', monthlyCost: '30000', hourlyCost: '0', dailyCost: '0', startDate: '2026-09-16' });
    const a = await newProject(admin, { budget: '0' });
    expect((await put(emp.id, [{ projectId: a.id, method: 'PERCENT', value: 100 }])).status).toBe(200);
    expect((await getFin(admin, a.id)).financials.cost.actual).toBe(R(15000)); // 15 of 30 days
    const fl = await makeResource({ type: 'FREELANCER' });
    expect((await put(fl.id, [{ projectId: a.id, method: 'PERCENT', value: 10 }])).status).toBe(422);
    expect((await put(emp.id, [], '2026-09-01', pm)).status).toBe(403);
  });
});
