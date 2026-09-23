/** Dataset builders + CSV / XLSX / PDF writers. Money columns carry integer minor units. */
import { sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { db } from '@/lib/db';
import type { AuthUser } from '@/lib/auth';
import { projectScopeSql } from '@/lib/access';
import { forbidden, badRequest } from '@/lib/errors';
import { formatMoney, formatPct } from '@/lib/money';
import { displayDate, todayStr, addMonths, monthStart } from '@/lib/dates';
import { healthFor, toBase } from '@/lib/finance/loaders';
import { loadPortfolio } from './dashboard';
import { canSeeRates } from './resources';
import { profitabilityBy, receivablesReport, companyPnl, forecast } from './reports';
import { likePattern } from '@/lib/api';

export type ColType = 'text' | 'money' | 'pct' | 'date' | 'int' | 'num';
export interface Column { key: string; label: string; type: ColType }
export interface Dataset { name: string; title: string; columns: Column[]; rows: Record<string, unknown>[]; footer?: Record<string, unknown> }
export interface Filters { from?: string; to?: string; q?: string; projectId?: string; status?: string; group?: string }

const MAX_ROWS = 50000;
const n = (v: unknown) => Number(v ?? 0);
const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);

export const DATASETS = ['projects', 'costs', 'expenses', 'invoices', 'payments', 'clients', 'resources', 'vendors', 'audit', 'report-profitability', 'report-receivables', 'report-pnl', 'report-forecast'] as const;
export type DatasetName = (typeof DATASETS)[number];

const need = (u: AuthUser, ...p: Parameters<AuthUser['perms']['has']>[0][]) => { for (const x of p) if (!u.perms.has(x)) throw forbidden('You do not have permission to export this data.'); };

export async function buildDataset(name: DatasetName, user: AuthUser, f: Filters): Promise<Dataset> {
  need(user, 'reports.export');
  const scope = projectScopeSql(user, 'p');
  const range = (col: string) => sql`${sql.raw(col)} >= ${f.from ?? '1900-01-01'}::date AND ${sql.raw(col)} <= ${f.to ?? '2999-12-31'}::date`;
  switch (name) {
    case 'projects': {
      need(user, 'projects.view');
      const pf = await loadPortfolio(user, { extra: f.status ? sql`p.status = ${f.status}::project_status` : undefined });
      const sp = user.perms.has('profit.view'), sc = user.perms.has('costs.view');
      const cols: Column[] = [
        { key: 'code', label: 'Code', type: 'text' }, { key: 'name', label: 'Project', type: 'text' }, { key: 'client', label: 'Client', type: 'text' }, { key: 'service', label: 'Service', type: 'text' },
        { key: 'type', label: 'Type', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'currency', label: 'Currency', type: 'text' }, { key: 'start', label: 'Start', type: 'date' }, { key: 'end', label: 'End', type: 'date' },
        ...(sp ? [{ key: 'revenue', label: 'Revenue', type: 'money' as const }] : []),
        ...(sc ? [{ key: 'budget', label: 'Budget', type: 'money' as const }, { key: 'cost', label: 'Actual cost', type: 'money' as const }, { key: 'projectedCost', label: 'Projected cost', type: 'money' as const }] : []),
        ...(sp ? [{ key: 'profit', label: 'Profit', type: 'money' as const }, { key: 'margin', label: 'Margin %', type: 'pct' as const }, { key: 'received', label: 'Received', type: 'money' as const }, { key: 'outstanding', label: 'Outstanding', type: 'money' as const }] : []),
        { key: 'health', label: 'Health', type: 'text' },
      ];
      return { name, title: 'Projects', columns: cols, rows: pf.rows.slice(0, MAX_ROWS).map((r) => ({
        code: r.code, name: r.name, client: r.clientName, service: r.serviceName, type: r.type, status: r.status, currency: r.currency, start: r.startDate, end: r.endDate,
        revenue: r.f.revenue.revenue, budget: r.f.budget.budget, cost: r.f.cost.actual, projectedCost: r.f.cost.projected, profit: r.f.actualProfit, margin: r.f.grossMarginPct, received: r.f.receivables.received, outstanding: r.f.receivables.outstanding, health: healthFor(r.f, user)?.status ?? '',
      })) };
    }
    case 'costs': {
      need(user, 'costs.view');
      const rows = (await db.execute(sql`SELECT c.date, p.code, p.name AS project, cat.name AS category, c.name, c.kind, c.status, c.description, v.name AS vendor, r.name AS resource, c.currency AS cur, ROUND(c.original_amount*100) AS original, c.fx_rate, ROUND(c.amount*100) AS amount, p.currency AS pcur
        FROM project_costs c JOIN projects p ON p.id = c.project_id JOIN categories cat ON cat.id = c.category_id LEFT JOIN vendors v ON v.id = c.vendor_id LEFT JOIN resources r ON r.id = c.resource_id
        WHERE c.archived_at IS NULL AND ${scope} AND ${range('c.date')} ${f.projectId ? sql`AND c.project_id = ${f.projectId}::uuid` : sql``} ${f.q ? sql`AND (c.name ILIKE ${likePattern(f.q)} OR p.name ILIKE ${likePattern(f.q)})` : sql``}
        ORDER BY c.date DESC LIMIT ${MAX_ROWS}`)).rows as Record<string, unknown>[];
      return { name, title: 'Project costs', columns: [
        { key: 'date', label: 'Date', type: 'date' }, { key: 'code', label: 'Project code', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'category', label: 'Category', type: 'text' }, { key: 'name', label: 'Cost', type: 'text' },
        { key: 'kind', label: 'Kind', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'vendor', label: 'Vendor', type: 'text' }, { key: 'resource', label: 'Resource', type: 'text' }, { key: 'cur', label: 'Cost currency', type: 'text' },
        { key: 'original', label: 'Original amount', type: 'money' }, { key: 'fx_rate', label: 'FX rate', type: 'num' }, { key: 'amount', label: 'Amount (project currency)', type: 'money' }, { key: 'pcur', label: 'Project currency', type: 'text' },
      ], rows };
    }
    case 'expenses': {
      need(user, 'expenses.view');
      const rows = (await db.execute(sql`SELECT e.date, cat.name AS category, e.description, v.name AS vendor, e.scope, p.code AS project, e.department, e.status, e.payment_method, e.reference, ROUND(e.amount*100) AS amount, ROUND(e.tax_amount*100) AS tax
        FROM expenses e JOIN categories cat ON cat.id = e.category_id LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN projects p ON p.id = e.project_id
        WHERE e.archived_at IS NULL AND (e.scope <> 'PROJECT' OR ${scope}) AND ${range('e.date')} ${f.q ? sql`AND (e.description ILIKE ${likePattern(f.q)} OR v.name ILIKE ${likePattern(f.q)})` : sql``} ORDER BY e.date DESC LIMIT ${MAX_ROWS}`)).rows as Record<string, unknown>[];
      return { name, title: 'Expenses', columns: [
        { key: 'date', label: 'Date', type: 'date' }, { key: 'category', label: 'Category', type: 'text' }, { key: 'description', label: 'Description', type: 'text' }, { key: 'vendor', label: 'Vendor', type: 'text' }, { key: 'scope', label: 'Scope', type: 'text' },
        { key: 'project', label: 'Project', type: 'text' }, { key: 'department', label: 'Department', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'payment_method', label: 'Method', type: 'text' }, { key: 'reference', label: 'Reference', type: 'text' },
        { key: 'amount', label: 'Amount (excl. tax)', type: 'money' }, { key: 'tax', label: 'Tax', type: 'money' },
      ], rows };
    }
    case 'invoices': {
      need(user, 'payments.view');
      const rows = (await db.execute(sql`SELECT i.number, i.type, i.status, i.issue_date, i.due_date, p.code, p.name AS project, c.company_name AS client, p.currency, ROUND(i.subtotal*100) AS subtotal, ROUND(i.cgst*100) AS cgst, ROUND(i.sgst*100) AS sgst, ROUND(i.igst*100) AS igst, ROUND(i.total*100) AS total,
          ROUND(COALESCE((SELECT SUM(CASE WHEN y.kind='RECEIPT' THEN y.amount + y.tds_amount ELSE -y.amount END) FROM payments y WHERE y.invoice_id = i.id AND y.voided_at IS NULL),0)*100) AS settled
        FROM invoices i JOIN projects p ON p.id = i.project_id JOIN clients c ON c.id = p.client_id WHERE ${scope} AND ${range('i.due_date')} ${f.projectId ? sql`AND i.project_id = ${f.projectId}::uuid` : sql``} ORDER BY i.due_date DESC LIMIT ${MAX_ROWS}`)).rows as Record<string, unknown>[];
      return { name, title: 'Invoices', columns: [
        { key: 'number', label: 'Invoice', type: 'text' }, { key: 'code', label: 'Project code', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'client', label: 'Client', type: 'text' }, { key: 'type', label: 'Type', type: 'text' }, { key: 'status', label: 'Status', type: 'text' },
        { key: 'issue_date', label: 'Issued', type: 'date' }, { key: 'due_date', label: 'Due', type: 'date' }, { key: 'currency', label: 'Currency', type: 'text' }, { key: 'subtotal', label: 'Subtotal', type: 'money' }, { key: 'cgst', label: 'CGST', type: 'money' }, { key: 'sgst', label: 'SGST', type: 'money' }, { key: 'igst', label: 'IGST', type: 'money' },
        { key: 'total', label: 'Total', type: 'money' }, { key: 'settled', label: 'Settled', type: 'money' },
      ], rows };
    }
    case 'payments': {
      need(user, 'payments.view');
      const rows = (await db.execute(sql`SELECT y.received_date, y.kind, i.number AS invoice, p.code, p.name AS project, p.currency, y.method, y.reference, ROUND(y.amount*100) AS amount, ROUND(y.tds_amount*100) AS tds, y.voided_at IS NOT NULL AS voided
        FROM payments y JOIN projects p ON p.id = y.project_id LEFT JOIN invoices i ON i.id = y.invoice_id WHERE ${scope} AND ${range('y.received_date')} ORDER BY y.received_date DESC LIMIT ${MAX_ROWS}`)).rows as Record<string, unknown>[];
      return { name, title: 'Payments', columns: [
        { key: 'received_date', label: 'Received', type: 'date' }, { key: 'kind', label: 'Kind', type: 'text' }, { key: 'invoice', label: 'Invoice', type: 'text' }, { key: 'code', label: 'Project code', type: 'text' }, { key: 'project', label: 'Project', type: 'text' },
        { key: 'currency', label: 'Currency', type: 'text' }, { key: 'method', label: 'Method', type: 'text' }, { key: 'reference', label: 'Reference', type: 'text' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'tds', label: 'TDS', type: 'money' }, { key: 'voided', label: 'Voided', type: 'text' },
      ], rows: rows.map((r) => ({ ...r, voided: r.voided ? 'Yes' : '' })) };
    }
    case 'clients': {
      need(user, 'clients.view');
      const rows = (await db.execute(sql`SELECT company_name, contact_person, email, phone, industry, gstin, country, currency FROM clients WHERE archived_at IS NULL ORDER BY company_name LIMIT ${MAX_ROWS}`)).rows as Record<string, unknown>[];
      return { name, title: 'Clients', columns: ['company_name:Company', 'contact_person:Contact', 'email:Email', 'phone:Phone', 'industry:Industry', 'gstin:GSTIN', 'country:Country', 'currency:Currency'].map((s) => ({ key: s.split(':')[0], label: s.split(':')[1], type: 'text' as const })), rows };
    }
    case 'vendors': {
      need(user, 'resources.view');
      const rows = (await db.execute(sql`SELECT name, contact_name, email, phone, gstin, category FROM vendors WHERE archived_at IS NULL ORDER BY name LIMIT ${MAX_ROWS}`)).rows as Record<string, unknown>[];
      return { name, title: 'Vendors', columns: ['name:Vendor', 'contact_name:Contact', 'email:Email', 'phone:Phone', 'gstin:GSTIN', 'category:Category'].map((s) => ({ key: s.split(':')[0], label: s.split(':')[1], type: 'text' as const })), rows };
    }
    case 'resources': {
      need(user, 'resources.view');
      const rates = canSeeRates(user);
      const rows = (await db.execute(sql`SELECT name, role, type, department, status, email, ROUND(hourly_cost*100) AS hourly, ROUND(monthly_cost*100) AS monthly, ROUND(billing_rate*100) AS billing FROM resources WHERE archived_at IS NULL ORDER BY name LIMIT ${MAX_ROWS}`)).rows as Record<string, unknown>[];
      return { name, title: 'Resources', columns: [
        ...['name:Name', 'role:Role', 'type:Type', 'department:Department', 'status:Status', 'email:Email'].map((s) => ({ key: s.split(':')[0], label: s.split(':')[1], type: 'text' as const })),
        ...(rates ? [{ key: 'hourly', label: 'Hourly cost', type: 'money' as const }, { key: 'monthly', label: 'Monthly cost', type: 'money' as const }, { key: 'billing', label: 'Billing rate', type: 'money' as const }] : []),
      ], rows };
    }
    case 'audit': {
      need(user, 'audit.view');
      const rows = (await db.execute(sql`SELECT created_at::text AS at, user_email, action, entity_type, entity_id, summary FROM audit_logs WHERE ${range('created_at::date')} ORDER BY id DESC LIMIT ${MAX_ROWS}`)).rows as Record<string, unknown>[];
      return { name, title: 'Audit log', columns: ['at:When', 'user_email:User', 'action:Action', 'entity_type:Entity', 'entity_id:Entity id', 'summary:Summary'].map((s) => ({ key: s.split(':')[0], label: s.split(':')[1], type: 'text' as const })), rows };
    }
    case 'report-profitability': {
      need(user, 'reports.view', 'profit.view');
      const r = await profitabilityBy(user, (f.group as never) ?? 'service', f);
      return { name, title: `Profitability by ${r.group}`, columns: [
        { key: 'label', label: r.group[0].toUpperCase() + r.group.slice(1), type: 'text' }, { key: 'projects', label: 'Projects', type: 'int' }, { key: 'revenue', label: 'Revenue', type: 'money' }, { key: 'cost', label: 'Cost', type: 'money' }, { key: 'profit', label: 'Profit', type: 'money' }, { key: 'marginPct', label: 'Margin %', type: 'pct' }, { key: 'projectedProfit', label: 'Projected profit', type: 'money' }, { key: 'overBudget', label: 'Over budget', type: 'int' },
      ], rows: r.rows, footer: { label: 'Total', ...r.totals } };
    }
    case 'report-receivables': {
      need(user, 'reports.view', 'payments.view');
      const r = await receivablesReport(user);
      return { name, title: `Receivables as of ${displayDate(r.asOf)}`, columns: [
        { key: 'number', label: 'Invoice', type: 'text' }, { key: 'client', label: 'Client', type: 'text' }, { key: 'code', label: 'Project', type: 'text' }, { key: 'dueDate', label: 'Due', type: 'date' }, { key: 'daysOverdue', label: 'Days overdue', type: 'int' }, { key: 'outstandingBase', label: 'Outstanding (base)', type: 'money' },
      ], rows: r.invoices, footer: { number: 'Total', outstandingBase: r.totalOutstanding } };
    }
    case 'report-pnl': {
      need(user, 'reports.view', 'profit.view', 'costs.view', 'expenses.view');
      const r = await companyPnl(user, f.from ?? addMonths(monthStart(todayStr()), -11), f.to ?? todayStr());
      return { name, title: 'Company profit & loss', columns: [
        { key: 'month', label: 'Month', type: 'date' }, { key: 'revenue', label: 'Revenue', type: 'money' }, { key: 'projectCost', label: 'Project costs', type: 'money' }, { key: 'companyExpenses', label: 'Company expenses', type: 'money' }, { key: 'payroll', label: 'Payroll', type: 'money' }, { key: 'totalCost', label: 'Total cost', type: 'money' }, { key: 'netProfit', label: 'Net profit', type: 'money' }, { key: 'marginPct', label: 'Margin %', type: 'pct' },
      ], rows: r.rows, footer: { month: 'Total', ...r.totals } };
    }
    case 'report-forecast': {
      need(user, 'forecast.view', 'profit.view', 'costs.view');
      const r = await forecast(user);
      return { name, title: 'Forecast', columns: [
        { key: 'month', label: 'Month', type: 'date' }, { key: 'phase', label: 'Phase', type: 'text' }, { key: 'projectedRevenue', label: 'Revenue', type: 'money' }, { key: 'actualCost', label: 'Actual cost', type: 'money' }, { key: 'committedCost', label: 'Committed', type: 'money' }, { key: 'recurringCost', label: 'Recurring project cost', type: 'money' }, { key: 'recurringExpenses', label: 'Recurring expenses', type: 'money' }, { key: 'projectedCost', label: 'Total cost', type: 'money' }, { key: 'projectedProfit', label: 'Profit', type: 'money' },
      ], rows: r.months };
    }
  }
  throw badRequest('Unknown dataset');
}

// ───────────── writers ─────────────

/** neutralise spreadsheet formula injection: cells that start with = + - @ tab or CR are prefixed with a quote */
export const safeCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
};
const csvEscape = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const money2 = (minor: number) => (minor / 100).toFixed(2);

function cellText(c: Column, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  switch (c.type) {
    case 'money': return money2(Number(v));
    case 'pct': return v === null ? '' : String(Math.round(Number(v) * 100) / 100);
    case 'date': return String(v).slice(0, 10);
    default: return String(v);
  }
}

export function toCsv(ds: Dataset): string {
  const lines = [ds.columns.map((c) => csvEscape(safeCell(c.label))).join(',')];
  const line = (r: Record<string, unknown>) => ds.columns.map((c) => csvEscape(c.type === 'text' || c.type === 'date' ? safeCell(cellText(c, r[c.key])) : cellText(c, r[c.key]))).join(',');
  for (const r of ds.rows) lines.push(line(r));
  if (ds.footer) lines.push(line(ds.footer));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export async function toXlsx(ds: Dataset): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Finance Portal';
  const ws = wb.addWorksheet(ds.title.slice(0, 31));
  ws.columns = ds.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, Math.min(40, c.label.length + 6)) }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const put = (r: Record<string, unknown>) => {
    const o: Record<string, unknown> = {};
    for (const c of ds.columns) {
      const v = r[c.key];
      if (v === null || v === undefined || v === '') o[c.key] = null;
      else if (c.type === 'money') o[c.key] = Number(v) / 100;
      else if (c.type === 'pct' || c.type === 'int' || c.type === 'num') o[c.key] = Number(v);
      else o[c.key] = safeCell(v);
    }
    return ws.addRow(o);
  };
  ds.rows.forEach(put);
  if (ds.footer) put(ds.footer).font = { bold: true };
  ds.columns.forEach((c, i) => { if (c.type === 'money') ws.getColumn(i + 1).numFmt = '#,##,##0.00'; if (c.type === 'pct') ws.getColumn(i + 1).numFmt = '0.0'; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function toPdf(ds: Dataset, meta: { company: string; by: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, info: { Title: ds.title, Author: 'Finance Portal' } });
    const chunks: Buffer[] = [];
    doc.on('data', (b: Buffer) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 60;
    const cols = ds.columns;
    const weights = cols.map((c) => (c.type === 'text' ? 2 : 1.2));
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / total) * W);
    const fmt = (c: Column, v: unknown) => {
      if (v === null || v === undefined || v === '') return '';
      if (c.type === 'money') return formatMoney(Number(v), 'INR').replace('₹', '');
      if (c.type === 'pct') return formatPct(Number(v));
      if (c.type === 'date') return displayDate(String(v).slice(0, 10));
      return String(v);
    };
    const header = () => {
      doc.fontSize(14).fillColor('#111').text(ds.title, 30, 30);
      doc.fontSize(8).fillColor('#666').text(`${meta.company} · generated ${displayDate(todayStr())} by ${meta.by} · amounts in INR unless a currency column says otherwise`, 30, 48);
      doc.moveDown(0.6);
    };
    const row = (vals: string[], bold = false, fill?: string) => {
      const y = doc.y;
      if (y > doc.page.height - 50) { doc.addPage(); header(); }
      const yy = doc.y;
      if (fill) doc.rect(30, yy - 2, W, 14).fill(fill).fillColor('#111');
      let x = 30;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor('#111');
      vals.forEach((v, i) => {
        const right = cols[i].type === 'money' || cols[i].type === 'pct' || cols[i].type === 'int' || cols[i].type === 'num';
        doc.text(v, x + 2, yy, { width: widths[i] - 4, height: 11, ellipsis: true, lineBreak: false, align: right ? 'right' : 'left' });
        x += widths[i];
      });
      doc.y = yy + 14;
    };
    header();
    row(cols.map((c) => c.label), true, '#e8ecf3');
    ds.rows.slice(0, 5000).forEach((r) => row(cols.map((c) => fmt(c, r[c.key]))));
    if (ds.rows.length > 5000) row(['… truncated at 5,000 rows in the PDF; use CSV or Excel for the full data'].concat(cols.slice(1).map(() => '')));
    if (ds.footer) row(cols.map((c) => fmt(c, ds.footer![c.key])), true, '#f3f4f6');
    doc.end();
  });
}
void toBase; void n; void cents;
