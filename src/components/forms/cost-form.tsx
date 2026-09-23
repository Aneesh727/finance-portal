'use client';
import { useEffect, useState } from 'react';
import { api, ApiFail } from '@/ui/api';
import { Check, Field, Input, MoneyInput, Select, Textarea, useForm, useToast } from '@/ui/kit';
import { today } from '@/ui/format';
import { FormModal, BudgetOverride } from '@/components/form-modal';
import { CategorySelect, ProjectPicker, ResourceSelect, VendorSelect } from '@/components/pickers';
import { useSession } from '@/ui/session';

export interface CostRow { id: string; projectId: string; projectCode?: string; projectName?: string; name: string; categoryId: string; description: string | null; kind: string; status: string; amount: string; originalAmount: string; isCredit: boolean; date: string; vendorId: string | null; resourceId: string | null; recurrence: string; recurrenceIntervalMonths: number | null; recurrenceEnds: string | null; notes: string | null; version: number; expenseId: string | null }

const blank = { projectId: '', name: '', categoryId: '', kind: 'ACTUAL', amount: '', date: today(), vendorId: '', resourceId: '', description: '', notes: '', isCredit: false, paid: false, recurrence: 'NONE', recurrenceIntervalMonths: '', recurrenceEnds: '' };

export function CostForm({ open, onClose, onSaved, cost, projectId, defaultKind }: { open: boolean; onClose: () => void; onSaved: () => void; cost?: CostRow | null; projectId?: string; defaultKind?: string }) {
  const toast = useToast();
  const { can } = useSession();
  const f = useForm(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);
  const [ov, setOv] = useState(false);
  const [ovReason, setOvReason] = useState('');
  const edit = !!cost;
  useEffect(() => {
    if (!open) return;
    setError(null); setOv(false); setOvReason('');
    f.reset(cost ? { projectId: cost.projectId, name: cost.name, categoryId: cost.categoryId, kind: cost.kind, amount: cost.originalAmount, date: cost.date, vendorId: cost.vendorId ?? '', resourceId: cost.resourceId ?? '', description: cost.description ?? '', notes: cost.notes ?? '', isCredit: cost.isCredit, paid: cost.status === 'PAID', recurrence: cost.recurrence, recurrenceIntervalMonths: cost.recurrenceIntervalMonths ? String(cost.recurrenceIntervalMonths) : '', recurrenceEnds: cost.recurrenceEnds ?? '' } : { ...blank, kind: defaultKind ?? 'ACTUAL', projectId: projectId ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cost?.id]);
  const v = f.values;
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!v.projectId) e.projectId = 'Choose a project';
    if (!v.name.trim()) e.name = 'Enter a name';
    if (!v.categoryId) e.categoryId = 'Choose a category';
    if (!v.amount || Number(v.amount) <= 0) e.amount = 'Enter an amount greater than zero';
    if (!v.date) e.date = 'Choose a date';
    if (v.recurrence === 'CUSTOM' && !v.recurrenceIntervalMonths) e.recurrenceIntervalMonths = 'Enter months';
    if (Object.keys(e).length) { f.setErrors(e); return; }
    setBusy(true); setError(null);
    const body: Record<string, unknown> = {
      name: v.name.trim(), categoryId: v.categoryId, kind: v.kind, amount: v.amount, date: v.date, isCredit: v.isCredit, description: v.description || null, notes: v.notes || null,
      vendorId: v.vendorId || null, resourceId: v.resourceId || null, recurrence: v.recurrence, recurrenceIntervalMonths: v.recurrence === 'CUSTOM' ? Number(v.recurrenceIntervalMonths) : null, recurrenceEnds: v.recurrenceEnds || null,
      overrideBudget: ov, overrideReason: ov ? ovReason : null,
    };
    if (v.kind === 'ACTUAL' && can('costs.approve')) body.status = v.paid ? 'PAID' : 'APPROVED';
    try {
      const r = edit ? await api.patch<any>(`/api/costs/${cost!.id}`, { ...body, kind: undefined, version: cost!.version }) : await api.post<any>('/api/costs', { ...body, projectId: v.projectId });
      if (r.data.requiresApproval) toast.info('Sent for approval — it will count once approved.'); else toast.success(edit ? 'Cost updated' : 'Cost added');
      onSaved(); onClose();
    } catch (err) { setError(err as ApiFail); f.fail(err); setBusy(false); return; }
    setBusy(false);
  };
  return (
    <FormModal open={open} onClose={onClose} title={edit ? 'Edit cost' : v.kind === 'ESTIMATED' ? 'Add estimated cost' : v.kind === 'COMMITTED' ? 'Add committed cost' : 'Add cost'} onSubmit={submit} busy={busy} error={error} size="lg" submitLabel={edit ? 'Save changes' : 'Add cost'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project" required error={f.errors.projectId} className="sm:col-span-2"><ProjectPicker value={v.projectId} onChange={(x) => f.set('projectId', x)} disabled={edit || !!projectId} invalid={!!f.errors.projectId} /></Field>
        <Field label="Name" required error={f.errors.name}><Input {...f.bind('name')} maxLength={150} placeholder="e.g. Freelance developer – sprint 2" /></Field>
        <Field label="Category" required error={f.errors.categoryId}><CategorySelect kind="cost" value={v.categoryId} onChange={(x) => f.set('categoryId', x)} invalid={!!f.errors.categoryId} /></Field>
        <Field label="Type" hint={v.kind === 'ESTIMATED' ? 'A planned figure; not counted as spend.' : v.kind === 'COMMITTED' ? 'Promised but not yet incurred (PO / agreement).' : 'Money actually spent or owed.'}>
          <Select value={v.kind} disabled={edit} onChange={(e) => f.set('kind', e.target.value)}><option value="ACTUAL">Actual</option><option value="COMMITTED">Committed</option><option value="ESTIMATED">Estimated</option></Select></Field>
        <Field label="Amount" required error={f.errors.amount}><MoneyInput value={v.amount} onChange={(x) => f.set('amount', x)} invalid={!!f.errors.amount} /></Field>
        <Field label="Date" required error={f.errors.date}><Input type="date" {...f.bind('date')} /></Field>
        <Field label="Vendor"><VendorSelect value={v.vendorId} onChange={(x) => f.set('vendorId', x)} /></Field>
        <Field label="Resource (person / agency)"><ResourceSelect value={v.resourceId} onChange={(x) => f.set('resourceId', x)} placeholder="None" /></Field>
        <Field label="Repeats"><Select value={v.recurrence} onChange={(e) => f.set('recurrence', e.target.value)}>{['NONE', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM'].map((r) => <option key={r} value={r}>{r === 'NONE' ? 'Does not repeat' : r[0] + r.slice(1).toLowerCase()}</option>)}</Select></Field>
        {v.recurrence !== 'NONE' && <Field label={v.recurrence === 'CUSTOM' ? 'Every N months' : 'Repeat until (optional)'} error={f.errors.recurrenceIntervalMonths}>
          {v.recurrence === 'CUSTOM' ? <Input inputMode="numeric" {...f.bind('recurrenceIntervalMonths')} /> : <Input type="date" {...f.bind('recurrenceEnds')} />}</Field>}
        <Field label="Description" className="sm:col-span-2"><Textarea {...f.bind('description')} maxLength={2000} rows={2} /></Field>
        <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2">
          <Check label="Credit / refund (reduces cost)" checked={v.isCredit} onChange={(x) => f.set('isCredit', x)} />
          {v.kind === 'ACTUAL' && can('costs.approve') && <Check label="Already paid" checked={v.paid} onChange={(x) => f.set('paid', x)} />}
        </div>
      </div>
      <BudgetOverride error={error} on={ov} setOn={setOv} reason={ovReason} setReason={setOvReason} />
    </FormModal>
  );
}
