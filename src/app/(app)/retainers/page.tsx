'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { Badge, Button, DataTable, Field, Input, MoneyInput, PageHeader, Select, Stat, StatusBadge, Textarea, useForm, useToast } from '@/ui/kit';
import { dmy, inr0 } from '@/ui/format';
import { useSession } from '@/ui/session';
import { useApi } from '@/ui/hooks';
import { Guard } from '@/components/guard';
import { FormModal } from '@/components/form-modal';
import { CategorySelect, ClientSelect, UserSelect } from '@/components/pickers';

export default function RetainersPage() { return <Guard any={['retainers.view']}><Retainers /></Guard>; }

function Retainers() {
  const router = useRouter();
  const { can } = useSession();
  const [status, setStatus] = useState('');
  const [key, setKey] = useState(0);
  const [open, setOpen] = useState(false);
  const summary = useApi<any[]>(`/api/retainers?pageSize=1&status=ACTIVE&k=${key}`);
  const mrr = summary.meta?.mrrMinor ?? 0;
  return (
    <>
      <PageHeader title="Retainers" sub="Recurring monthly clients — fees, included hours, overage and renewals" actions={can('retainers.manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New retainer</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3"><Stat label="Monthly recurring revenue" value={inr0(mrr)} sub="Active retainers, ex-tax" /><Stat label="Annualised" value={inr0(mrr * 12)} /><Stat label="Active retainers" value={summary.meta?.activeCount ?? 0} /></div>
      <DataTable<any> url="/api/retainers" params={{ status }} reloadKey={key} onRow={(r) => router.push(`/retainers/${r.id}`)} searchPlaceholder="Search retainers…" emptyTitle="No retainers yet" emptyHint="Create a retainer to bill a fixed monthly fee and track included hours."
        filters={<Select className="w-36" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="EXPIRED">Expired</option><option value="CANCELLED">Cancelled</option></Select>}
        columns={[
          { key: 'name', label: 'Retainer', render: (r) => <span className="font-medium text-ink-900">{r.name}<span className="block text-xs font-normal text-ink-500">{r.code} · {r.client}</span></span> },
          { key: 'service', label: 'Service', hideBelow: 'md' }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'fee', label: 'Monthly fee', align: 'right', render: (r) => inr0(r.monthlyFee, r.currency) }, { key: 'hours', label: 'Included h', align: 'right', hideBelow: 'md', render: (r) => Number(r.includedHours) },
          { key: 'ends', label: 'Term ends', render: (r) => <span>{dmy(r.endDate)}{r.renewalDue && <Badge tone="amber" className="ml-2">Renewal due</Badge>}{r.daysToRenewal != null && r.daysToRenewal >= 0 && r.status === 'ACTIVE' && !r.renewalDue && <span className="block text-xs text-ink-400">in {r.daysToRenewal} days</span>}</span> },
          { key: 'am', label: 'Account manager', hideBelow: 'lg', render: (r) => r.accountManager ?? '—' },
        ]} />
      <NewRetainer open={open} onClose={() => setOpen(false)} onSaved={() => setKey((k) => k + 1)} />
    </>
  );
}

function NewRetainer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const router = useRouter();
  const { meta } = useSession();
  const t = new Date().toISOString().slice(0, 10);
  const blank = { name: '', clientId: '', serviceId: '', monthlyFee: '', startDate: t, endDate: '', billingFrequency: 'MONTHLY', includedHours: '', overageRate: '', accountManagerId: '', taxMode: 'EXCLUSIVE', taxRatePct: String(Number(meta?.taxRates.find((x) => x.isDefault)?.ratePct ?? 18)), budget: '', notes: '' };
  const f = useForm(blank);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  const v = f.values;
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!v.name.trim()) e.name = 'Enter a name'; if (!v.clientId) e.clientId = 'Choose a client'; if (!v.serviceId) e.serviceId = 'Choose a service'; if (!(Number(v.monthlyFee) > 0)) e.monthlyFee = 'Enter the monthly fee';
    if (!v.endDate) e.endDate = 'Required'; else if (v.endDate < v.startDate) e.endDate = 'Ends before it starts';
    if (Object.keys(e).length) { f.setErrors(e); return; }
    setBusy(true); setError(null);
    try { const r = await api.post<any>('/api/retainers', { name: v.name.trim(), clientId: v.clientId, serviceId: v.serviceId, monthlyFee: v.monthlyFee, startDate: v.startDate, endDate: v.endDate, billingFrequency: v.billingFrequency, includedHours: Number(v.includedHours || 0), overageRate: v.overageRate || '0', accountManagerId: v.accountManagerId || null, taxMode: v.taxMode, taxRatePct: Number(v.taxRatePct || 0), budget: v.budget || '0', notes: v.notes || null }); toast.success(`Retainer ${r.data.code} created`); onSaved(); onClose(); router.push(`/retainers/${r.data.id}`); }
    catch (err) { setError(err as ApiFail); f.fail(err); }
    setBusy(false);
  };
  return (
    <FormModal open={open} onClose={onClose} title="New retainer" onSubmit={submit} busy={busy} error={error} size="lg" submitLabel="Create retainer">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={f.errors.name} className="sm:col-span-2"><Input {...f.bind('name')} maxLength={150} /></Field>
        <Field label="Client" required error={f.errors.clientId}><ClientSelect value={v.clientId} onChange={(x) => f.set('clientId', x)} invalid={!!f.errors.clientId} /></Field>
        <Field label="Service" required error={f.errors.serviceId}><CategorySelect kind="service" value={v.serviceId} onChange={(x) => f.set('serviceId', x)} invalid={!!f.errors.serviceId} /></Field>
        <Field label="Monthly fee (ex-tax)" required error={f.errors.monthlyFee}><MoneyInput value={v.monthlyFee} onChange={(x) => f.set('monthlyFee', x)} invalid={!!f.errors.monthlyFee} /></Field>
        <Field label="Billing"><Select {...f.bind('billingFrequency')}><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option></Select></Field>
        <Field label="Term starts" required><Input type="date" {...f.bind('startDate')} /></Field>
        <Field label="Term ends" required error={f.errors.endDate}><Input type="date" {...f.bind('endDate')} /></Field>
        <Field label="Included hours / month"><Input inputMode="decimal" {...f.bind('includedHours')} /></Field>
        <Field label="Overage rate / hour"><MoneyInput value={v.overageRate} onChange={(x) => f.set('overageRate', x)} /></Field>
        <Field label="Account manager"><UserSelect value={v.accountManagerId} onChange={(x) => f.set('accountManagerId', x)} allowEmpty placeholder="None" /></Field>
        <Field label="Monthly cost budget"><MoneyInput value={v.budget} onChange={(x) => f.set('budget', x)} /></Field>
        <Field label="Tax"><Select {...f.bind('taxMode')}><option value="EXCLUSIVE">Exclusive</option><option value="INCLUSIVE">Inclusive</option><option value="NONE">None</option></Select></Field>
        {v.taxMode !== 'NONE' && <Field label="Tax rate (%)"><Input inputMode="decimal" {...f.bind('taxRatePct')} /></Field>}
        <Field label="Notes" className="sm:col-span-2"><Textarea {...f.bind('notes')} rows={2} maxLength={2000} /></Field>
      </div>
    </FormModal>
  );
}
