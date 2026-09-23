'use client';
import { useEffect, useState } from 'react';
import { api, ApiFail } from '@/ui/api';
import { Field, Input, MoneyInput, Notice, Select, Textarea, useForm, useToast } from '@/ui/kit';
import { title } from '@/ui/format';
import { useApi } from '@/ui/hooks';
import { useSession } from '@/ui/session';
import { FormModal } from '@/components/form-modal';
import { CategorySelect, UserSelect } from '@/components/pickers';

export function EditProject({ open, onClose, project, memberIds, onSaved }: { open: boolean; onClose: () => void; project: any; memberIds: string[]; onSaved: () => void }) {
  const toast = useToast();
  const { meta, can } = useSession();
  const f = useForm({} as Record<string, any>);
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  const users = useApi<{ id: string; name: string }[]>(open ? '/api/users?pageSize=200&active=1' : null);
  useEffect(() => {
    if (!open) return;
    f.reset({ name: project.name, serviceId: project.serviceId, managerId: project.managerId ?? '', salesOwnerId: project.salesOwnerId ?? '', priority: project.priority, startDate: project.startDate ?? '', endDate: project.endDate ?? '', contractDate: project.contractDate ?? '', description: project.description ?? '', notes: project.notes ?? '', paymentTerms: project.paymentTerms ?? '', taxMode: project.taxMode, taxRatePct: String(Number(project.taxRatePct)), sellingPrice: project.sellingPrice ?? '', discount: project.discount ?? '', setupFee: project.setupFee ?? '', monthlyFee: project.monthlyFee ?? '', durationMonths: String(project.durationMonths ?? 0) });
    setMembers(memberIds); setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project.version]);
  const v = f.values;
  const priced = can('profit.view') || can('projects.edit');
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!v.name?.trim()) e.name = 'Enter a name';
    if (v.startDate && v.endDate && v.endDate < v.startDate) e.endDate = 'End date is before the start date';
    if (Object.keys(e).length) { f.setErrors(e); return; }
    setBusy(true); setError(null);
    const body: Record<string, unknown> = { version: project.version, name: v.name.trim(), serviceId: v.serviceId, managerId: v.managerId || null, salesOwnerId: v.salesOwnerId || null, priority: v.priority, startDate: v.startDate || null, endDate: v.endDate || null, contractDate: v.contractDate || null, description: v.description || null, notes: v.notes || null, paymentTerms: v.paymentTerms || null, memberIds: members };
    if (priced && project.sellingPrice !== undefined) {
      Object.assign(body, { taxMode: v.taxMode, taxRatePct: Number(v.taxRatePct || 0), discount: v.discount || '0' });
      if (project.type === 'ONE_TIME' || project.type === 'MILESTONE') body.sellingPrice = v.sellingPrice || '0';
      if (project.type === 'FIXED_RECURRING') Object.assign(body, { setupFee: v.setupFee || '0', monthlyFee: v.monthlyFee || '0', durationMonths: Number(v.durationMonths || 0) });
    }
    try {
      const r = await api.patch<any>(`/api/projects/${project.id}`, body);
      if (r.data.pendingApproval) toast.info('Saved. A discount change is waiting for approval.'); else toast.success('Project updated');
      onSaved(); onClose();
    } catch (err) { setError(err as ApiFail); f.fail(err); }
    setBusy(false);
  };
  const hasPrice = priced && project.sellingPrice !== undefined;
  return (
    <FormModal open={open} onClose={onClose} title="Edit project" onSubmit={submit} busy={busy} error={error} size="lg" submitLabel="Save changes">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={f.errors.name} className="sm:col-span-2"><Input {...f.bind('name')} maxLength={150} /></Field>
        <Field label="Service"><CategorySelect kind="service" value={v.serviceId ?? ''} onChange={(x) => f.set('serviceId', x)} /></Field>
        <Field label="Priority"><Select {...f.bind('priority')}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select></Field>
        <Field label="Project manager"><UserSelect value={v.managerId ?? ''} onChange={(x) => f.set('managerId', x)} allowEmpty placeholder="Unassigned" /></Field>
        <Field label="Sales owner"><UserSelect value={v.salesOwnerId ?? ''} onChange={(x) => f.set('salesOwnerId', x)} allowEmpty placeholder="None" /></Field>
        <Field label="Start"><Input type="date" {...f.bind('startDate')} /></Field>
        <Field label="End" error={f.errors.endDate}><Input type="date" {...f.bind('endDate')} /></Field>
        <Field label="Contract date"><Input type="date" {...f.bind('contractDate')} /></Field>
        <Field label="Payment terms"><Select {...f.bind('paymentTerms')}><option value="">—</option>{meta?.paymentTerms.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}{v.paymentTerms && !meta?.paymentTerms.some((t) => t.name === v.paymentTerms) && <option value={v.paymentTerms}>{v.paymentTerms}</option>}</Select></Field>
        {hasPrice && <>
          {(project.type === 'ONE_TIME' || project.type === 'MILESTONE') && <Field label="Selling price"><MoneyInput value={v.sellingPrice ?? ''} onChange={(x) => f.set('sellingPrice', x)} /></Field>}
          {project.type === 'FIXED_RECURRING' && <>
            <Field label="Setup fee"><MoneyInput value={v.setupFee ?? ''} onChange={(x) => f.set('setupFee', x)} /></Field>
            <Field label="Monthly fee"><MoneyInput value={v.monthlyFee ?? ''} onChange={(x) => f.set('monthlyFee', x)} /></Field>
            <Field label="Duration (months)"><Input inputMode="numeric" {...f.bind('durationMonths')} /></Field></>}
          <Field label="Discount"><MoneyInput value={v.discount ?? ''} onChange={(x) => f.set('discount', x)} /></Field>
          <Field label="Tax treatment"><Select {...f.bind('taxMode')}><option value="EXCLUSIVE">Exclusive</option><option value="INCLUSIVE">Inclusive</option><option value="NONE">No tax</option></Select></Field>
          {v.taxMode !== 'NONE' && <Field label="Tax rate (%)"><Input inputMode="decimal" {...f.bind('taxRatePct')} /></Field>}
        </>}
        <Field label="Description" className="sm:col-span-2"><Textarea {...f.bind('description')} rows={2} maxLength={4000} /></Field>
        <Field label="Internal notes" className="sm:col-span-2"><Textarea {...f.bind('notes')} rows={2} maxLength={4000} /></Field>
        <div className="sm:col-span-2"><p className="label">Team access</p><div className="flex flex-wrap gap-2">{users.data?.map((u) => { const on = members.includes(u.id); return <button type="button" key={u.id} aria-pressed={on} onClick={() => setMembers(on ? members.filter((x) => x !== u.id) : [...members, u.id])} className={`rounded-full border px-3 py-1 text-xs ${on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-600 hover:bg-ink-50'}`}>{u.name}</button>; })}</div></div>
      </div>
      {hasPrice && <Notice>Changing the price changes the projected profit immediately. Invoices already issued are not altered.</Notice>}
    </FormModal>
  );
}

export function ChangeStatus({ open, onClose, project, onSaved }: { open: boolean; onClose: () => void; project: any; onSaved: () => void }) {
  const toast = useToast();
  const options = ['LEAD', 'PROPOSAL', 'NEGOTIATION', 'WON', 'ONBOARDING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'LOST'].filter((s) => s !== project.status);
  const [status, setStatus] = useState(''); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  useEffect(() => { if (open) { setStatus(options[0] ?? ''); setReason(''); setError(null); } /* eslint-disable-next-line */ }, [open]);
  const needsReason = status === 'CANCELLED' || status === 'LOST' || status === 'ON_HOLD';
  const submit = async () => {
    if (needsReason && !reason.trim()) { setError(new ApiFail(422, 'VALIDATION', 'Please give a reason.')); return; }
    setBusy(true); setError(null);
    try { const r = await api.post<any>(`/api/projects/${project.id}/status`, { status, reason: reason || null }); if (r.data.pendingApproval) toast.info('Cancellation sent for approval'); else toast.success(`Status changed to ${title(status)}`); onSaved(); onClose(); }
    catch (e) { setError(e as ApiFail); }
    setBusy(false);
  };
  return (
    <FormModal open={open} onClose={onClose} title="Change status" onSubmit={submit} busy={busy} error={error} size="sm" disabled={!status} submitLabel="Change status">
      {options.length === 0 ? <Notice tone="warn">No other status is available.</Notice> : <>
        <Field label={`Currently ${title(project.status)}. Move to`}><Select value={status} onChange={(e) => setStatus(e.target.value)}>{options.map((o) => <option key={o} value={o}>{title(o)}</option>)}</Select></Field>
        {(status === 'CANCELLED') && <Notice tone="warn">Cancelling stops new invoices. Revenue counts only what was already invoiced. Existing costs remain.</Notice>}
        <Field label="Reason" required={needsReason}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} /></Field></>}
    </FormModal>
  );
}
