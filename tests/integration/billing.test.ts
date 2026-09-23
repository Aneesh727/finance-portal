/** Billing: GST, TDS, advances, overpayment, refunds, voids, schedules, numbering, overdue (spec §16–§18, §47). */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { H } from './api';
import { call, makeUser, makeClient, uniq, newProject, getFin, R, type Session } from './helpers';
import { closeDb } from '@/lib/db';

afterAll(async () => { await closeDb(); });
let admin: Session, finance: Session;
beforeAll(async () => { [admin, finance] = await Promise.all([makeUser('ADMIN'), makeUser('FINANCE')]); });

const inv = (projectId: string, o: Record<string, unknown> = {}) =>
  call(H.invoices.POST, 'POST', '/api/invoices', { session: finance, body: { projectId, type: 'CUSTOM', subtotal: '100000', dueDate: '2099-12-31', issueDate: '2026-09-01', status: 'ISSUED', ...o } });
const pay = (o: Record<string, unknown>) => call(H.payments.POST, 'POST', '/api/payments', { session: finance, body: { receivedDate: '2026-09-10', ...o } });
const getInv = async (id: string) => (await call(H.invoiceById.GET, 'GET', `/api/invoices/${id}`, { session: finance, params: { id } })).data;

describe('GST on invoices', () => {
  it('intra-state supply (client in the company state) splits 18% into CGST 9% + SGST 9%', async () => {
    const client = await makeClient(uniq('Maha'), { stateCode: '27' });
    const p = await newProject(admin, { clientId: client.id, taxMode: 'EXCLUSIVE', taxRatePct: 18, sellingPrice: '100000' });
    const r = await inv(p.id);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.data.subtotal).toBe('100000.00'); expect(r.data.taxAmount).toBe('18000.00'); expect(r.data.total).toBe('118000.00');
    expect(r.data.cgst).toBe('9000.00'); expect(r.data.sgst).toBe('9000.00'); expect(r.data.igst).toBe('0.00');
  });
  it('inter-state supply is IGST only', async () => {
    const client = await makeClient(uniq('Kar'), { stateCode: '29' });
    const p = await newProject(admin, { clientId: client.id, taxMode: 'EXCLUSIVE', taxRatePct: 18, sellingPrice: '100000' });
    const r = await inv(p.id);
    expect(r.data.igst).toBe('18000.00'); expect(r.data.cgst).toBe('0.00'); expect(r.data.sgst).toBe('0.00');
  });
  it('an odd-paise tax amount still splits exactly (CGST+SGST = tax)', async () => {
    const client = await makeClient(uniq('Odd'), { stateCode: '27' });
    const p = await newProject(admin, { clientId: client.id, taxMode: 'EXCLUSIVE', taxRatePct: 18, sellingPrice: '1000' });
    const r = await inv(p.id, { subtotal: '333.33' });
    expect(r.status).toBe(201);
    const sum = Math.round(Number(r.data.cgst) * 100) + Math.round(Number(r.data.sgst) * 100);
    expect(sum).toBe(Math.round(Number(r.data.taxAmount) * 100));
    expect(Math.round(Number(r.data.total) * 100)).toBe(Math.round(Number(r.data.subtotal) * 100) + Math.round(Number(r.data.taxAmount) * 100));
  });
  it('a project with no tax has zero GST; tax rate is configurable per project (5%)', async () => {
    const p0 = await newProject(admin, { taxMode: 'NONE' });
    expect((await inv(p0.id)).data.taxAmount).toBe('0.00');
    const p5 = await newProject(admin, { taxMode: 'EXCLUSIVE', taxRatePct: 5 });
    expect((await inv(p5.id)).data.taxAmount).toBe('5000.00');
  });
});

describe('payments, TDS, advance, overpayment, refund, void', () => {
  it('a partial payment marks PARTIALLY_PAID; the remainder completes it to PAID', async () => {
    const p = await newProject(admin, { taxMode: 'NONE' });
    const i = (await inv(p.id)).data;
    expect((await pay({ invoiceId: i.id, amount: '40000' })).status).toBe(201);
    let d = await getInv(i.id);
    expect(d.invoice.status).toBe('PARTIALLY_PAID'); expect(d.invoice.outstanding).toBe('60000');
    expect((await pay({ invoiceId: i.id, amount: '60000' })).status).toBe(201);
    d = await getInv(i.id);
    expect(d.invoice.status).toBe('PAID'); expect(Number(d.invoice.outstanding)).toBe(0);
  });
  it('TDS reduces the cash received but settles the invoice (10% TDS on ₹1,00,000 → ₹90,000 cash)', async () => {
    const p = await newProject(admin, { taxMode: 'NONE' });
    const i = (await inv(p.id)).data;
    const r = await pay({ invoiceId: i.id, amount: '90000', tdsAmount: '10000' });
    expect(r.status).toBe(201);
    const d = await getInv(i.id);
    expect(d.invoice.status).toBe('PAID');
    expect(d.invoice.received).toBe('90000.00'); expect(d.invoice.tds).toBe('10000.00');
    const f = (await getFin(admin, p.id)).financials;
    expect(f.receivables.received).toBe(R(90000));
    expect(f.receivables.tds).toBe(R(10000));
    expect(f.receivables.outstanding).toBe(0);
  });
  it('an advance without an invoice is recorded against the project and reduces the outstanding', async () => {
    const p = await newProject(admin, { taxMode: 'NONE', sellingPrice: '100000' });
    const r = await pay({ projectId: p.id, amount: '30000', method: 'UPI' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const f = (await getFin(admin, p.id)).financials;
    expect(f.receivables.received).toBe(R(30000));
    expect(f.receivables.creditBalance).toBe(R(30000));
    // when the invoice is raised the advance is applied against it
    await inv(p.id, { subtotal: '100000' });
    const f2 = (await getFin(admin, p.id)).financials;
    expect(f2.receivables.outstanding).toBe(R(70000));
    expect(f2.receivables.creditBalance).toBe(0);
  });
  it('overpayment is reported, and a payment in the future is refused', async () => {
    const p = await newProject(admin, { taxMode: 'NONE', sellingPrice: '200000' });
    const i = (await inv(p.id)).data;
    const r = await pay({ invoiceId: i.id, amount: '100500' });
    expect(r.data.overpaidBy).toBe(R(500)); // reported in paise
    expect((await pay({ invoiceId: i.id, amount: '1', receivedDate: '2099-01-01' })).status).toBe(422);
  });
  it('refunds cannot exceed what was received and reduce the received total', async () => {
    const p = await newProject(admin, { taxMode: 'NONE' });
    const i = (await inv(p.id)).data;
    await pay({ invoiceId: i.id, amount: '50000' });
    const tooMuch = await pay({ invoiceId: i.id, amount: '50000.01', kind: 'REFUND' });
    expect(tooMuch.status).toBe(422); expect(tooMuch.error?.code).toBe('REFUND_EXCEEDS_RECEIVED');
    expect((await pay({ invoiceId: i.id, amount: '10000', kind: 'REFUND' })).status).toBe(201);
    expect((await getFin(admin, p.id)).financials.receivables.received).toBe(R(40000));
    expect((await pay({ invoiceId: i.id, amount: '100', kind: 'REFUND', tdsAmount: '5' })).status).toBe(422);
  });
  it('voiding a payment restores the outstanding; voiding twice is refused; the reason is mandatory and audited', async () => {
    const p = await newProject(admin, { taxMode: 'NONE' });
    const i = (await inv(p.id)).data;
    const r = await pay({ invoiceId: i.id, amount: '100000' });
    const pid = r.data.payment.id;
    expect((await call(H.paymentVoid.POST, 'POST', `/api/payments/${pid}/void`, { session: finance, params: { id: pid }, body: {} })).status).toBe(422);
    expect((await call(H.paymentVoid.POST, 'POST', `/api/payments/${pid}/void`, { session: finance, params: { id: pid }, body: { reason: 'bounced cheque' } })).status).toBe(200);
    expect((await getInv(i.id)).invoice.status).toBe('PENDING');
    expect((await call(H.paymentVoid.POST, 'POST', `/api/payments/${pid}/void`, { session: finance, params: { id: pid }, body: { reason: 'again' } })).status).toBe(409);
    const hist = await call(H.auditLog.GET, 'GET', '/api/audit', { session: admin, query: { projectId: p.id, pageSize: 50 } });
    expect(hist.data.some((x: any) => x.action === 'payment.void')).toBe(true);
  });
  it('a payment must not be recorded on a SCHEDULED (not yet issued) invoice', async () => {
    const p = await newProject(admin, { taxMode: 'NONE' });
    const i = (await inv(p.id, { status: 'SCHEDULED', issueDate: null })).data;
    const r = await pay({ invoiceId: i.id, amount: '10' });
    expect(r.status).toBe(409); expect(r.error?.code).toBe('INVOICE_NOT_ISSUED');
  });
  it('two simultaneous payments both land (no lost update) and the totals add up', async () => {
    const p = await newProject(admin, { taxMode: 'NONE' });
    const i = (await inv(p.id)).data;
    const rs = await Promise.all([pay({ invoiceId: i.id, amount: '30000' }), pay({ invoiceId: i.id, amount: '30000' }), pay({ invoiceId: i.id, amount: '40000' })]);
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201]);
    expect((await getInv(i.id)).invoice.status).toBe('PAID');
  });
});

describe('invoice rules, numbering, schedule, overdue', () => {
  it('a project cannot be invoiced for more than its contract value', async () => {
    const p = await newProject(admin, { taxMode: 'NONE', sellingPrice: '100000' });
    expect((await inv(p.id, { subtotal: '60000' })).status).toBe(201);
    const over = await inv(p.id, { subtotal: '40000.01' });
    expect(over.status).toBe(422);
    expect((await inv(p.id, { subtotal: '40000' })).status).toBe(201);
  });
  it('invoice numbers are unique and sequential even when created concurrently', async () => {
    const p = await newProject(admin, { taxMode: 'NONE', sellingPrice: '1000000' });
    const rs = await Promise.all(Array.from({ length: 12 }, () => inv(p.id, { subtotal: '1000' })));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    const nums = rs.map((r) => r.data.number as string);
    expect(new Set(nums).size).toBe(12);
    expect(nums[0]).toMatch(/^INV\/\d{4}-\d{2}\/\d{4}$/);
    const seq = nums.map((n) => Number(n.split('/')[2])).sort((a, b) => a - b);
    for (let k = 1; k < seq.length; k++) expect(seq[k]).toBe(seq[k - 1] + 1);
  });
  it('a payment schedule of 30/40/30 sums exactly to the contract (no lost paise) and cannot exceed 100%', async () => {
    const p = await newProject(admin, { taxMode: 'NONE', sellingPrice: '100000.01' });
    const r = await call(H.projectSchedule.POST, 'POST', `/api/projects/${p.id}/schedule`, { session: finance, params: { id: p.id }, body: { items: [{ type: 'ADVANCE', pct: 30, dueDate: '2026-10-01' }, { type: 'MILESTONE', pct: 40, dueDate: '2026-11-01' }, { type: 'FINAL', pct: 30, dueDate: '2026-12-01' }] } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const sum = r.data.reduce((a: number, x: any) => a + Math.round(Number(x.total) * 100), 0);
    expect(sum).toBe(R(100000.01));
    const p2 = await newProject(admin, { taxMode: 'NONE', sellingPrice: '1000' });
    expect((await call(H.projectSchedule.POST, 'POST', `/api/projects/${p2.id}/schedule`, { session: finance, params: { id: p2.id }, body: { items: [{ pct: 60, dueDate: '2026-10-01' }, { pct: 50, dueDate: '2026-11-01' }] } })).status).toBe(422);
  });
  it('a SCHEDULED invoice can be issued once; an ISSUED one cannot be issued again', async () => {
    const p = await newProject(admin, { taxMode: 'NONE' });
    const i = (await inv(p.id, { status: 'SCHEDULED', issueDate: null })).data;
    expect((await call(H.invoiceIssue.POST, 'POST', `/api/invoices/${i.id}/issue`, { session: finance, params: { id: i.id }, body: {} })).status).toBe(200);
    expect((await call(H.invoiceIssue.POST, 'POST', `/api/invoices/${i.id}/issue`, { session: finance, params: { id: i.id }, body: {} })).status).toBe(409);
  });
  it('past-due unpaid invoices are OVERDUE and show up in the receivables report with an ageing bucket', async () => {
    const p = await newProject(admin, { taxMode: 'NONE' });
    const i = (await inv(p.id, { issueDate: '2026-01-01', dueDate: '2026-02-01' })).data;
    expect((await getInv(i.id)).invoice.status).toBe('OVERDUE');
    const rep = await call(H.reportRecv.GET, 'GET', '/api/reports/receivables', { session: finance });
    expect(rep.status).toBe(200);
    expect(JSON.stringify(rep.data)).toContain(i.number);
  });
  it('cancelling an invoice removes it from receivables; cancelling twice is refused; payments on it stay as unapplied credit', async () => {
    const p = await newProject(admin, { taxMode: 'NONE' });
    const i = (await inv(p.id)).data;
    await pay({ invoiceId: i.id, amount: '20000' });
    expect((await call(H.invoiceCancel.POST, 'POST', `/api/invoices/${i.id}/cancel`, { session: finance, params: { id: i.id }, body: { reason: 'issued in error' } })).status).toBe(200);
    expect((await call(H.invoiceCancel.POST, 'POST', `/api/invoices/${i.id}/cancel`, { session: finance, params: { id: i.id }, body: { reason: 'again' } })).status).toBe(409);
    const f = (await getFin(admin, p.id)).financials;
    expect(f.receivables.invoiced).toBe(0);
    expect(f.receivables.received).toBe(R(20000));
  });
  it('a milestone shows PAID only when its invoice is fully settled', async () => {
    const p = await newProject(admin, { type: 'MILESTONE', taxMode: 'NONE', sellingPrice: '0', milestones: [{ name: 'Phase 1', price: '50000' }] });
    const ms = (await getFin(admin, p.id)).milestones[0];
    const i = (await inv(p.id, { type: 'MILESTONE', milestoneId: ms.id, subtotal: '50000' })).data;
    await pay({ invoiceId: i.id, amount: '20000' });
    expect((await getFin(admin, p.id)).milestones[0].payment.status).not.toBe('PAID');
    await pay({ invoiceId: i.id, amount: '30000' });
    expect((await getFin(admin, p.id)).milestones[0].payment.status).toBe('PAID');
  });
});
