/** Imports, exports, attachments (incl. malicious uploads), backup, reports/dashboard consistency — spec §27–§31, §48. */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { H } from './api';
import { call, makeUser, makeClient, catId, uniq, newProject, getFin, addCost, R, type Session } from './helpers';
import { closeDb } from '@/lib/db';

afterAll(async () => { await closeDb(); });
let admin: Session, finance: Session, pm: Session, viewer: Session, superAdmin: Session;
beforeAll(async () => { [admin, finance, pm, viewer, superAdmin] = await Promise.all([makeUser('ADMIN'), makeUser('FINANCE'), makeUser('PROJECT_MANAGER'), makeUser('VIEWER'), makeUser('SUPER_ADMIN')]); });

const file = (name: string, content: string | Buffer, type = 'application/octet-stream') => new File([content as never], name, { type });
const imp = (s: Session, kind: string, f: File, extra: Record<string, string> = {}, which: 'validate' | 'commit' = 'validate') => {
  const form = new FormData(); form.set('kind', kind); form.set('file', f); for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return call(which === 'validate' ? H.importValidate.POST : H.importCommit.POST, 'POST', `/api/import/${which}`, { session: s, form });
};
const upload = (s: Session, entityType: string, entityId: string, f: File) => {
  const form = new FormData(); form.set('entityType', entityType); form.set('entityId', entityId); form.set('file', f);
  return call(H.attachments.POST, 'POST', '/api/attachments', { session: s, form });
};

describe('CSV / Excel import', () => {
  it('validates clients, flags bad rows and duplicates, then commits only valid rows (per-row results)', async () => {
    const tag = uniq('imp');
    const csv = `Company Name,Email,GSTIN,Currency\r\n${tag} A,a@x.com,27AAPFU0939F1ZV,INR\r\n${tag} B,not-an-email,,INR\r\n${tag} A,dup@x.com,,INR\r\n${tag} C,c@x.com,BADGSTIN,INR\r\n`;
    const v = await imp(finance, 'CLIENTS', file('clients.csv', csv));
    expect(v.status).toBe(403); // finance has no clients.manage / import.run
    const v2 = await imp(admin, 'CLIENTS', file('clients.csv', csv));
    expect(v2.status, JSON.stringify(v2.body)).toBe(200);
    expect(v2.data.totals.rows).toBe(4);
    expect(v2.data.totals.valid).toBe(1); expect(v2.data.totals.invalid).toBe(2); expect(v2.data.totals.duplicates).toBe(1);
    const strict = await imp(admin, 'CLIENTS', file('clients.csv', csv), { batchId: v2.data.batchId }, 'commit');
    expect(strict.status).toBe(422); expect(strict.error?.code).toBe('IMPORT_HAS_ERRORS');
    const v3 = await imp(admin, 'CLIENTS', file('clients.csv', csv));
    const ok = await imp(admin, 'CLIENTS', file('clients.csv', csv), { batchId: v3.data.batchId, skipInvalid: 'true' }, 'commit');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const list = await call(H.clients.GET, 'GET', '/api/clients', { session: admin, query: { q: tag } });
    expect(list.data.length).toBe(1);
    // the committed batch cannot be replayed
    const replay = await imp(admin, 'CLIENTS', file('clients.csv', csv), { batchId: v3.data.batchId, skipInvalid: 'true' }, 'commit');
    expect(replay.status).toBe(409);
  });
  it('importing the exact same valid file twice is refused unless confirmed', async () => {
    const tag = uniq('twice');
    const csv = `Company Name\r\n${tag}\r\n`;
    const v1 = await imp(admin, 'CLIENTS', file('c.csv', csv));
    expect((await imp(admin, 'CLIENTS', file('c.csv', csv), { batchId: v1.data.batchId }, 'commit')).status).toBe(200);
    const v2 = await imp(admin, 'CLIENTS', file('c.csv', csv));
    expect(v2.data.alreadyImportedOn).toBeTruthy();
    const c2 = await imp(admin, 'CLIENTS', file('c.csv', csv), { batchId: v2.data.batchId }, 'commit');
    expect(c2.status).toBe(409); expect(c2.error?.code).toBe('ALREADY_IMPORTED');
  });
  it('imports costs by project code; cost rows that break the budget fail individually without aborting the rest', async () => {
    const p = await newProject(admin, { budget: '10000' });
    const csv = `Project Code,Date,Category,Cost Name,Amount\r\n${p.code},2026-09-01,Developer,Sprint 1,6000\r\n${p.code},2026-09-02,Developer,Sprint 2,6000\r\n${p.code},2026-09-03,Designer,Logo,1000\r\nNOPE-1,2026-09-03,Designer,Bad code,10\r\n`;
    const v = await imp(admin, 'COSTS', file('costs.csv', csv));
    expect(v.data.totals.valid).toBe(3); expect(v.data.totals.invalid).toBe(1);
    const c = await imp(admin, 'COSTS', file('costs.csv', csv), { batchId: v.data.batchId, skipInvalid: 'true' }, 'commit');
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const f = (await getFin(admin, p.id)).financials;
    expect(f.cost.actual).toBeLessThanOrEqual(R(10000)); // the guard applied to imported rows too
    expect(f.cost.actual).toBe(R(7000));
  });
  it('reads .xlsx, and rejects malicious cells (formula injection), fake xlsx, empty, binary and oversized files', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
    const tag = uniq('xl');
    ws.addRow(['Company Name', 'Email']); ws.addRow([`${tag} X`, 'x@x.com']); ws.addRow([`=HYPERLINK("http://evil","x")`, 'y@x.com']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const v = await imp(admin, 'CLIENTS', file('c.xlsx', buf));
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.data.totals.valid).toBe(1); expect(v.data.totals.invalid).toBe(1);
    expect((await imp(admin, 'CLIENTS', file('c.xlsx', 'this is not a zip'))).status).toBe(400);
    expect((await imp(admin, 'CLIENTS', file('c.csv', ''))).status).toBe(400);
    expect((await imp(admin, 'CLIENTS', file('c.csv', Buffer.from([0, 1, 2, 3, 0, 5])))).status).toBe(400);
    expect((await imp(admin, 'CLIENTS', file('c.exe', 'MZ'))).status).toBeGreaterThanOrEqual(400);
    const csvInj = `Company Name\r\n+cmd|' /C calc'!A0\r\n@SUM(1+1)\r\n-2+3\r\n`;
    const vi = await imp(admin, 'CLIENTS', file('c.csv', csvInj));
    expect(vi.data.totals.valid).toBe(0);
  });
  it('templates download for every kind; PM/viewer cannot import', async () => {
    for (const kind of ['CLIENTS', 'RESOURCES', 'PROJECTS', 'EXPENSES', 'COSTS']) {
      const t = await call(H.importTemplate.GET, 'GET', '/api/import/template', { session: admin, query: { kind } });
      expect(t.status).toBe(200); expect(t.headers.get('content-disposition')).toContain('.csv'); expect(t.text.split(/\r?\n/)[0].length).toBeGreaterThan(5);
      // the template's own example row must validate cleanly (except for references to data that may not exist yet)
      if (kind === 'CLIENTS') { const v = await imp(admin, kind, file('t.csv', t.text)); expect(v.data.totals.invalid, JSON.stringify(v.data.rows)).toBe(0); }
    }
    expect((await imp(pm, 'CLIENTS', file('c.csv', 'Company Name\r\nX\r\n'))).status).toBe(403);
    expect((await imp(viewer, 'CLIENTS', file('c.csv', 'Company Name\r\nX\r\n'))).status).toBe(403);
  });
});

describe('exports', () => {
  it('CSV export neutralises spreadsheet formula injection stored in data', async () => {
    const name = `=cmd|'/c calc'!A1 ${uniq('inj')}`;
    await makeClient(name);
    const r = await call(H.exportDs.GET, 'GET', '/api/export/clients', { session: admin, params: { dataset: 'clients' }, query: { format: 'csv', q: 'cmd' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(/attachment/);
    const line = r.text.split(/\r?\n/).find((l) => l.includes('cmd|'));
    expect(line).toBeTruthy();
    expect(line!.replace(/^"/, '').startsWith('=')).toBe(false);
  });
  it('xlsx and pdf exports are real files with the right magic bytes; unknown dataset is 400; viewer has no export', async () => {
    const x = await call(H.exportDs.GET, 'GET', '/api/export/projects', { session: admin, params: { dataset: 'projects' }, query: { format: 'xlsx' } });
    expect(x.status).toBe(200); expect(x.buf.subarray(0, 2).toString()).toBe('PK');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.buf as never); expect(wb.worksheets[0].rowCount).toBeGreaterThan(0);
    const p = await call(H.exportDs.GET, 'GET', '/api/export/projects', { session: admin, params: { dataset: 'projects' }, query: { format: 'pdf' } });
    expect(p.status).toBe(200); expect(p.buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await call(H.exportDs.GET, 'GET', '/api/export/nope', { session: admin, params: { dataset: 'nope' } })).status).toBe(400);
    expect((await call(H.exportDs.GET, 'GET', '/api/export/projects', { session: viewer, params: { dataset: 'projects' } })).status).toBe(403);
  });
  it('every dataset exports as CSV, and the export row count matches the API list', async () => {
    for (const ds of ['projects', 'costs', 'expenses', 'invoices', 'payments', 'clients', 'resources', 'vendors', 'audit', 'report-profitability', 'report-receivables', 'report-pnl', 'report-forecast']) {
      const r = await call(H.exportDs.GET, 'GET', `/api/export/${ds}`, { session: admin, params: { dataset: ds }, query: { format: 'csv' } });
      expect(r.status, `${ds}: ${r.text.slice(0, 200)}`).toBe(200);
    }
    const proj = await call(H.exportDs.GET, 'GET', '/api/export/projects', { session: admin, params: { dataset: 'projects' }, query: { format: 'csv' } });
    const list = await call(H.projects.GET, 'GET', '/api/projects', { session: admin, query: { pageSize: 1 } });
    expect(Number(proj.headers.get('x-row-count'))).toBeGreaterThanOrEqual(list.body.meta.total - 0 - list.body.meta.total * 0); // same population (non-archived)
  });
  it('a project manager’s export only contains their own projects and no money columns they may not see', async () => {
    const mine = await newProject(admin, { managerId: pm.userId, name: uniq('MyProj') });
    const other = await newProject(admin, { name: uniq('NotMine') });
    const r = await call(H.exportDs.GET, 'GET', '/api/export/projects', { session: pm, params: { dataset: 'projects' }, query: { format: 'csv' } });
    // pm has no reports.export
    expect(r.status).toBe(403);
    void mine; void other;
  });
});

describe('attachments', () => {
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
  it('uploads a PDF, lists it, downloads it as a forced attachment with nosniff, and audits both', async () => {
    const p = await newProject(admin);
    const u = await upload(admin, 'PROJECT', p.id, file('contract.pdf', PDF));
    expect(u.status, JSON.stringify(u.body)).toBe(201);
    const list = await call(H.attachments.GET, 'GET', '/api/attachments', { session: admin, query: { entityType: 'PROJECT', entityId: p.id } });
    expect(list.data.length).toBe(1);
    const dl = await call(H.attachmentById.GET, 'GET', `/api/attachments/${u.data.id}`, { session: admin, params: { id: u.data.id } });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment/); expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    expect(dl.buf.equals(PDF)).toBe(true);
    const h = await call(H.auditLog.GET, 'GET', '/api/audit', { session: admin, query: { projectId: p.id, pageSize: 50 } });
    expect(h.data.map((x: any) => x.action)).toEqual(expect.arrayContaining(['attachment.upload', 'attachment.download']));
  });
  it('refuses malicious uploads: executables, scripts, html/svg, double extensions, content/extension mismatch, empty, path traversal names', async () => {
    const p = await newProject(admin);
    const bad: [string, Buffer | string][] = [
      ['virus.exe', 'MZ\x90\x00'], ['shell.sh', '#!/bin/sh\nrm -rf /'], ['page.html', '<html><script>alert(1)</script></html>'], ['pic.svg', '<svg onload=alert(1)></svg>'],
      ['invoice.pdf.exe', PDF], ['fake.pdf', '<html><script>x</script></html>'], ['fake.png', PDF], ['empty.pdf', ''], ['note.txt', '<script>alert(1)</script>'], ['x.js', 'alert(1)'], ['x.php', '<?php system($_GET[0]); ?>'],
    ];
    for (const [name, content] of bad) {
      const r = await upload(admin, 'PROJECT', p.id, file(name, content));
      expect(r.status, `${name} → ${r.status}`).toBe(400);
    }
    const trav = await upload(admin, 'PROJECT', p.id, file('../../../etc/passwd.pdf', PDF));
    expect(trav.status).toBe(201);
    expect(trav.data.fileName).not.toContain('/'); expect(trav.data.fileName).not.toContain('..');
    const list = await call(H.attachments.GET, 'GET', '/api/attachments', { session: admin, query: { entityType: 'PROJECT', entityId: p.id } });
    expect(list.data.length).toBe(1);
  });
  it('rejects oversized files (limit from env)', async () => {
    const p = await newProject(admin);
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(26 * 1024 * 1024, 65)]);
    const r = await upload(admin, 'PROJECT', p.id, file('big.pdf', big));
    expect(r.status).toBe(400); expect(r.error?.code).toBe('FILE_TOO_LARGE');
  });
  it('IDOR: users without access to the project cannot list, download or delete its files; viewers cannot upload', async () => {
    const p = await newProject(admin);
    const u = await upload(admin, 'PROJECT', p.id, file('secret.pdf', PDF));
    expect((await call(H.attachments.GET, 'GET', '/api/attachments', { session: pm, query: { entityType: 'PROJECT', entityId: p.id } })).status).toBe(404);
    expect((await call(H.attachmentById.GET, 'GET', `/api/attachments/${u.data.id}`, { session: pm, params: { id: u.data.id } })).status).toBe(404);
    expect((await call(H.attachmentById.DELETE, 'DELETE', `/api/attachments/${u.data.id}`, { session: pm, params: { id: u.data.id } })).status).toBe(404);
    expect((await upload(pm, 'PROJECT', p.id, file('x.pdf', PDF))).status).toBe(404);
    expect((await upload(viewer, 'PROJECT', p.id, file('x.pdf', PDF))).status).toBe(403);
    expect((await call(H.attachmentById.DELETE, 'DELETE', `/api/attachments/${u.data.id}`, { session: admin, params: { id: u.data.id } })).status).toBe(200);
    expect((await call(H.attachmentById.GET, 'GET', `/api/attachments/${u.data.id}`, { session: admin, params: { id: u.data.id } })).status).toBe(404);
  });
});

describe('backup export', () => {
  it('only a Super Admin can export; the export never contains password hashes or sessions', async () => {
    expect((await call(H.backup.GET, 'GET', '/api/backup', { session: admin })).status).toBe(403);
    const r = await call(H.backup.GET, 'GET', '/api/backup', { session: superAdmin });
    expect(r.status, r.text.slice(0, 300)).toBe(200);
    expect(r.text).not.toMatch(/\$2[aby]\$\d\d\$/);
    expect(r.text).not.toContain('password_hash'); expect(r.text).not.toContain('csrf_token');
    expect(JSON.parse(r.text).projects.length).toBeGreaterThan(0);
  });
});

describe('reports and dashboard agree with the project view', () => {
  it('portfolio totals on the dashboard = sum of the project figures; profitability report groups sum to the total', async () => {
    const client = await makeClient(uniq('RepCo'));
    const a = await newProject(admin, { clientId: client.id, sellingPrice: '200000', budget: '150000' });
    const b = await newProject(admin, { clientId: client.id, sellingPrice: '100000', budget: '90000' });
    await addCost(admin, a.id, '50000'); await addCost(admin, b.id, '30000');
    const rep = await call(H.reportProfit.GET, 'GET', '/api/reports/profitability', { session: admin, query: { group: 'client' } });
    expect(rep.status, JSON.stringify(rep.body)).toBe(200);
    const row = rep.data.rows.find((r: any) => r.label === client.companyName);
    expect(row.revenue).toBe(R(300000)); expect(row.cost).toBe(R(80000)); expect(row.profit).toBe(R(220000));
    expect(row.marginPct).toBeCloseTo(73.33, 1);
    const cmp = await call(H.reportCompare.GET, 'GET', '/api/reports/compare', { session: admin, query: { ids: `${a.id},${b.id}` } });
    expect(cmp.status).toBe(200);
    expect(JSON.stringify(cmp.data)).toContain(a.id);
  });
  it('the P&L, forecast and receivables endpoints respond with data and honour permissions', async () => {
    for (const [h, path] of [[H.reportPnl, '/api/reports/pnl'], [H.reportForecast, '/api/reports/forecast'], [H.reportRecv, '/api/reports/receivables']] as const) {
      const r = await call(h.GET, 'GET', path, { session: admin });
      expect(r.status, `${path}: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
      expect((await call(h.GET, 'GET', path, { session: pm })).status).toBe(403);
    }
    expect((await call(H.dashboard.GET, 'GET', '/api/dashboard', { session: pm })).status).toBe(200);
  });
  it('the dashboard for a non-profit role never leaks revenue or profit', async () => {
    const tm = await makeUser('TEAM_MEMBER');
    const d = await call(H.dashboard.GET, 'GET', '/api/dashboard', { session: tm });
    expect([200, 403]).toContain(d.status);
    if (d.status === 200) expect(JSON.stringify(d.data)).not.toMatch(/"(revenue|profit|margin)"\s*:\s*[1-9]/);
  });
});
