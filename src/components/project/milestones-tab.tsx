'use client';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { Badge, Button, Card, CardHeader, Field, Input, MoneyInput, Select, SimpleTable, StatusBadge, Textarea, useConfirm, useForm, useToast } from '@/ui/kit';
import { dmy, money, title } from '@/ui/format';
import { FormModal } from '@/components/form-modal';
import { RowActions } from '@/components/row-actions';

const PAY_TONE: Record<string, any> = { NOT_INVOICED: 'gray', INVOICED: 'blue', PARTIALLY_PAID: 'amber', PAID: 'green' };

export function MilestonesTab({ projectId, milestones, canEdit, canSeeMoney, currency, onChange }: { projectId: string; milestones: any[]; canEdit: boolean; canSeeMoney: boolean; currency: string; onChange: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const del = async (m: any) => {
    const c = await confirm({ title: `Delete milestone “${m.name}”?`, message: 'Milestones that have been invoiced cannot be deleted.', danger: true, confirmLabel: 'Delete' });
    if (!c.ok) return;
    try { await api.del(`/api/milestones/${m.id}`); toast.success('Milestone deleted'); onChange(); } catch (e) { toast.fail(e); }
  };
  const done = milestones.filter((m) => m.status === 'COMPLETED').length;
  return (
    <Card pad={false}>
      <div className="p-4 pb-0"><CardHeader title="Milestones" sub={milestones.length ? `${done} of ${milestones.length} completed` : undefined} right={canEdit && <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Add milestone</Button>} /></div>
      <SimpleTable rows={milestones} empty={<p className="p-8 text-center text-sm text-ink-500">No milestones. This project is billed as a single price.</p>} columns={[
        { key: 'name', label: 'Milestone', render: (m) => <span className="font-medium text-ink-900">{m.name}{m.description && <span className="block text-xs font-normal text-ink-500">{m.description}</span>}</span> },
        { key: 'due', label: 'Due', render: (m) => <span className={m.dueDate && m.dueDate < new Date().toISOString().slice(0, 10) && m.status !== 'COMPLETED' ? 'text-red-600' : ''}>{dmy(m.dueDate)}</span> },
        { key: 'status', label: 'Status', render: (m) => <StatusBadge status={m.status} /> },
        ...(canSeeMoney ? [
          { key: 'price', label: 'Price', align: 'right' as const, render: (m: any) => money(m.price, currency) },
          { key: 'cost', label: 'Planned cost', align: 'right' as const, render: (m: any) => money(m.cost, currency) },
          { key: 'pay', label: 'Billing', render: (m: any) => <Badge tone={PAY_TONE[m.payment?.status] ?? 'gray'}>{title(m.payment?.status ?? 'NOT_INVOICED')}</Badge> },
        ] : []),
        { key: 'a', label: '', render: (m) => canEdit && <RowActions actions={[{ label: 'Edit', onClick: () => setEdit(m) }, { label: 'Mark completed', onClick: () => api.patch(`/api/milestones/${m.id}`, { status: 'COMPLETED', version: m.version }).then(() => { toast.success('Marked completed'); onChange(); }).catch(toast.fail), hidden: m.status === 'COMPLETED' }, { label: 'Delete', danger: true, onClick: () => del(m) }]} /> },
      ]} />
      <MilestoneForm projectId={projectId} milestone={edit && edit !== 'new' ? edit : null} open={!!edit} onClose={() => setEdit(null)} onSaved={onChange} />
    </Card>
  );
}

function MilestoneForm({ projectId, milestone, open, onClose, onSaved }: { projectId: string; milestone: any | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ name: '', description: '', price: '', cost: '', startDate: '', dueDate: '', status: 'NOT_STARTED' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  useEffect(() => { if (open) { f.reset(milestone ? { name: milestone.name, description: milestone.description ?? '', price: milestone.price, cost: milestone.cost, startDate: milestone.startDate ?? '', dueDate: milestone.dueDate ?? '', status: milestone.status } : { name: '', description: '', price: '', cost: '', startDate: '', dueDate: '', status: 'NOT_STARTED' }); setError(null); } /* eslint-disable-next-line */ }, [open, milestone?.id]);
  const v = f.values;
  const submit = async () => {
    if (!v.name.trim()) { f.setErrors({ name: 'Enter a name' }); return; }
    if (v.startDate && v.dueDate && v.dueDate < v.startDate) { f.setErrors({ dueDate: 'Due date is before the start date' }); return; }
    setBusy(true); setError(null);
    const body = { name: v.name.trim(), description: v.description || null, price: v.price || '0', cost: v.cost || '0', startDate: v.startDate || null, dueDate: v.dueDate || null, status: v.status };
    try { if (milestone) await api.patch(`/api/milestones/${milestone.id}`, { ...body, version: milestone.version }); else await api.post(`/api/projects/${projectId}/milestones`, body); toast.success('Milestone saved'); onSaved(); onClose(); }
    catch (e) { setError(e as ApiFail); f.fail(e); }
    setBusy(false);
  };
  return (
    <FormModal open={open} onClose={onClose} title={milestone ? 'Edit milestone' : 'Add milestone'} onSubmit={submit} busy={busy} error={error}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={f.errors.name} className="sm:col-span-2"><Input {...f.bind('name')} maxLength={150} /></Field>
        <Field label="Price"><MoneyInput value={v.price} onChange={(x) => f.set('price', x)} /></Field>
        <Field label="Planned cost"><MoneyInput value={v.cost} onChange={(x) => f.set('cost', x)} /></Field>
        <Field label="Start"><Input type="date" {...f.bind('startDate')} /></Field>
        <Field label="Due" error={f.errors.dueDate}><Input type="date" {...f.bind('dueDate')} /></Field>
        <Field label="Status"><Select {...f.bind('status')}>{['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'].map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea {...f.bind('description')} rows={2} maxLength={1000} /></Field>
      </div>
    </FormModal>
  );
}
