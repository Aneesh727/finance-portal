'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { Button, DataTable, Field, Input, PageHeader, Select, StatusBadge, Textarea, useForm, useToast } from '@/ui/kit';
import { inr0, pct } from '@/ui/format';
import { useSession } from '@/ui/session';
import { Guard } from '@/components/guard';
import { FormModal } from '@/components/form-modal';
import { CategorySelect, ClientSelect, UserSelect } from '@/components/pickers';

export default function DealsPage() { return <Guard any={['deals.view']}><Deals /></Guard>; }
function Deals() {
  const router = useRouter(); const { can } = useSession();
  const [status, setStatus] = useState(''); const [open, setOpen] = useState(false); const [key, setKey] = useState(0);
  return (
    <>
      <PageHeader title="Deals & quotations" sub="Model price and cost scenarios before you win the work, then convert the deal into a project" actions={can('deals.manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New deal</Button>} />
      <DataTable<any> url="/api/deals" params={{ status }} reloadKey={key} onRow={(r) => router.push(`/deals/${r.id}`)} searchPlaceholder="Search deals…" emptyTitle="No deals yet" emptyHint="Create a deal to compare pricing scenarios and see the expected margin."
        filters={<Select className="w-36" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="OPEN">Open</option><option value="WON">Won</option><option value="LOST">Lost</option></Select>}
        columns={[
          { key: 'name', label: 'Deal', render: (r) => <span className="font-medium text-ink-900">{r.name}<span className="block text-xs font-normal text-ink-500">{r.client ?? 'No client yet'}{r.service ? ` · ${r.service}` : ''}</span></span> },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'sc', label: 'Scenarios', align: 'right', hideBelow: 'md', render: (r) => r.scenarioCount },
          { key: 'price', label: 'Price', align: 'right', render: (r) => (r.selected ? inr0(r.selected.sellingPrice) : '—') },
          { key: 'profit', label: 'Est. profit', align: 'right', hideBelow: 'md', render: (r) => (r.selected ? inr0(r.selected.estimatedProfit) : '—') },
          { key: 'm', label: 'Margin', align: 'right', render: (r) => (r.selected ? <span className={r.selected.marginPct < 0 ? 'text-red-600' : ''}>{pct(r.selected.marginPct)}</span> : '—') },
          { key: 'owner', label: 'Owner', hideBelow: 'lg', render: (r) => r.owner ?? '—' },
        ]} />
      <NewDeal open={open} onClose={() => setOpen(false)} onSaved={(id) => { setKey((k) => k + 1); router.push(`/deals/${id}`); }} />
    </>
  );
}
function NewDeal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast(); const { me } = useSession();
  const f = useForm({ name: '', clientId: '', clientName: '', serviceId: '', ownerId: me.user.id, notes: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  const v = f.values;
  const submit = async () => {
    if (!v.name.trim()) { f.setErrors({ name: 'Enter a deal name' }); return; }
    setBusy(true); setError(null);
    try { const r = await api.post<any>('/api/deals', { name: v.name.trim(), clientId: v.clientId || null, clientName: v.clientId ? null : v.clientName || null, serviceId: v.serviceId || null, ownerId: v.ownerId || null, notes: v.notes || null, scenarios: [{ name: 'Base', sellingPrice: '0', costLines: [] }] }); toast.success('Deal created'); f.reset(); onClose(); onSaved(r.data.id ?? r.data.deal?.id); }
    catch (e) { setError(e as ApiFail); f.fail(e); }
    setBusy(false);
  };
  return (
    <FormModal open={open} onClose={onClose} title="New deal" onSubmit={submit} busy={busy} error={error}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Deal name" required error={f.errors.name} className="sm:col-span-2"><Input {...f.bind('name')} maxLength={150} autoFocus /></Field>
        <Field label="Existing client"><ClientSelect value={v.clientId} onChange={(x) => f.set('clientId', x)} allowEmpty placeholder="Not a client yet" /></Field>
        {!v.clientId && <Field label="Prospect name"><Input {...f.bind('clientName')} maxLength={150} /></Field>}
        <Field label="Service"><CategorySelect kind="service" allowEmpty placeholder="Choose later" value={v.serviceId} onChange={(x) => f.set('serviceId', x)} /></Field>
        <Field label="Owner"><UserSelect value={v.ownerId} onChange={(x) => f.set('ownerId', x)} allowEmpty placeholder="Unassigned" /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea {...f.bind('notes')} rows={2} maxLength={2000} /></Field>
      </div>
    </FormModal>
  );
}
