'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { api } from '@/ui/api';
import { Badge, Button, DataTable, Modal, Select, StatusBadge, useConfirm, useToast, DL, type Column } from '@/ui/kit';
import { dmy, inr, money, title } from '@/ui/format';
import { useSession } from '@/ui/session';
import { useApi } from '@/ui/hooks';
import { RowActions } from './row-actions';
import { InvoiceForm, PaymentForm } from './forms/billing-forms';
import { ExportMenu } from './export-menu';
import { Attachments } from './attachments';

export function InvoicesTable({ projectId, initialStatus = '', initialQ }: { projectId?: string; initialStatus?: string; initialQ?: string }) {
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState(initialStatus);
  const [key, setKey] = useState(0);
  const [inv, setInv] = useState(false);
  const [pay, setPay] = useState<{ projectId: string; invoiceId: string } | null>(null);
  const [view, setView] = useState<string | null>(null);
  const reload = () => setKey((k) => k + 1);
  const manage = can('payments.manage');
  const issue = async (r: any) => { try { await api.post(`/api/invoices/${r.id}/issue`, {}); toast.success(`Invoice ${r.number} issued`); reload(); } catch (e) { toast.fail(e); } };
  const cancel = async (r: any) => {
    const c = await confirm({ title: `Cancel invoice ${r.number}?`, message: 'The invoice stays in the records as cancelled and no longer counts towards revenue or receivables.', danger: true, confirmLabel: 'Cancel invoice', reason: { label: 'Reason', required: true } });
    if (!c.ok) return;
    try { await api.post(`/api/invoices/${r.id}/cancel`, { reason: c.reason }); toast.success('Invoice cancelled'); reload(); } catch (e) { toast.fail(e); }
  };
  const cols: Column<any>[] = [
    { key: 'number', label: 'Invoice', sort: 'number', render: (r) => <button className="link text-left font-medium" onClick={(e) => { e.stopPropagation(); setView(r.id); }}>{r.number}<span className="block text-xs font-normal text-ink-500">{title(r.type)}</span></button> },
    ...(projectId ? [] : [{ key: 'project', label: 'Project', sort: 'project', render: (r: any) => <Link className="link" href={`/projects/${r.projectId}`} onClick={(e) => e.stopPropagation()}>{r.projectCode}<span className="block max-w-[14rem] truncate text-xs text-ink-500">{r.clientName}</span></Link> }]),
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'issueDate', label: 'Issued', sort: 'issueDate', hideBelow: 'md', render: (r) => dmy(r.issueDate) },
    { key: 'dueDate', label: 'Due', sort: 'dueDate', render: (r) => <span className={r.status === 'OVERDUE' ? 'text-red-600' : ''}>{dmy(r.dueDate)}</span> },
    { key: 'total', label: 'Total', sort: 'total', align: 'right', render: (r) => money(r.total, r.currency) },
    { key: 'settled', label: 'Received', align: 'right', hideBelow: 'md', render: (r) => money(r.received, r.currency) },
    { key: 'outstanding', label: 'Outstanding', align: 'right', render: (r) => <span className={Number(r.outstanding) > 0 ? 'font-medium text-ink-900' : 'text-ink-400'}>{money(r.outstanding, r.currency)}</span> },
    { key: 'a', label: '', render: (r) => <RowActions actions={[
      { label: 'View / print', onClick: () => setView(r.id) },
      { label: 'Issue now', onClick: () => issue(r), hidden: !manage || r.status !== 'SCHEDULED' },
      { label: 'Record payment', onClick: () => setPay({ projectId: r.projectId, invoiceId: r.id }), hidden: !manage || !['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(r.status) },
      { label: 'Cancel invoice', danger: true, onClick: () => cancel(r), hidden: !manage || r.status === 'CANCELLED' || r.status === 'PAID' },
    ]} /> },
  ];
  return (
    <>
      <DataTable<any> url="/api/invoices" params={{ projectId, status }} reloadKey={key} columns={cols} defaultSort="dueDate" defaultDir="desc" searchPlaceholder="Search invoice number, project, client…" initialSearch={initialQ} onRow={(r) => setView(r.id)}
        emptyTitle="No invoices" emptyHint={manage ? 'Create an invoice or set up a payment schedule on the project.' : undefined}
        summary={(m) => <>Outstanding on this view: <b className="tabular-nums text-ink-900">{inr(m.outstandingMinor ?? 0)}</b> · {m.total} invoice{m.total === 1 ? '' : 's'}</>}
        filters={<Select className="w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['SCHEDULED', 'PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'].map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select>}
        toolbar={<><ExportMenu dataset="invoices" params={{ projectId, status: status || undefined }} />{manage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setInv(true)}>New invoice</Button>}</>} />
      <InvoiceForm open={inv} onClose={() => setInv(false)} onSaved={reload} projectId={projectId} />
      <PaymentForm open={!!pay} onClose={() => setPay(null)} onSaved={reload} projectId={pay?.projectId} invoiceId={pay?.invoiceId} />
      <InvoiceView id={view} onClose={() => setView(null)} />
    </>
  );
}

export function InvoiceView({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data } = useApi<{ invoice: any; payments: any[] }>(id ? `/api/invoices/${id}` : null);
  const { me } = useSession();
  const i = data?.invoice;
  return (
    <Modal open={!!id} onClose={onClose} title={i ? `Invoice ${i.number}` : 'Invoice'} size="lg" footer={<><Button onClick={() => window.print()}>Print</Button><Button variant="primary" onClick={onClose}>Close</Button></>}>
      {!i ? <p className="py-8 text-center text-sm text-ink-500">Loading…</p> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs uppercase tracking-wide text-ink-400">From</p><p className="font-medium">{me.company?.name}</p></div><StatusBadge status={i.status} /></div>
          <DL items={[['Client', i.clientName], ['Project', <Link key="p" className="link" href={`/projects/${i.projectId}`}>{i.projectCode} · {i.projectName}</Link>], ['Type', title(i.type)], ['Issue date', dmy(i.issueDate)], ['Due date', dmy(i.dueDate)], ['Description', i.description]]} />
          <table className="w-full text-sm"><tbody>
            <tr><td className="py-1 text-ink-500">Amount before tax</td><td className="py-1 text-right tabular-nums">{money(i.subtotal, i.currency)}</td></tr>
            {Number(i.cgst) > 0 && <tr><td className="py-1 text-ink-500">CGST</td><td className="py-1 text-right tabular-nums">{money(i.cgst, i.currency)}</td></tr>}
            {Number(i.sgst) > 0 && <tr><td className="py-1 text-ink-500">SGST</td><td className="py-1 text-right tabular-nums">{money(i.sgst, i.currency)}</td></tr>}
            {Number(i.igst) > 0 && <tr><td className="py-1 text-ink-500">IGST</td><td className="py-1 text-right tabular-nums">{money(i.igst, i.currency)}</td></tr>}
            <tr className="border-t border-ink-200 font-semibold"><td className="py-1.5">Total</td><td className="py-1.5 text-right tabular-nums">{money(i.total, i.currency)}</td></tr>
            <tr><td className="py-1 text-ink-500">Received</td><td className="py-1 text-right tabular-nums">{money(i.received, i.currency)}</td></tr>
            {Number(i.tds) > 0 && <tr><td className="py-1 text-ink-500">TDS deducted</td><td className="py-1 text-right tabular-nums">{money(i.tds, i.currency)}</td></tr>}
            <tr className="border-t border-ink-100 font-medium"><td className="py-1.5">Outstanding</td><td className="py-1.5 text-right tabular-nums">{money(i.outstanding, i.currency)}</td></tr>
          </tbody></table>
          {i.cancelReason && <p className="rounded-lg bg-ink-50 p-2 text-sm text-ink-600">Cancelled: {i.cancelReason}</p>}
          {data!.payments.length > 0 && <div><h3 className="mb-1">Payments</h3><ul className="divide-y divide-ink-100 text-sm">{data!.payments.map((p) => <li key={p.id} className="flex justify-between py-1.5"><span>{dmy(p.receivedDate)} · {title(p.method)}{p.reference ? ` · ${p.reference}` : ''}{p.voidedAt && <Badge className="ml-2">Voided</Badge>}{p.kind === 'REFUND' && <Badge tone="purple" className="ml-2">Refund</Badge>}</span><span className="tabular-nums">{money(p.amount, i.currency)}{Number(p.tdsAmount) > 0 && <span className="text-ink-400"> + {money(p.tdsAmount, i.currency)} TDS</span>}</span></li>)}</ul></div>}
          <Attachments entityType="INVOICE" entityId={i.id} canWrite={false} compact />
        </div>)}
    </Modal>
  );
}

export function PaymentsTable({ projectId }: { projectId?: string }) {
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [key, setKey] = useState(0);
  const [form, setForm] = useState(false);
  const [voided, setVoided] = useState('0');
  const manage = can('payments.manage');
  const reload = () => setKey((k) => k + 1);
  const voidIt = async (r: any) => {
    const c = await confirm({ title: 'Void this payment?', message: `${money(r.amount, r.currency)} received on ${dmy(r.receivedDate)} will stop counting towards the invoice and cash position.`, danger: true, confirmLabel: 'Void payment', reason: { label: 'Reason', required: true } });
    if (!c.ok) return;
    try { await api.post(`/api/payments/${r.id}/void`, { reason: c.reason }); toast.success('Payment voided'); reload(); } catch (e) { toast.fail(e); }
  };
  const cols: Column<any>[] = [
    { key: 'receivedDate', label: 'Received', sort: 'receivedDate', render: (r) => dmy(r.receivedDate) },
    ...(projectId ? [] : [{ key: 'project', label: 'Project', sort: 'project', render: (r: any) => <Link className="link" href={`/projects/${r.projectId}`}>{r.projectCode}<span className="block max-w-[14rem] truncate text-xs text-ink-500">{r.projectName}</span></Link> }]),
    { key: 'invoice', label: 'Invoice', render: (r) => r.invoiceNumber ?? <span className="text-xs text-ink-400">Advance</span> },
    { key: 'method', label: 'Method', hideBelow: 'md', render: (r) => <span>{title(r.method)}{r.reference && <span className="block text-xs text-ink-500">{r.reference}</span>}</span> },
    { key: 'kind', label: 'Type', render: (r) => r.voidedAt ? <Badge>Voided</Badge> : r.kind === 'REFUND' ? <Badge tone="purple">Refund</Badge> : <Badge tone="green">Receipt</Badge> },
    { key: 'tds', label: 'TDS', align: 'right', hideBelow: 'md', render: (r) => Number(r.tdsAmount) > 0 ? money(r.tdsAmount, r.currency) : '—' },
    { key: 'amount', label: 'Amount', sort: 'amount', align: 'right', render: (r) => <span className={r.voidedAt ? 'text-ink-400 line-through' : r.kind === 'REFUND' ? 'text-purple-700' : ''}>{r.kind === 'REFUND' ? '−' : ''}{money(r.amount, r.currency)}</span> },
    { key: 'a', label: '', render: (r) => <RowActions actions={[{ label: 'Void payment', danger: true, onClick: () => voidIt(r), hidden: !manage || !!r.voidedAt }]} /> },
  ];
  return (
    <>
      <DataTable<any> url="/api/payments" params={{ projectId, voided }} reloadKey={key} columns={cols} defaultSort="receivedDate" searchPlaceholder="Search reference, invoice, project…" emptyTitle="No payments recorded" emptyHint={manage ? 'Record a payment when money arrives.' : undefined}
        summary={(m) => <>Net received on this view: <b className="tabular-nums text-ink-900">{inr(m.netReceivedMinor ?? 0)}</b> · {m.total} payment{m.total === 1 ? '' : 's'}</>}
        filters={<Select className="w-36" aria-label="Voided" value={voided} onChange={(e) => setVoided(e.target.value)}><option value="0">Not voided</option><option value="1">Voided only</option><option value="all">All</option></Select>}
        toolbar={<><ExportMenu dataset="payments" params={{ projectId }} />{manage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setForm(true)}>Record payment</Button>}</>} />
      <PaymentForm open={form} onClose={() => setForm(false)} onSaved={reload} projectId={projectId} />
    </>
  );
}
