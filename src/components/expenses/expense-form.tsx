'use client';
import { useEffect, useState } from 'react';
import { api, ApiFail } from '@/ui/api';
import { Field, Input, MoneyInput, Select, Textarea, useForm, useToast } from '@/ui/kit';
import { today, title } from '@/ui/format';
import { FormModal, BudgetOverride } from '@/components/form-modal';
import { CategorySelect, ProjectPicker, VendorSelect } from '@/components/pickers';
import { useSession } from '@/ui/session';

const blank = { date: today(), categoryId: '', description: '', amount: '', taxAmount: '', vendorId: '', paymentMethod: 'BANK_TRANSFER', scope: 'COMPANY', projectId: '', costCategoryId: '', department: '', reference: '', notes: '' };

export function ExpenseForm({ open, onClose, onSaved, expense }: { open: boolean; onClose: () => void; onSaved: () => void; expense?: any | null }) {
  const toast = useToast();
  const { can } = useSession();
  const f = useForm(blank);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  const [ov, setOv] = useState(false); const [reason, setReason] = useState('');
  const edit = !!expense;
  useEffect(() => { if (open) { f.reset(expense ? { date: expense.date, categoryId: expense.categoryId, description: expense.description, amount: expense.originalAmount ?? expense.amount, taxAmount: expense.taxAmount ?? '', vendorId: expense.vendorId ?? '', paymentMethod: expense.paymentMethod, scope: expense.scope, projectId: expense.projectId ?? '', costCategoryId: '', department: expense.department ?? '', reference: expense.reference ?? '', notes: expense.notes ?? '' } : blank); setError(null); setOv(false); setReason(''); } /* eslint-disable-next-line */ }, [open, expense?.id]);
  const v = f.values;
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!v.categoryId) e.categoryId = 'Choose a category';
    if (!v.description.trim()) e.description = 'Enter a description';
    if (!v.amount || Number(v.amount) <= 0) e.amount = 'Enter an amount greater than zero';
    if (!v.date) e.date = 'Choose a date';
    if (v.scope === 'PROJECT' && !v.projectId) e.projectId = 'Choose the project this expense belongs to';
    if (v.scope === 'DEPARTMENT' && !v.department.trim()) e.department = 'Enter the department';
    if (Object.keys(e).length) { f.setErrors(e); return; }
    setBusy(true); setError(null);
    const body: Record<string, unknown> = { date: v.date, categoryId: v.categoryId, description: v.description.trim(), amount: v.amount, taxAmount: v.taxAmount || '0', vendorId: v.vendorId || null, paymentMethod: v.paymentMethod, scope: v.scope, projectId: v.scope === 'PROJECT' ? v.projectId : null, department: v.scope === 'DEPARTMENT' ? v.department : null, reference: v.reference || null, notes: v.notes || null, costCategoryId: v.scope === 'PROJECT' && v.costCategoryId ? v.costCategoryId : null, overrideBudget: ov, overrideReason: ov ? reason : null };
    try {
      const r = edit ? await api.patch<any>(`/api/expenses/${expense.id}`, { ...body, version: expense.version }) : await api.post<any>('/api/expenses', body);
      if (r.data?.requiresApproval) toast.info('Sent for approval — it will count once approved.'); else toast.success(edit ? 'Expense updated' : 'Expense recorded');
      onSaved(); onClose();
    } catch (err) { setError(err as ApiFail); f.fail(err); }
    setBusy(false);
  };
  return (
    <FormModal open={open} onClose={onClose} title={edit ? 'Edit expense' : 'Add expense'} onSubmit={submit} busy={busy} error={error} size="lg" submitLabel={edit ? 'Save changes' : 'Add expense'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Description" required error={f.errors.description} className="sm:col-span-2"><Input {...f.bind('description')} maxLength={300} autoFocus /></Field>
        <Field label="Category" required error={f.errors.categoryId}><CategorySelect kind="expense" value={v.categoryId} onChange={(x) => f.set('categoryId', x)} invalid={!!f.errors.categoryId} /></Field>
        <Field label="Date" required error={f.errors.date}><Input type="date" {...f.bind('date')} /></Field>
        <Field label="Amount" required error={f.errors.amount} hint="Total paid, including tax."><MoneyInput value={v.amount} onChange={(x) => f.set('amount', x)} invalid={!!f.errors.amount} /></Field>
        <Field label="…of which tax (GST input credit)" hint="Informational; not deducted from cost."><MoneyInput value={v.taxAmount} onChange={(x) => f.set('taxAmount', x)} /></Field>
        <Field label="Vendor"><VendorSelect value={v.vendorId} onChange={(x) => f.set('vendorId', x)} /></Field>
        <Field label="Payment method"><Select {...f.bind('paymentMethod')}>{['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'OTHER'].map((m) => <option key={m} value={m}>{title(m)}</option>)}</Select></Field>
        <Field label="Belongs to" hint={v.scope === 'COMPANY' ? 'Company overhead. You can allocate it across projects afterwards.' : v.scope === 'PROJECT' ? 'Charged directly to one project as a cost.' : 'A department’s overhead.'}><Select {...f.bind('scope')} disabled={edit && expense.scope !== v.scope && false}><option value="COMPANY">Company (overhead)</option><option value="PROJECT">A single project</option><option value="DEPARTMENT">A department</option></Select></Field>
        {v.scope === 'PROJECT' && <><Field label="Project" required error={f.errors.projectId}><ProjectPicker value={v.projectId} onChange={(x) => f.set('projectId', x)} invalid={!!f.errors.projectId} initialLabel={expense?.projectCode ? `${expense.projectCode} · ${expense.projectName}` : undefined} /></Field>
          <Field label="Project cost category" hint="Defaults to the matching cost category."><CategorySelect kind="cost" allowEmpty placeholder="Automatic" value={v.costCategoryId} onChange={(x) => f.set('costCategoryId', x)} /></Field></>}
        {v.scope === 'DEPARTMENT' && <Field label="Department" required error={f.errors.department}><Input {...f.bind('department')} maxLength={80} /></Field>}
        <Field label="Reference / bill no."><Input {...f.bind('reference')} maxLength={120} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea {...f.bind('notes')} rows={2} maxLength={2000} /></Field>
      </div>
      {can('costs.approve') && <BudgetOverride error={error} on={ov} setOn={setOv} reason={reason} setReason={setReason} />}
    </FormModal>
  );
}
