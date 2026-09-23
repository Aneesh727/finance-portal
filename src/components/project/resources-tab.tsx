'use client';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { Badge, Button, Card, CardHeader, Field, Input, MoneyInput, SimpleTable, Textarea, useConfirm, useForm, useToast } from '@/ui/kit';
import { inr, money, title } from '@/ui/format';
import { FormModal, BudgetOverride } from '@/components/form-modal';
import { RowActions } from '@/components/row-actions';
import { ResourceSelect } from '@/components/pickers';

export function ResourcesTab({ projectId, rows, canEdit, canSeeMoney, currency, onChange }: { projectId: string; rows: any[]; canEdit: boolean; canSeeMoney: boolean; currency: string; onChange: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const remove = async (r: any) => {
    const c = await confirm({ title: `Remove ${r.name} from this project?`, message: 'Their logged cost stays in the audit history but no longer counts.', danger: true, confirmLabel: 'Remove' });
    if (!c.ok) return;
    try { await api.del(`/api/project-resources/${r.id}`); toast.success('Resource removed'); onChange(); } catch (e) { toast.fail(e); }
  };
  const totalCost = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
  return (
    <Card pad={false}>
      <div className="p-4 pb-0"><CardHeader title="Resources" sub="People, freelancers and agencies assigned to this project. Employee cost is allocated monthly under Employee cost allocation." right={canEdit && <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Assign resource</Button>} /></div>
      <SimpleTable rows={rows} empty={<p className="p-8 text-center text-sm text-ink-500">No resources assigned yet.</p>} columns={[
        { key: 'name', label: 'Resource', render: (r) => <span className="font-medium text-ink-900">{r.name}<span className="block text-xs font-normal text-ink-500">{r.role} · {title(r.type)}</span></span> },
        { key: 'ph', label: 'Planned h', align: 'right', render: (r) => Number(r.plannedHours) },
        { key: 'ah', label: 'Actual h', align: 'right', render: (r) => <span className={Number(r.actualHours) > Number(r.plannedHours) && Number(r.plannedHours) > 0 ? 'text-red-600' : ''}>{Number(r.actualHours)}</span> },
        ...(canSeeMoney ? [
          { key: 'rate', label: 'Cost rate /h', align: 'right' as const, render: (r: any) => r.costRate === undefined ? '—' : money(r.costRate, currency) },
          { key: 'paid', label: 'Paid', align: 'right' as const, render: (r: any) => (r.paidAmount === undefined ? '—' : money(r.paidAmount, currency)) },
          { key: 'cost', label: 'Cost', align: 'right' as const, render: (r: any) => (r.cost === undefined ? '—' : inr(r.cost, currency)) },
          { key: 'rev', label: 'Revenue', align: 'right' as const, render: (r: any) => (r.revenue ? inr(r.revenue, currency) : '—') },
        ] : []),
        { key: 'a', label: '', render: (r) => canEdit && <RowActions actions={[{ label: 'Edit hours / pay', onClick: () => setEdit(r) }, { label: 'Remove', danger: true, onClick: () => remove(r) }]} /> },
      ]} foot={rows.length > 0 && canSeeMoney ? <tr><td className="td font-semibold" colSpan={5}>Total resource cost</td><td className="td num font-semibold" colSpan={2}>{inr(totalCost, currency)}</td><td className="td" colSpan={2} /></tr> : undefined} />
      <AssignForm projectId={projectId} row={edit && edit !== 'new' ? edit : null} open={!!edit} onClose={() => setEdit(null)} onSaved={onChange} />
      <span className="hidden"><Badge>{''}</Badge></span>
    </Card>
  );
}

function AssignForm({ projectId, row, open, onClose, onSaved }: { projectId: string; row: any | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ resourceId: '', plannedHours: '', actualHours: '', paidAmount: '', startDate: '', endDate: '', notes: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  const [ov, setOv] = useState(false); const [reason, setReason] = useState('');
  useEffect(() => { if (open) { f.reset(row ? { resourceId: row.resourceId, plannedHours: String(Number(row.plannedHours)), actualHours: String(Number(row.actualHours)), paidAmount: row.paidAmount ?? '', startDate: row.startDate ?? '', endDate: row.endDate ?? '', notes: row.notes ?? '' } : { resourceId: '', plannedHours: '', actualHours: '', paidAmount: '', startDate: '', endDate: '', notes: '' }); setError(null); setOv(false); setReason(''); } /* eslint-disable-next-line */ }, [open, row?.id]);
  const v = f.values;
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!row && !v.resourceId) e.resourceId = 'Choose a resource';
    if (v.plannedHours && Number(v.plannedHours) < 0) e.plannedHours = 'Cannot be negative';
    if (v.actualHours && Number(v.actualHours) < 0) e.actualHours = 'Cannot be negative';
    if (v.startDate && v.endDate && v.endDate < v.startDate) e.endDate = 'Ends before it starts';
    if (Object.keys(e).length) { f.setErrors(e); return; }
    setBusy(true); setError(null);
    const body: Record<string, unknown> = { plannedHours: Number(v.plannedHours || 0), actualHours: Number(v.actualHours || 0), startDate: v.startDate || null, endDate: v.endDate || null, notes: v.notes || null, overrideBudget: ov, overrideReason: ov ? reason : null };
    if (v.paidAmount !== '') body.paidAmount = v.paidAmount;
    try { if (row) await api.patch(`/api/project-resources/${row.id}`, body); else await api.post(`/api/projects/${projectId}/resources`, { ...body, resourceId: v.resourceId }); toast.success('Assignment saved'); onSaved(); onClose(); }
    catch (err) { setError(err as ApiFail); f.fail(err); }
    setBusy(false);
  };
  return (
    <FormModal open={open} onClose={onClose} title={row ? `Edit ${row.name}` : 'Assign resource'} onSubmit={submit} busy={busy} error={error}>
      <div className="grid gap-4 sm:grid-cols-2">
        {!row && <Field label="Resource" required error={f.errors.resourceId} className="sm:col-span-2"><ResourceSelect value={v.resourceId} onChange={(x) => f.set('resourceId', x)} invalid={!!f.errors.resourceId} /></Field>}
        <Field label="Planned hours" error={f.errors.plannedHours}><Input inputMode="decimal" {...f.bind('plannedHours')} /></Field>
        <Field label="Actual hours" error={f.errors.actualHours} hint="Cost = actual hours × the resource’s rate when assigned."><Input inputMode="decimal" {...f.bind('actualHours')} /></Field>
        <Field label="Amount paid so far" hint="Cash paid to this person / agency (not for employees)."><MoneyInput value={v.paidAmount} onChange={(x) => f.set('paidAmount', x)} /></Field>
        <div />
        <Field label="Start"><Input type="date" {...f.bind('startDate')} /></Field>
        <Field label="End" error={f.errors.endDate}><Input type="date" {...f.bind('endDate')} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea {...f.bind('notes')} rows={2} maxLength={500} /></Field>
      </div>
      <BudgetOverride error={error} on={ov} setOn={setOv} reason={reason} setReason={setReason} />
    </FormModal>
  );
}
