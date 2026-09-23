/** Retainers (terms, proration, invoicing, overage, renewal, cancellation) and deals (scenarios, conversion) — spec §23–§26. */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { H } from './api';
import { call, makeUser, makeClient, catId, uniq, getFin, R, type Session } from './helpers';
import { closeDb } from '@/lib/db';

afterAll(async () => { await closeDb(); });
let admin: Session, finance: Session, pm: Session, viewer: Session;
beforeAll(async () => { [admin, finance, pm, viewer] = await Promise.all([makeUser('ADMIN'), makeUser('FINANCE'), makeUser('PROJECT_MANAGER'), makeUser('VIEWER')]); });

const mkRetainer = async (o: Record<string, unknown> = {}) => {
  const client = await makeClient(uniq('RetCo'), { stateCode: '27' });
  const r = await call(H.retainers.POST, 'POST', '/api/retainers', { session: admin, body: { name: uniq('Retainer'), clientId: client.id, serviceId: await catId('SERVICE', 'SEO'), monthlyFee: '50000', startDate: '2026-07-01', endDate: '2026-12-31', includedHours: 20, overageRate: '2000', taxMode: 'NONE', ...o } });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.data as { id: string; projectId: string; code: string };
};
const gen = (id: string, asOf: string, s = finance) => call(H.retainerInvoices.POST, 'POST', `/api/retainers/${id}/invoices`, { session: s, params: { id }, body: { asOf } });

describe('retainers', () => {
  it('creates a retainer project with a term and lists it with MRR', async () => {
    const r = await mkRetainer();
    const list = await call(H.retainers.GET, 'GET', '/api/retainers', { session: admin });
    expect(list.data.find((x: any) => x.id === r.id)).toBeTruthy();
    expect(list.body.meta.mrrMinor).toBeGreaterThanOrEqual(R(50000));
    const d = await call(H.retainerById.GET, 'GET', `/api/retainers/${r.id}`, { session: admin, params: { id: r.id } });
    expect(d.status).toBe(200);
    expect(d.data.terms.length).toBe(1);
    expect(d.data.totals.base).toBe(R(300000)); // 6 full months
  });
  it('validates: end before start, zero fee, unknown client', async () => {
    const client = await makeClient(uniq('C'));
    const base = { name: uniq('R'), clientId: client.id, serviceId: await catId('SERVICE', 'SEO'), monthlyFee: '50000', startDate: '2026-07-01', endDate: '2026-12-31' };
    expect((await call(H.retainers.POST, 'POST', '/api/retainers', { session: admin, body: { ...base, endDate: '2026-06-01' } })).status).toBe(422);
    expect((await call(H.retainers.POST, 'POST', '/api/retainers', { session: admin, body: { ...base, monthlyFee: '0' } })).status).toBe(422);
    expect((await call(H.retainers.POST, 'POST', '/api/retainers', { session: admin, body: { ...base, clientId: '00000000-0000-4000-8000-000000000000' } })).status).toBeGreaterThanOrEqual(400);
  });
  it('bills fees monthly in advance up to today, is idempotent, and CONCURRENT generation never duplicates', async () => {
    const r = await mkRetainer();
    const g1 = await gen(r.id, '2026-09-20');
    expect(g1.status, JSON.stringify(g1.body)).toBe(200);
    expect(g1.data.created).toBe(3); // Jul, Aug, Sep
    expect((await gen(r.id, '2026-09-20')).data.created).toBe(0);
    const rs = await Promise.all(Array.from({ length: 5 }, () => gen(r.id, '2026-12-31')));
    expect(rs.every((x) => x.status === 200)).toBe(true);
    expect(rs.reduce((a, x) => a + x.data.created, 0)).toBe(3); // Oct, Nov, Dec
    const inv = await call(H.invoices.GET, 'GET', '/api/invoices', { session: finance, query: { projectId: r.projectId, pageSize: 50 } });
    expect(inv.data.length).toBe(6);
    expect(new Set(inv.data.map((i: any) => i.number)).size).toBe(6);
  });
  it('a mid-month start is prorated by days (start 16 Sep, ₹30,000/mo → 15/30 days = ₹15,000)', async () => {
    const r = await mkRetainer({ monthlyFee: '30000', startDate: '2026-09-16', endDate: '2026-12-31' });
    const g = await gen(r.id, '2026-09-30');
    expect(g.data.created).toBe(1);
    expect(g.data.invoices[0].total).toBe('15000.00');
  });
  it('overage hours beyond the allowance are computed and invoiced once', async () => {
    const r = await mkRetainer();
    const put = await call(H.retainerHours.PUT, 'PUT', `/api/retainers/${r.id}/hours`, { session: admin, params: { id: r.id }, body: { month: '2026-08-01', hoursUsed: 25 } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const d = await call(H.retainerById.GET, 'GET', `/api/retainers/${r.id}`, { session: admin, params: { id: r.id } });
    const aug = d.data.months.find((m: any) => m.month === '2026-08-01');
    expect(aug.overageHours).toBe(5); expect(aug.overageRevenue).toBe(R(10000));
    const o1 = await call(H.retainerOverage.POST, 'POST', `/api/retainers/${r.id}/overage`, { session: finance, params: { id: r.id }, body: { month: '2026-08-01' } });
    expect(o1.status, JSON.stringify(o1.body)).toBe(201);
    expect(o1.data.total).toBe('10000.00');
    expect((await call(H.retainerOverage.POST, 'POST', `/api/retainers/${r.id}/overage`, { session: finance, params: { id: r.id }, body: { month: '2026-08-01' } })).status).toBe(409);
    const none = await call(H.retainerOverage.POST, 'POST', `/api/retainers/${r.id}/overage`, { session: finance, params: { id: r.id }, body: { month: '2026-09-01' } });
    expect(none.status).toBe(422);
    expect((await call(H.retainerHours.PUT, 'PUT', `/api/retainers/${r.id}/hours`, { session: admin, params: { id: r.id }, body: { month: '2027-06-01', hoursUsed: 5 } })).status).toBe(422);
    expect((await call(H.retainerHours.PUT, 'PUT', `/api/retainers/${r.id}/hours`, { session: admin, params: { id: r.id }, body: { month: '2026-08-01', hoursUsed: -1 } })).status).toBe(422);
  });
  it('renewal adds a new term (history unchanged) and refuses an overlapping term', async () => {
    const r = await mkRetainer();
    const ov = await call(H.retainerRenew.POST, 'POST', `/api/retainers/${r.id}/renew`, { session: admin, params: { id: r.id }, body: { monthlyFee: '60000', startDate: '2026-11-01', endDate: '2027-03-31' } });
    expect(ov.status).toBe(422); expect(ov.error?.code).toBe('TERM_OVERLAP');
    const ok = await call(H.retainerRenew.POST, 'POST', `/api/retainers/${r.id}/renew`, { session: admin, params: { id: r.id }, body: { monthlyFee: '60000', endDate: '2027-06-30' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const d = await call(H.retainerById.GET, 'GET', `/api/retainers/${r.id}`, { session: admin, params: { id: r.id } });
    expect(d.data.terms.length).toBe(2);
    expect(d.data.totals.base).toBe(R(50000 * 6 + 60000 * 6));
  });
  it('cancellation stops billing after the cancel date and is not repeatable; a cancelled retainer cannot be renewed', async () => {
    const r = await mkRetainer();
    const c = await call(H.retainerCancel.POST, 'POST', `/api/retainers/${r.id}/cancel`, { session: admin, params: { id: r.id }, body: { cancelOn: '2026-08-31', reason: 'Client left' } });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect((await gen(r.id, '2026-12-31')).data.created).toBe(2); // Jul, Aug only
    expect((await call(H.retainerCancel.POST, 'POST', `/api/retainers/${r.id}/cancel`, { session: admin, params: { id: r.id }, body: { cancelOn: '2026-08-31', reason: 'again' } })).status).toBe(409);
    expect((await call(H.retainerRenew.POST, 'POST', `/api/retainers/${r.id}/renew`, { session: admin, params: { id: r.id }, body: { monthlyFee: '1', endDate: '2027-12-31' } })).status).toBe(409);
  });
  it('a retainer’s fee revenue and cost feed the normal project profitability', async () => {
    const r = await mkRetainer();
    await gen(r.id, '2026-09-20');
    await call(H.costs.POST, 'POST', '/api/costs', { session: admin, body: { projectId: r.projectId, name: 'SEO tool', categoryId: await catId('COST', 'Software'), amount: '20000', date: '2026-08-10' } });
    const f = (await getFin(admin, r.projectId)).financials;
    expect(f.cost.actual).toBe(R(20000));
    expect(f.revenue.contractValue).toBeGreaterThan(0);
  });
  it('role checks: viewer reads, only managers change; PM sees only retainers they manage', async () => {
    const r = await mkRetainer();
    expect((await call(H.retainers.GET, 'GET', '/api/retainers', { session: viewer })).status).toBe(200);
    expect((await call(H.retainerCancel.POST, 'POST', `/api/retainers/${r.id}/cancel`, { session: viewer, params: { id: r.id }, body: { cancelOn: '2026-08-31', reason: 'x' } })).status).toBe(403);
    expect((await call(H.retainerById.GET, 'GET', `/api/retainers/${r.id}`, { session: pm, params: { id: r.id } })).status).toBe(404);
  });
});

describe('deals', () => {
  const svc = () => catId('SERVICE', 'Web Development');
  const mkDeal = async (o: Record<string, unknown> = {}) => {
    const client = await makeClient(uniq('DealCo'));
    const dev = await catId('COST', 'Developer');
    const r = await call(H.deals.POST, 'POST', '/api/deals', { session: admin, body: {
      name: uniq('Deal'), clientId: client.id, serviceId: await svc(),
      scenarios: [
        { name: 'Basic', sellingPrice: '200000', costLines: [{ categoryId: dev, name: 'Dev', amount: '100000' }, { categoryId: await catId('COST', 'Designer'), name: 'Design', amount: '40000' }] },
        { name: 'Premium', sellingPrice: '300000', costLines: [{ categoryId: dev, name: 'Dev', amount: '150000' }] },
      ], ...o } });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return r.data;
  };
  it('scenarios compute estimated cost, profit and margin', async () => {
    const d = await mkDeal();
    const g = await call(H.dealById.GET, 'GET', `/api/deals/${d.id}`, { session: admin, params: { id: d.id } });
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    const basic = g.data.scenarios.find((s: any) => s.name === 'Basic');
    expect(basic.calc.estimatedCost).toBe(R(140000)); expect(basic.calc.estimatedProfit).toBe(R(60000)); expect(basic.calc.marginPct).toBe(30);
    const prem = g.data.scenarios.find((s: any) => s.name === 'Premium');
    expect(prem.calc.marginPct).toBe(50);
  });
  it('converting creates a project with the chosen scenario’s price, estimated costs and budgets — exactly once', async () => {
    const d = await mkDeal();
    const g = await call(H.dealById.GET, 'GET', `/api/deals/${d.id}`, { session: admin, params: { id: d.id } });
    const sc = g.data.scenarios.find((s: any) => s.name === 'Premium');
    const c = await call(H.dealConvert.POST, 'POST', `/api/deals/${d.id}/convert`, { session: admin, params: { id: d.id }, body: { scenarioId: sc.id } });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const f = await getFin(admin, c.data.projectId);
    expect(f.financials.revenue.contractValue).toBe(R(300000));
    expect(f.financials.cost.estimated).toBe(R(150000));
    expect(f.project.status).toBe('WON');
    const again = await call(H.dealConvert.POST, 'POST', `/api/deals/${d.id}/convert`, { session: admin, params: { id: d.id }, body: { scenarioId: sc.id } });
    expect(again.status).toBe(409); expect(again.error?.code).toBe('ALREADY_CONVERTED');
  });
  it('CONCURRENCY: two simultaneous conversions create exactly one project', async () => {
    const d = await mkDeal();
    const g = await call(H.dealById.GET, 'GET', `/api/deals/${d.id}`, { session: admin, params: { id: d.id } });
    const sid = g.data.scenarios[0].id;
    const rs = await Promise.all([1, 2, 3].map(() => call(H.dealConvert.POST, 'POST', `/api/deals/${d.id}/convert`, { session: admin, params: { id: d.id }, body: { scenarioId: sid } })));
    expect(rs.filter((x) => x.status === 201).length).toBe(1);
    expect(rs.filter((x) => x.status === 409).length).toBe(2);
  });
  it('a lost deal needs a reason and cannot be converted; a deal without a client or scenario is refused', async () => {
    const d = await mkDeal();
    expect((await call(H.dealLost.POST, 'POST', `/api/deals/${d.id}/lost`, { session: admin, params: { id: d.id }, body: {} })).status).toBe(422);
    expect((await call(H.dealLost.POST, 'POST', `/api/deals/${d.id}/lost`, { session: admin, params: { id: d.id }, body: { reason: 'Price too high' } })).status).toBe(200);
    expect((await call(H.dealConvert.POST, 'POST', `/api/deals/${d.id}/convert`, { session: admin, params: { id: d.id }, body: {} })).status).toBe(409);
    const noClient = (await call(H.deals.POST, 'POST', '/api/deals', { session: admin, body: { name: uniq('Prospect'), clientName: 'Unsigned Ltd', serviceId: await svc(), scenarios: [{ name: 'A', sellingPrice: '1000', costLines: [] }] } })).data;
    const r = await call(H.dealConvert.POST, 'POST', `/api/deals/${noClient.id}/convert`, { session: admin, params: { id: noClient.id }, body: {} });
    expect(r.status).toBe(422); expect(r.error?.code).toBe('CLIENT_REQUIRED');
  });
  it('a viewer can read deals but not create or convert them', async () => {
    expect((await call(H.deals.GET, 'GET', '/api/deals', { session: viewer })).status).toBe(200);
    expect((await call(H.deals.POST, 'POST', '/api/deals', { session: viewer, body: { name: 'x' } })).status).toBe(403);
    expect((await call(H.deals.GET, 'GET', '/api/deals', { session: pm })).status).toBe(403);
  });
});
