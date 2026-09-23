'use client';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { useApi } from '@/ui/hooks';
import { Badge, Button, Card, Check, Field, Input, MoneyInput, Select, SimpleTable, Textarea, useForm, useToast, Loading, ErrorBox } from '@/ui/kit';
import { dmy, money, title, today } from '@/ui/format';
import { useSession } from '@/ui/session';
import { FormModal } from '@/components/form-modal';
import { RowActions } from '@/components/row-actions';
import { CategorySelect, ProjectPicker, VendorSelect } from '@/components/pickers';

export function RecurringTab() {
  const { can } = useSession();
  const toast = useToast();
  const { data, error, reload } = useApi<any[]>('/api/recurring');
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const manage = can('expenses.edit');
  const generate = async (r: any) => { try { const res = await api.post<any>(`/api/recurring/${r.id}/generate`, {}); toast.success(res.data?.created ? `Generated ${res.data.created} expense${res.data.created === 1 ? '' : 's'}` : 'Nothing due — already up to date'); reload(); } catch (e) { toast.fail(e); } };
  const toggle = async (r: any) => { try { await api.patch(`/api/recurring/${r.id}`, { active: !r.active }); toast.success(r.active ? 'Paused' : 'Resumed'); reload(); } catch (e) { toast.fail(e); } };
  return (
    <Card pad={false}>
      <div className="flex items-center justify-between gap-2 p-4"><div><h2>Recurring expenses</h2><p className="text-xs text-ink-500">Subscriptions, rent and retainers that repeat. Due occurrences are generated automatically each day; you can also generate them here.</p></div>{manage && <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>New rule</Button>}</div>
      <ErrorBox error={error} className="m-4" />
      {!data ? (error ? null : <Loading />) : <SimpleTable rows={data} empty={<p className="p-8 text-center text-sm text-ink-500">No recurring rules yet.</p>} columns={[
        { key: 'name', label: 'Rule', render: (r) => <span className="font-medium text-ink-900">{r.name}{!r.active && <Badge className="ml-2">Paused</Badge>}<span className="block text-xs font-normal text-ink-500">{r.category}{r.vendor ? ` · ${r.vendor}` : ''}{r.projectCode ? ` · ${r.projectCode}` : ''}</span></span> },
        { key: 'freq', label: 'Repeats', render: (r) => r.frequency === 'CUSTOM' ? `Every ${r.intervalMonths} months` : title(r.frequency) },
        { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount) },
        { key: 'start', label: 'Starts', render: (r) => dmy(r.startDate) }, { key: 'end', label: 'Ends', render: (r) => (r.endDate ? dmy(r.endDate) : 'Ongoing') },
        { key: 'next', label: 'Next dates', render: (r) => <span className="text-xs text-ink-600">{(r.next ?? []).slice(0, 3).map(dmy).join(', ') || '—'}</span> },
        { key: 'a', label: '', render: (r) => manage && <RowActions actions={[{ label: 'Edit', onClick: () => setEdit(r) }, { label: 'Generate due now', onClick: () => generate(r), hidden: !r.active }, { label: r.active ? 'Pause' : 'Resume', onClick: () => toggle(r) }]} /> },
      ]} />}
      <RuleForm rule={edit && edit !== 'new' ? edit : null} open={!!edit} onClose={() => setEdit(null)} onSaved={reload} />
    </Card>
  );
}

function RuleForm({ rule, open, onClose, onSaved }: { rule: any | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const blank = { name: '', categoryId: '', vendorId: '', scope: 'COMPANY', projectId: '', department: '', amount: '', taxAmount: '', frequency: 'MONTHLY', intervalMonths: '1', startDate: today(), endDate: '', active: true, notes: '' };
  const f = useForm<any>(blank);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  useEffect(() => { if (open) { f.reset(rule ? { name: rule.name, categoryId: rule.categoryId, vendorId: rule.vendorId ?? '', scope: rule.scope, projectId: rule.projectId ?? '', department: rule.department ?? '', amount: rule.amount, taxAmount: rule.taxAmount ?? '', frequency: rule.frequency, intervalMonths: String(rule.intervalMonths), startDate: rule.startDate, endDate: rule.endDate ?? '', active: rule.active, notes: rule.notes ?? '' } : blank); setError(null); } /* eslint-disable-next-line */ }, [open, rule?.id]);
  const v = f.values;
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!v.name.trim()) e.name = 'Enter a name'; if (!v.categoryId) e.categoryId = 'Choose a category'; if (!v.amount || Number(v.amount) <= 0) e.amount = 'Enter an amount'; if (!v.startDate) e.startDate = 'Required';
    if (v.scope === 'PROJECT' && !v.projectId) e.projectId = 'Choose a project';
    if (v.endDate && v.endDate < v.startDate) e.endDate = 'Ends before it starts';
    if (Object.keys(e).length) { f.setErrors(e); return; }
    setBusy(true); setError(null);
    const body = { name: v.name.trim(), categoryId: v.categoryId, vendorId: v.vendorId || null, scope: v.scope, projectId: v.scope === 'PROJECT' ? v.projectId : null, department: v.scope === 'DEPARTMENT' ? v.department || null : null, amount: v.amount, taxAmount: v.taxAmount || '0', frequency: v.frequency, intervalMonths: Number(v.intervalMonths || 1), startDate: v.startDate, endDate: v.endDate || null, active: v.active, notes: v.notes || null };
    try { if (rule) await api.patch(`/api/recurring/${rule.id}`, body); else await api.post('/api/recurring', body); toast.success('Rule saved'); onSaved(); onClose(); }
    catch (err) { setError(err as ApiFail); f.fail(err); }
    setBusy(false);
  };
  return (
    <FormModal open={open} onClose={onClose} title={rule ? 'Edit recurring rule' : 'New recurring rule'} onSubmit={submit} busy={busy} error={error} size="lg">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={f.errors.name} className="sm:col-span-2"><Input {...f.bind('name')} maxLength={150} /></Field>
        <Field label="Category" required error={f.errors.categoryId}><CategorySelect kind="expense" value={v.categoryId} onChange={(x) => f.set('categoryId', x)} invalid={!!f.errors.categoryId} /></Field>
        <Field label="Vendor"><VendorSelect value={v.vendorId} onChange={(x) => f.set('vendorId', x)} /></Field>
        <Field label="Amount each time" required error={f.errors.amount}><MoneyInput value={v.amount} onChange={(x) => f.set('amount', x)} invalid={!!f.errors.amount} /></Field>
        <Field label="…of which tax"><MoneyInput value={v.taxAmount} onChange={(x) => f.set('taxAmount', x)} /></Field>
        <Field label="Repeats"><Select {...f.bind('frequency')}><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="YEARLY">Yearly</option><option value="CUSTOM">Every N months</option></Select></Field>
        {v.frequency === 'CUSTOM' && <Field label="Every N months"><Input inputMode="numeric" {...f.bind('intervalMonths')} /></Field>}
        <Field label="Starts" required error={f.errors.startDate}><Input type="date" {...f.bind('startDate')} /></Field>
        <Field label="Ends (optional)" error={f.errors.endDate}><Input type="date" {...f.bind('endDate')} /></Field>
        <Field label="Belongs to"><Select {...f.bind('scope')}><option value="COMPANY">Company</option><option value="PROJECT">A project</option><option value="DEPARTMENT">A department</option></Select></Field>
        {v.scope === 'PROJECT' && <Field label="Project" required error={f.errors.projectId}><ProjectPicker value={v.projectId} onChange={(x) => f.set('projectId', x)} initialLabel={rule?.projectCode ? `${rule.projectCode} · ${rule.projectName}` : undefined} /></Field>}
        {v.scope === 'DEPARTMENT' && <Field label="Department"><Input {...f.bind('department')} /></Field>}
        <Field label="Notes" className="sm:col-span-2"><Textarea {...f.bind('notes')} rows={2} maxLength={1000} /></Field>
        <div className="sm:col-span-2"><Check label="Active" checked={v.active} onChange={(x) => f.set('active', x)} /></div>
      </div>
    </FormModal>
  );
}
