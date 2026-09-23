'use client';
import { useEffect, useState } from 'react';
import { api, ApiFail, qs } from '@/ui/api';
import { Field, Input, MoneyInput, Notice, Select, Textarea, useForm, useToast } from '@/ui/kit';
import { today, money, title } from '@/ui/format';
import { useApi } from '@/ui/hooks';
import { FormModal } from '@/components/form-modal';
import { ProjectPicker } from '@/components/pickers';

const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// ───────────── invoice ─────────────
export function InvoiceForm({ open, onClose, onSaved, projectId }: { open: boolean; onClose: () => void; onSaved: () => void; projectId?: string }) {
  const toast = useToast();
  const f = useForm({ projectId: '', type: 'CUSTOM', milestoneId: '', description: '', status: 'ISSUED', issueDate: today(), dueDate: addDays(today(), 30), subtotal: '', taxAmount: '', customTax: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);
  useEffect(() => { if (open) { f.reset({ projectId: projectId ?? '', type: 'CUSTOM', milestoneId: '', description: '', status: 'ISSUED', issueDate: today(), dueDate: addDays(today(), 30), subtotal: '', taxAmount: '', customTax: false }); setError(null); } /* eslint-disable-next-line */ }, [open]);
  const v = f.values;
  const proj = useApi<any>(v.projectId ? `/api/projects/${v.projectId}` : null);
  const milestones: any[] = proj.data?.milestones ?? [];
  const p = proj.data?.project;
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!v.projectId) e.projectId = 'Choose a project';
    if (!v.subtotal || Number(v.subtotal) <= 0) e.subtotal = 'Enter an amount greater than zero';
    if (!v.dueDate) e.dueDate = 'Choose a due date';
    if (v.status === 'ISSUED' && v.issueDate && v.dueDate < v.issueDate) e.dueDate = 'Due date is before the issue date';
    if (Object.keys(e).length) { f.setErrors(e); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post<any>('/api/invoices', { projectId: v.projectId, type: v.type, milestoneId: v.type === 'MILESTONE' && v.milestoneId ? v.milestoneId : null, description: v.description || null, status: v.status, issueDate: v.status === 'ISSUED' ? v.issueDate : null, dueDate: v.dueDate, subtotal: v.subtotal, taxAmount: v.customTax ? v.taxAmount || '0' : undefined });
      toast.success(`Invoice ${r.data.number ?? ''} ${v.status === 'ISSUED' ? 'issued' : 'scheduled'}`); onSaved(); onClose();
    } catch (err) { setError(err as ApiFail); f.fail(err); }
    setBusy(false);
  };
  return (
    <FormModal open={open} onClose={onClose} title="New invoice" onSubmit={submit} busy={busy} error={error} size="lg" submitLabel={v.status === 'ISSUED' ? 'Issue invoice' : 'Schedule invoice'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project" required error={f.errors.projectId} className="sm:col-span-2"><ProjectPicker value={v.projectId} onChange={(x) => f.set('projectId', x)} disabled={!!projectId} invalid={!!f.errors.projectId} /></Field>
        <Field label="Type"><Select {...f.bind('type')}>{['ADVANCE', 'MILESTONE', 'MONTHLY', 'QUARTERLY', 'FINAL', 'CUSTOM'].map((t) => <option key={t} value={t}>{title(t)}</option>)}</Select></Field>
        {v.type === 'MILESTONE' ? <Field label="Milestone"><Select {...f.bind('milestoneId')}><option value="">—</option>{milestones.map((m) => <option key={m.id} value={m.id}>{m.name} ({money(m.price)})</option>)}</Select></Field> : <Field label="Status"><Select {...f.bind('status')}><option value="ISSUED">Issue now</option><option value="SCHEDULED">Schedule for later</option></Select></Field>}
        {v.type === 'MILESTONE' && <Field label="Status"><Select {...f.bind('status')}><option value="ISSUED">Issue now</option><option value="SCHEDULED">Schedule for later</option></Select></Field>}
        <Field label="Amount before tax" required error={f.errors.subtotal} hint={p ? `Tax: ${p.taxMode === 'NONE' ? 'none' : `${Number(p.taxRatePct)}% ${p.taxMode.toLowerCase()}`} (GST split by state)` : undefined}><MoneyInput value={v.subtotal} onChange={(x) => f.set('subtotal', x)} invalid={!!f.errors.subtotal} /></Field>
        {v.status === 'ISSUED' && <Field label="Issue date"><Input type="date" {...f.bind('issueDate')} /></Field>}
        <Field label="Due date" required error={f.errors.dueDate}><Input type="date" {...f.bind('dueDate')} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea {...f.bind('description')} rows={2} maxLength={500} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 rounded border-ink-300" checked={v.customTax} onChange={(e) => f.set('customTax', e.target.checked)} />Override the tax amount</label>
        {v.customTax && <Field label="Tax amount"><MoneyInput value={v.taxAmount} onChange={(x) => f.set('taxAmount', x)} /></Field>}
      </div>
      <Notice>The invoice number is assigned automatically and never reused.</Notice>
    </FormModal>
  );
}

// ───────────── payment ─────────────
export function PaymentForm({ open, onClose, onSaved, projectId, invoiceId }: { open: boolean; onClose: () => void; onSaved: () => void; projectId?: string; invoiceId?: string }) {
  const toast = useToast();
  const f = useForm({ projectId: '', invoiceId: '', kind: 'RECEIPT', amount: '', tdsAmount: '', receivedDate: today(), method: 'BANK_TRANSFER', reference: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);
  const v = f.values;
  const invs = useApi<any[]>(open && (v.projectId || invoiceId) ? `/api/invoices${qs({ projectId: v.projectId || undefined, pageSize: 100, sort: 'dueDate', dir: 'asc' })}` : null);
  const open_ = (invs.data ?? []).filter((i) => ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status));
  useEffect(() => { if (open) { f.reset({ projectId: projectId ?? '', invoiceId: invoiceId ?? '', kind: 'RECEIPT', amount: '', tdsAmount: '', receivedDate: today(), method: 'BANK_TRANSFER', reference: '', notes: '' }); setError(null); } /* eslint-disable-next-line */ }, [open]);
  // when an invoice is preselected (from an invoice row) derive the project and default amount
  const sel = invs.data?.find((i) => i.id === v.invoiceId);
  useEffect(() => { if (sel && !v.projectId) f.set('projectId', sel.projectId); if (sel && !v.amount && invoiceId) f.set('amount', String(Number(sel.outstanding))); /* eslint-disable-next-line */ }, [sel?.id]);
  const pickInvoice = (id: string) => { f.set('invoiceId', id); const i = invs.data?.find((x) => x.id === id); if (i) f.set('amount', String(Number(i.outstanding))); };
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!v.projectId && !v.invoiceId) e.projectId = 'Choose a project';
    if (!v.amount || Number(v.amount) <= 0) e.amount = 'Enter an amount greater than zero';
    if (!v.receivedDate) e.receivedDate = 'Choose the date received'; else if (v.receivedDate > today()) e.receivedDate = 'The date cannot be in the future';
    if (Object.keys(e).length) { f.setErrors(e); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post<any>('/api/payments', { projectId: v.projectId || undefined, invoiceId: v.invoiceId || null, kind: v.kind, amount: v.amount, tdsAmount: v.kind === 'RECEIPT' ? v.tdsAmount || '0' : '0', receivedDate: v.receivedDate, method: v.method, reference: v.reference || null, notes: v.notes || null });
      if (r.data.overpaidBy > 0) toast.info(`Recorded. Note: this overpays the invoice by ₹${(r.data.overpaidBy / 100).toLocaleString('en-IN')} (kept as a credit balance).`); else toast.success(v.kind === 'REFUND' ? 'Refund recorded' : 'Payment recorded');
      onSaved(); onClose();
    } catch (err) { setError(err as ApiFail); f.fail(err); }
    setBusy(false);
  };
  return (
    <FormModal open={open} onClose={onClose} title={v.kind === 'REFUND' ? 'Record refund' : 'Record payment'} onSubmit={submit} busy={busy} error={error} size="lg" submitLabel={v.kind === 'REFUND' ? 'Record refund' : 'Record payment'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project" required error={f.errors.projectId}><ProjectPicker value={v.projectId} onChange={(x) => { f.set('projectId', x); f.set('invoiceId', ''); }} disabled={!!projectId || !!invoiceId} invalid={!!f.errors.projectId} /></Field>
        <Field label="Applies to invoice" hint="Leave empty to record an advance / on-account payment."><Select value={v.invoiceId} disabled={!!invoiceId || !v.projectId} onChange={(e) => pickInvoice(e.target.value)}><option value="">No invoice (advance)</option>{open_.map((i) => <option key={i.id} value={i.id}>{i.number} · due {money(i.outstanding)}</option>)}{sel && !open_.some((i) => i.id === sel.id) && <option value={sel.id}>{sel.number}</option>}</Select></Field>
        <Field label="Type"><Select {...f.bind('kind')}><option value="RECEIPT">Payment received</option><option value="REFUND">Refund to client</option></Select></Field>
        <Field label="Amount received" required error={f.errors.amount} hint={v.kind === 'RECEIPT' ? 'The cash actually received in the bank.' : undefined}><MoneyInput value={v.amount} onChange={(x) => f.set('amount', x)} invalid={!!f.errors.amount} /></Field>
        {v.kind === 'RECEIPT' && <Field label="TDS deducted by client" hint="Counts towards settling the invoice but is not cash received."><MoneyInput value={v.tdsAmount} onChange={(x) => f.set('tdsAmount', x)} /></Field>}
        <Field label="Date received" required error={f.errors.receivedDate}><Input type="date" max={today()} {...f.bind('receivedDate')} /></Field>
        <Field label="Method"><Select {...f.bind('method')}>{['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'OTHER'].map((m) => <option key={m} value={m}>{title(m)}</option>)}</Select></Field>
        <Field label="Reference / UTR"><Input {...f.bind('reference')} maxLength={120} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea {...f.bind('notes')} rows={2} maxLength={1000} /></Field>
      </div>
    </FormModal>
  );
}
