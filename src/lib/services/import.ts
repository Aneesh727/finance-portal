/**
 * CSV / Excel import: parse -> validate every row (with a per-row error list and duplicate detection) -> commit.
 * Commit re-validates the same file (matched by SHA-256 of the batch) and inserts each valid row in its own savepoint,
 * so one bad row never blocks the others and nothing is half-written.
 */
import crypto from 'node:crypto';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Executor } from '@/lib/db';
import { categories, clients, importBatches, projects, resourceRateHistory, resources, vendors, expenses, projectCosts } from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { audit, type Actor } from '@/lib/audit';
import { ApiError, badRequest, conflict, notFound } from '@/lib/errors';
import { env } from '@/lib/env';
import { clientBody, resourceBody, projectBody, expenseBody, costBody } from '@/lib/validators';
import { stateFromGstin } from '@/lib/schemas';
import { getSettings } from '@/lib/settings';
import { todayStr } from '@/lib/dates';
import { deriveRates } from './resources';
import { createProject } from './projects';
import { createExpense } from './expenses';
import { createCost } from './costs';
import { IMPORT_KINDS } from '@/db/schema';

export type ImportKind = (typeof IMPORT_KINDS)[number];
type Row = Record<string, string>;
const MAX_ROWS = 5000;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

interface ColumnSpec { key: string; label: string; required?: boolean; example: string; aliases?: string[] }
interface Lookups { categoriesByName: Map<string, string>; vendorsByName: Map<string, string>; clientsByName: Map<string, string>; projectsByCode: Map<string, string>; servicesByName: Map<string, string>; costCatByName: Map<string, string> }
interface Kind {
  columns: ColumnSpec[];
  /** validate a row -> value or errors */
  parse(r: Row, lk: Lookups): { value?: unknown; errors: string[] };
  /** stable identity used for duplicate detection */
  key(v: never): string;
  existing(exec: Executor, keys: string[]): Promise<Set<string>>;
  insert(tx: Executor, ctx: { user: AuthUser; actor: Actor }, v: never, lk: Lookups): Promise<void>;
}

const zerr = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.') || 'row'}: ${i.message}`);
const blank = (s: string | undefined) => (s === undefined || s.trim() === '' ? undefined : s.trim());

async function lookups(exec: Executor): Promise<Lookups> {
  const cats = await exec.select().from(categories).where(eq(categories.active, true));
  const m = (kind: string) => new Map(cats.filter((c) => c.kind === kind).map((c) => [c.name.toLowerCase(), c.id]));
  const v = await exec.select({ id: vendors.id, name: vendors.name }).from(vendors).where(sql`${vendors.archivedAt} is null`);
  const cl = await exec.select({ id: clients.id, name: clients.companyName }).from(clients).where(sql`${clients.archivedAt} is null`);
  const pr = await exec.select({ id: projects.id, code: projects.code }).from(projects);
  return {
    categoriesByName: m('EXPENSE'), costCatByName: m('COST'), servicesByName: m('SERVICE'),
    vendorsByName: new Map(v.map((x) => [x.name.toLowerCase(), x.id])), clientsByName: new Map(cl.map((x) => [x.name.toLowerCase(), x.id])), projectsByCode: new Map(pr.map((x) => [x.code.toLowerCase(), x.id])),
  };
}

const KINDS: Record<ImportKind, Kind> = {
  CLIENTS: {
    columns: [
      { key: 'companyName', label: 'Company Name', required: true, example: 'Acme Traders Pvt Ltd', aliases: ['client', 'name', 'company'] }, { key: 'contactPerson', label: 'Contact Person', example: 'Riya Shah' },
      { key: 'email', label: 'Email', example: 'riya@acme.in' }, { key: 'phone', label: 'Phone', example: '+91 98765 43210' }, { key: 'industry', label: 'Industry', example: 'Retail' },
      { key: 'gstin', label: 'GSTIN', example: '27AAPFU0939F1ZV' }, { key: 'country', label: 'Country', example: 'India' }, { key: 'currency', label: 'Currency', example: 'INR' }, { key: 'address', label: 'Address', example: 'Mumbai' },
    ],
    parse(r) { const p = clientBody.safeParse(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, blank(v)]))); return p.success ? { value: p.data, errors: [] } : { errors: zerr(p.error) }; },
    key: (v: { companyName: string }) => v.companyName.trim().toLowerCase(),
    async existing(exec, keys) { const r = await exec.select({ n: clients.companyName }).from(clients).where(sql`${clients.archivedAt} is null AND lower(${clients.companyName}) IN (${sql.join(keys.map((k) => sql`${k}`), sql`,`)})`); return new Set(r.map((x) => x.n.toLowerCase())); },
    async insert(tx, ctx, v: z.infer<typeof clientBody>) {
      const [c] = await tx.insert(clients).values({ ...v, companyName: v.companyName.trim(), stateCode: stateFromGstin(v.gstin), isDemo: false }).returning();
      await audit(tx, ctx.actor, { action: 'client.create', entityType: 'client', entityId: c.id, summary: `Imported client ${c.companyName}`, new: c });
    },
  },
  RESOURCES: {
    columns: [
      { key: 'name', label: 'Name', required: true, example: 'Aarav Mehta' }, { key: 'role', label: 'Role', required: true, example: 'Developer' }, { key: 'type', label: 'Type', required: true, example: 'FREELANCER' },
      { key: 'hourlyCost', label: 'Hourly Cost', example: '600' }, { key: 'dailyCost', label: 'Daily Cost', example: '4800' }, { key: 'monthlyCost', label: 'Monthly Cost', example: '0' }, { key: 'billingRate', label: 'Billing Rate', example: '1200' },
      { key: 'email', label: 'Email', example: 'aarav@example.com' }, { key: 'department', label: 'Department', example: 'Engineering' },
    ],
    parse(r) { const p = resourceBody.safeParse(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'type' ? blank(v)?.toUpperCase() : blank(v)]))); return p.success ? { value: p.data, errors: [] } : { errors: zerr(p.error) }; },
    key: (v: { name: string; role: string; type: string }) => `${v.name.trim().toLowerCase()}|${v.role.trim().toLowerCase()}|${v.type}`,
    async existing(exec, keys) { const r = await exec.select({ n: resources.name, r: resources.role, t: resources.type }).from(resources).where(sql`${resources.archivedAt} is null`); const set = new Set(r.map((x) => `${x.n.toLowerCase()}|${x.r.toLowerCase()}|${x.t}`)); return new Set(keys.filter((k) => set.has(k))); },
    async insert(tx, ctx, v: z.infer<typeof resourceBody>) {
      const s = await getSettings(tx);
      const rates = deriveRates(v, s);
      const [r] = await tx.insert(resources).values({ ...v, ...rates }).returning();
      await tx.insert(resourceRateHistory).values({ resourceId: r.id, effectiveOn: todayStr(), hourlyCost: r.hourlyCost, dailyCost: r.dailyCost, monthlyCost: r.monthlyCost, billingRate: r.billingRate });
      await audit(tx, ctx.actor, { action: 'resource.create', entityType: 'resource', entityId: r.id, summary: `Imported ${r.type.toLowerCase()} ${r.name}`, new: r });
    },
  },
  PROJECTS: {
    columns: [
      { key: 'name', label: 'Project Name', required: true, example: 'ABC Store Build', aliases: ['project'] }, { key: 'client', label: 'Client', required: true, example: 'Acme Traders Pvt Ltd', aliases: ['clientname'] },
      { key: 'service', label: 'Service', required: true, example: 'Web Development' }, { key: 'type', label: 'Type', required: true, example: 'ONE_TIME' }, { key: 'status', label: 'Status', example: 'ACTIVE' },
      { key: 'sellingPrice', label: 'Selling Price', example: '500000' }, { key: 'discount', label: 'Discount', example: '0' }, { key: 'budget', label: 'Budget', example: '300000' },
      { key: 'startDate', label: 'Start Date', example: '2026-04-01' }, { key: 'endDate', label: 'End Date', example: '2026-09-30' }, { key: 'currency', label: 'Currency', example: 'INR' }, { key: 'taxRatePct', label: 'Tax Rate %', example: '18' },
    ],
    parse(r, lk) {
      const errors: string[] = [];
      const clientId = lk.clientsByName.get((r.client ?? '').trim().toLowerCase());
      const serviceId = lk.servicesByName.get((r.service ?? '').trim().toLowerCase());
      if (!clientId) errors.push(`client: "${r.client ?? ''}" does not exist. Import clients first.`);
      if (!serviceId) errors.push(`service: "${r.service ?? ''}" is not an active service category.`);
      if ((r.type ?? '').toUpperCase() === 'RETAINER') errors.push('type: retainers cannot be imported (they need fee terms). Create them in the Retainers module.');
      const p = projectBody.omit({ clientId: true, serviceId: true }).safeParse({ ...Object.fromEntries(Object.entries(r).filter(([k]) => !['client', 'service'].includes(k)).map(([k, v]) => [k, k === 'type' || k === 'status' ? blank(v)?.toUpperCase() : blank(v)])), status: blank(r.status)?.toUpperCase() ?? 'LEAD' });
      if (!p.success) errors.push(...zerr(p.error));
      return errors.length ? { errors } : { value: { ...p.data!, clientId, serviceId }, errors };
    },
    key: (v: { name: string; clientId: string }) => `${v.name.trim().toLowerCase()}|${v.clientId}`,
    async existing(exec, keys) { const r = await exec.select({ n: projects.name, c: projects.clientId }).from(projects).where(sql`${projects.archivedAt} is null`); const set = new Set(r.map((x) => `${x.n.toLowerCase()}|${x.c}`)); return new Set(keys.filter((k) => set.has(k))); },
    async insert(tx, ctx, v: z.infer<typeof projectBody>) { await createProject(tx, ctx, v); },
  },
  EXPENSES: {
    columns: [
      { key: 'date', label: 'Date', required: true, example: '2026-09-01' }, { key: 'category', label: 'Category', required: true, example: 'Software' }, { key: 'description', label: 'Description', required: true, example: 'Figma subscription' },
      { key: 'amount', label: 'Amount', required: true, example: '12500' }, { key: 'taxAmount', label: 'Tax Amount', example: '2250' }, { key: 'vendor', label: 'Vendor', example: 'Figma Inc' }, { key: 'scope', label: 'Scope', example: 'COMPANY' },
      { key: 'project', label: 'Project Code', example: 'PRJ-0001' }, { key: 'department', label: 'Department', example: 'Design' }, { key: 'paymentMethod', label: 'Payment Method', example: 'CARD' }, { key: 'reference', label: 'Reference', example: 'INV-889' },
    ],
    parse(r, lk) {
      const errors: string[] = [];
      const categoryId = lk.categoriesByName.get((r.category ?? '').trim().toLowerCase());
      if (!categoryId) errors.push(`category: "${r.category ?? ''}" is not an active expense category.`);
      let vendorId: string | null = null;
      if (blank(r.vendor)) { vendorId = lk.vendorsByName.get(r.vendor.trim().toLowerCase()) ?? null; if (!vendorId) errors.push(`vendor: "${r.vendor}" does not exist.`); }
      let projectId: string | null = null;
      if (blank(r.project)) { projectId = lk.projectsByCode.get(r.project.trim().toLowerCase()) ?? null; if (!projectId) errors.push(`project: code "${r.project}" does not exist.`); }
      const scope = (blank(r.scope) ?? (projectId ? 'PROJECT' : 'COMPANY')).toUpperCase();
      const p = expenseBody.safeParse({ date: blank(r.date), categoryId, description: blank(r.description), amount: blank(r.amount), taxAmount: blank(r.taxAmount) ?? '0', vendorId, scope, projectId, department: blank(r.department), paymentMethod: (blank(r.paymentMethod) ?? 'BANK_TRANSFER').toUpperCase().replace(/ /g, '_'), reference: blank(r.reference) });
      if (!p.success) errors.push(...zerr(p.error));
      return errors.length ? { errors } : { value: p.data, errors };
    },
    key: (v: { date: string; description: string; amount: string; vendorId: string | null }) => `${v.date}|${v.description.trim().toLowerCase()}|${Number(v.amount).toFixed(2)}|${v.vendorId ?? ''}`,
    async existing(exec, keys) {
      const r = await exec.select({ d: expenses.date, s: expenses.description, a: expenses.originalAmount, v: expenses.vendorId }).from(expenses).where(sql`${expenses.archivedAt} is null`);
      const set = new Set(r.map((x) => `${x.d}|${x.s.trim().toLowerCase()}|${Number(x.a).toFixed(2)}|${x.v ?? ''}`)); return new Set(keys.filter((k) => set.has(k)));
    },
    async insert(tx, ctx, v: z.infer<typeof expenseBody>) { await createExpense(tx, ctx, v); },
  },
  COSTS: {
    columns: [
      { key: 'project', label: 'Project Code', required: true, example: 'PRJ-0001' }, { key: 'date', label: 'Date', required: true, example: '2026-09-01' }, { key: 'category', label: 'Category', required: true, example: 'Developer' },
      { key: 'name', label: 'Cost Name', required: true, example: 'Sprint 3 development' }, { key: 'amount', label: 'Amount', required: true, example: '45000' }, { key: 'kind', label: 'Kind', example: 'ACTUAL' }, { key: 'vendor', label: 'Vendor', example: 'Freelance Co' }, { key: 'notes', label: 'Notes', example: '' },
    ],
    parse(r, lk) {
      const errors: string[] = [];
      const projectId = lk.projectsByCode.get((r.project ?? '').trim().toLowerCase());
      if (!projectId) errors.push(`project: code "${r.project ?? ''}" does not exist.`);
      const categoryId = lk.costCatByName.get((r.category ?? '').trim().toLowerCase());
      if (!categoryId) errors.push(`category: "${r.category ?? ''}" is not an active cost category.`);
      let vendorId: string | null = null;
      if (blank(r.vendor)) { vendorId = lk.vendorsByName.get(r.vendor.trim().toLowerCase()) ?? null; if (!vendorId) errors.push(`vendor: "${r.vendor}" does not exist.`); }
      const p = costBody.safeParse({ projectId, name: blank(r.name), categoryId, amount: blank(r.amount), date: blank(r.date), kind: (blank(r.kind) ?? 'ACTUAL').toUpperCase(), vendorId, notes: blank(r.notes) });
      if (!p.success) errors.push(...zerr(p.error));
      return errors.length ? { errors } : { value: p.data, errors };
    },
    key: (v: { projectId: string; date: string; name: string; amount: string }) => `${v.projectId}|${v.date}|${v.name.trim().toLowerCase()}|${Number(v.amount).toFixed(2)}`,
    async existing(exec, keys) {
      const r = await exec.select({ p: projectCosts.projectId, d: projectCosts.date, n: projectCosts.name, a: projectCosts.originalAmount }).from(projectCosts).where(sql`${projectCosts.archivedAt} is null`);
      const set = new Set(r.map((x) => `${x.p}|${x.d}|${x.n.trim().toLowerCase()}|${Number(x.a).toFixed(2)}`)); return new Set(keys.filter((k) => set.has(k)));
    },
    async insert(tx, ctx, v: z.infer<typeof costBody>) { await createCost(tx, ctx, v); },
  },
};

export function templateCsv(kind: ImportKind): string {
  const c = KINDS[kind].columns;
  return '﻿' + c.map((x) => x.label).join(',') + '\r\n' + c.map((x) => (/[,"]/.test(x.example) ? `"${x.example}"` : x.example)).join(',') + '\r\n';
}

// ───────────── parsing ─────────────
export async function parseFile(buf: Buffer, fileName: string): Promise<{ headers: string[]; rows: Row[] }> {
  const max = env().MAX_UPLOAD_MB * 1024 * 1024;
  if (buf.length === 0) throw badRequest('The file is empty.');
  if (buf.length > max) throw badRequest(`File is too large. The limit is ${env().MAX_UPLOAD_MB} MB.`, undefined, 'FILE_TOO_LARGE');
  const ext = fileName.toLowerCase().split('.').pop();
  let table: string[][];
  if (ext === 'csv' || ext === 'txt') {
    const text = buf.toString('utf8').replace(/^﻿/, '');
    if (text.includes('\u0000')) throw badRequest('That does not look like a CSV file.');
    const res = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
    if (res.errors.some((e) => e.type === 'Quotes')) throw badRequest('The CSV has unbalanced quotes. Check the file and try again.');
    table = res.data;
  } else if (ext === 'xlsx') {
    if (!(buf[0] === 0x50 && buf[1] === 0x4b)) throw badRequest('That does not look like an Excel (.xlsx) file.');
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf as never); } catch { throw badRequest('The Excel file could not be read.'); }
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest('The Excel file has no sheets.');
    table = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => {
        if (v === null || v === undefined) return '';
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'object') { const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] }; return String(o.result ?? o.text ?? o.richText?.map((t) => t.text).join('') ?? ''); }
        return String(v);
      });
      table.push(vals);
    });
  } else throw badRequest('Upload a .csv or .xlsx file.', undefined, 'FILE_TYPE_NOT_ALLOWED');
  if (table.length < 2) throw badRequest('The file needs a header row and at least one data row.');
  if (table.length - 1 > MAX_ROWS) throw badRequest(`The file has more than ${MAX_ROWS} rows. Split it into smaller files.`);
  return { headers: table[0].map((h) => String(h ?? '').trim()), rows: table.slice(1).map((r) => Object.fromEntries(table[0].map((h, i) => [String(h ?? '').trim(), String(r[i] ?? '').trim()]))) };
}

function mapHeaders(kind: ImportKind, headers: string[]) {
  const spec = KINDS[kind].columns;
  const byNorm = new Map<string, string>();
  for (const c of spec) { byNorm.set(norm(c.label), c.key); byNorm.set(norm(c.key), c.key); for (const a of c.aliases ?? []) byNorm.set(norm(a), c.key); }
  const map = new Map<string, string>();
  const unknown: string[] = [];
  for (const h of headers) { const k = byNorm.get(norm(h)); if (k && ![...map.values()].includes(k)) map.set(h, k); else if (h) unknown.push(h); }
  const missing = spec.filter((c) => c.required && ![...map.values()].includes(c.key)).map((c) => c.label);
  return { map, unknown, missing };
}

export interface RowResult { row: number; status: 'valid' | 'invalid' | 'duplicate'; errors: string[]; data: Record<string, string> }

const PHONE = /^\+\d[\d\s()-]{5,}$/; // "+91 98765 43210" is legitimate
const NUMBER = /^-\d+([.,]\d+)*$/; // a plain negative number is legitimate
const isInjection = (v: string) => (PHONE.test(v) || NUMBER.test(v) ? false : /^[=+@\t\r-]/.test(v));

async function validateRows(exec: Executor, kind: ImportKind, parsed: { headers: string[]; rows: Row[] }) {
  const { map, unknown, missing } = mapHeaders(kind, parsed.headers);
  if (missing.length) throw badRequest(`The file is missing required column(s): ${missing.join(', ')}. Download the template to see the expected headers.`, { missing }, 'MISSING_COLUMNS');
  const lk = await lookups(exec);
  const K = KINDS[kind];
  const out: (RowResult & { value?: unknown })[] = [];
  const seen = new Map<string, number>();
  const keyed: { i: number; key: string }[] = [];
  parsed.rows.forEach((raw, idx) => {
    const r: Row = {};
    for (const [h, k] of map) r[k] = raw[h] ?? '';
    const errors: string[] = [];
    for (const [k, v] of Object.entries(r)) if (isInjection(v)) errors.push(`${k}: cells starting with = + - @ are not accepted (possible spreadsheet formula).`);
    let value: unknown;
    if (!errors.length) { const p = K.parse(r, lk); errors.push(...p.errors); value = p.value; }
    const res: RowResult & { value?: unknown } = { row: idx + 2, status: errors.length ? 'invalid' : 'valid', errors, data: r, value };
    if (!errors.length) {
      const key = K.key(value as never);
      if (seen.has(key)) { res.status = 'duplicate'; res.errors.push(`Duplicate of row ${seen.get(key)} in this file.`); }
      else { seen.set(key, res.row); keyed.push({ i: out.length, key }); }
    }
    out.push(res);
  });
  if (keyed.length) {
    const ex = await K.existing(exec, keyed.map((k) => k.key));
    for (const k of keyed) if (ex.has(k.key)) { out[k.i].status = 'duplicate'; out[k.i].errors.push('Already exists in the system.'); }
  }
  return { rows: out, unknown, lookups: lk };
}

export async function validateImport(user: AuthUser, kind: ImportKind, buf: Buffer, fileName: string) {
  const parsed = await parseFile(buf, fileName);
  const { rows, unknown } = await validateRows(db, kind, parsed);
  const hash = crypto.createHash('sha256').update(buf).update(kind).digest('hex');
  const valid = rows.filter((r) => r.status === 'valid').length, invalid = rows.filter((r) => r.status === 'invalid').length, dup = rows.filter((r) => r.status === 'duplicate').length;
  const [prev] = await db.select().from(importBatches).where(and(eq(importBatches.kind, kind), eq(importBatches.fileHash, hash), eq(importBatches.status, 'COMMITTED'))).limit(1);
  const [batch] = await db.insert(importBatches).values({ kind, fileName, fileHash: hash, totalRows: rows.length, validRows: valid, invalidRows: invalid, skippedRows: dup, createdById: user.id }).returning();
  return {
    batchId: batch.id, kind, fileName, totals: { rows: rows.length, valid, invalid, duplicates: dup }, ignoredColumns: unknown,
    alreadyImportedOn: prev?.committedAt ?? null,
    rows: rows.slice(0, 500).map(({ value, ...r }) => { void value; return r; }),
    truncated: rows.length > 500,
  };
}

export async function commitImport(user: AuthUser, actor: Actor, kind: ImportKind, batchId: string, buf: Buffer, fileName: string, o: { skipInvalid: boolean; allowReimport: boolean }) {
  const hash = crypto.createHash('sha256').update(buf).update(kind).digest('hex');
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1);
  if (!batch || batch.createdById !== user.id) throw notFound('Import batch');
  if (batch.kind !== kind || batch.fileHash !== hash) throw conflict('This file is not the one that was validated. Validate it again.', 'BATCH_MISMATCH');
  if (batch.status !== 'VALIDATED') throw conflict(`This import was already ${batch.status.toLowerCase()}.`, 'BATCH_DONE');
  if (!o.allowReimport) {
    const [prev] = await db.select().from(importBatches).where(and(eq(importBatches.kind, kind), eq(importBatches.fileHash, hash), eq(importBatches.status, 'COMMITTED'))).limit(1);
    if (prev) throw conflict(`This exact file was already imported on ${prev.committedAt?.toISOString().slice(0, 10)}. Confirm to import it again.`, 'ALREADY_IMPORTED');
  }
  const parsed = await parseFile(buf, fileName);
  const claimed = await db.update(importBatches).set({ status: 'COMMITTED', committedAt: new Date() }).where(and(eq(importBatches.id, batchId), eq(importBatches.status, 'VALIDATED'))).returning({ id: importBatches.id });
  if (!claimed.length) throw conflict('This import is already being processed.', 'BATCH_DONE');
  try {
    const result = await db.transaction(async (tx) => {
      const { rows, lookups: lk } = await validateRows(tx, kind, parsed);
      const bad = rows.filter((r) => r.status === 'invalid');
      if (bad.length && !o.skipInvalid) throw new ApiError(422, 'IMPORT_HAS_ERRORS', `${bad.length} row(s) have errors. Fix them or choose to skip invalid rows.`, { invalid: bad.length });
      const inserted: number[] = [];
      const failed: { row: number; error: string }[] = [];
      for (const r of rows) {
        if (r.status !== 'valid') continue;
        try {
          await tx.transaction(async (sp) => { await KINDS[kind].insert(sp, { user, actor }, r.value as never, lk); });
          inserted.push(r.row);
        } catch (e) {
          failed.push({ row: r.row, error: e instanceof ApiError ? e.message : (e as { code?: string }).code === '23505' ? 'Duplicate of an existing record.' : 'Could not be saved.' });
        }
      }
      await tx.update(importBatches).set({ insertedRows: inserted.length, skippedRows: rows.length - inserted.length }).where(eq(importBatches.id, batchId));
      await audit(tx, actor, { action: 'import.commit', entityType: 'import', entityId: batchId, summary: `Imported ${inserted.length} ${kind.toLowerCase()} from ${fileName} (${rows.filter((r) => r.status === 'duplicate').length} duplicates skipped, ${bad.length + failed.length} failed)`, new: { fileName, inserted: inserted.length, failed: failed.length } });
      return { inserted: inserted.length, duplicates: rows.filter((r) => r.status === 'duplicate').length, invalid: bad.length, failed };
    });
    return result;
  } catch (e) {
    await db.update(importBatches).set({ status: 'VALIDATED', committedAt: null }).where(eq(importBatches.id, batchId));
    throw e;
  }
}
