'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiFail } from '@/ui/api';
import { useApi } from '@/ui/hooks';
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Loading, MoneyInput, Notice, PageHeader, SimpleTable, Stat, StatusBadge, Textarea, useConfirm, useToast } from '@/ui/kit';
import { dmy, inr, inr0, monthShort, money, pct, today } from '@/ui/format';
import { useSession } from '@/ui/session';
import { FormModal } from '@/components/form-modal';
import { RowActions } from '@/components/row-actions';

export default function RetainerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { can } = useSession();
  const toast = useToast();
  const { data, error, reload } = useApi<any>(`/api/retainers/${id}`);
  const [modal, setModal] = useState<'renew' | 'cancel' | { hours: any } | null>(null);
  if (error) return <div className="mx-auto max-w-md pt-16 text-center"><ErrorBox error={error} /><Button className="mt-4" onClick={() => router.push('/retainers')}>Back</Button></div>;
  if (!data) return <Loading />;
  const r = data.retainer; const fin = data.financials; const cur = data.project.currency; const manage = can('retainers.manage'); const active = r.status === 'ACTIVE';
  const bill = can('payments.manage');
  const genInvoices = async () => { try { const res = await api.post<any>(`/api/retainers/${id}/invoices`, {}); toast.success(res.data.created ? `${res.data.created} invoice${res.data.created === 1 ? '' : 's'} issued` : 'All due fees are already invoiced'); reload(); } catch (e) { toast.fail(e); } };
  const overage = async (m: any) => { try { await api.post(`/api/retainers/${id}/overage`, { month: m.month }); toast.success('Overage invoiced'); reload(); } catch (e) { toast.fail(e); } };
  const term = data.terms[data.terms.length - 1];
  return (
    <>
      <PageHeader back={{ href: '/retainers', label: 'Retainers' }} title={<span className="flex flex-wrap items-center gap-2">{data.project.name}<StatusBadge status={r.status} />{r.isDemo && <Badge tone="purple">Demo</Badge>}</span>} sub={<span>{data.project.code} · {data.client} · {data.service} · <Link className="link" href={`/projects/${data.project.id}`}>Open project</Link></span>}
        actions={<>{bill && active && <Button onClick={genInvoices}>Issue due fee invoices</Button>}{manage && active && <Button onClick={() => setModal('renew')}>Renew</Button>}{manage && active && <Button variant="danger" onClick={() => setModal('cancel')}>Cancel retainer</Button>}</>} />
      {r.status === 'CANCELLED' && <Notice tone="warn" className="mb-4">Cancelled on {dmy(r.cancelledOn)}. No further fees are invoiced.</Notice>}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Current monthly fee" value={inr0(Math.round(Number(term?.monthlyFee ?? 0) * 100), cur)} sub={`${Number(term?.includedHours ?? 0)} h included · overage ${money(term?.overageRate, cur)}/h`} />
        {data.totals && <Stat label="Retainer revenue (all terms, contract value)" value={inr0(data.totals.total, cur)} sub={`Fees ${inr0(data.totals.base, cur)} + overage ${inr0(data.totals.overage, cur)}`} />}
        {can('profit.view') && <Stat label="Profit" value={inr0(fin.profit?.actual, cur)} tone={fin.profit?.actual < 0 ? 'bad' : 'good'} sub={`Margin ${pct(fin.profit?.grossMarginPct)}`} />}
        {can('profit.view') && <Stat label="Outstanding" value={inr0(fin.receivables?.outstanding, cur)} tone={fin.receivables?.overdue > 0 ? 'bad' : 'neutral'} sub={fin.receivables?.overdue > 0 ? `${inr0(fin.receivables.overdue, cur)} overdue` : undefined} />}
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card pad={false} className="lg:col-span-2"><div className="p-4 pb-0"><CardHeader title="Monthly usage & revenue" sub="Log hours worked each month; hours above the allowance are billed as overage." /></div>
          <SimpleTable rows={data.months.map((m: any) => ({ ...m, id: m.month }))} columns={[
            { key: 'm', label: 'Month', render: (m: any) => monthShort(m.month) },
            ...(data.totals ? [{ key: 'fee', label: 'Fee', align: 'right' as const, render: (m: any) => inr(m.baseRevenue, cur) }] : []),
            { key: 'h', label: 'Hours used', align: 'right', render: (m: any) => <span className={m.overageHours > 0 ? 'text-amber-700' : ''}>{m.hoursUsed} / {m.includedHours}</span> },
            { key: 'o', label: 'Overage', align: 'right', render: (m: any) => (data.totals ? (m.overageRevenue ? `${inr(m.overageRevenue, cur)} (${m.overageHours}h)` : '—') : m.overageHours > 0 ? `${m.overageHours}h over` : '—') },
            ...(can('costs.view') ? [{ key: 'c', label: 'Cost', align: 'right' as const, render: (m: any) => inr(m.cost, cur) }] : []),
            { key: 'a', label: '', render: (m: any) => manage && active && <RowActions actions={[{ label: 'Log hours', onClick: () => setModal({ hours: m }) }, { label: 'Invoice overage', onClick: () => overage(m), hidden: !bill || !(m.overageRevenue > 0) }]} /> },
          ]} /></Card>
        <Card><CardHeader title="Terms" />
          <ul className="space-y-2 text-sm">{data.terms.map((t: any) => <li key={t.id} className="rounded-lg border border-ink-100 p-2.5"><p className="font-medium tabular-nums">{money(t.monthlyFee, cur)}/mo</p><p className="text-xs text-ink-500">{dmy(t.startDate)} → {dmy(t.endDate)} · {Number(t.includedHours)}h · overage {money(t.overageRate, cur)}/h</p></li>)}</ul>
          <p className="mt-3 text-xs text-ink-500">Fees are billed monthly in advance. Renewing adds a new term; earlier terms are kept for history.</p></Card>
      </div>
      <RenewModal open={modal === 'renew'} term={term} onClose={() => setModal(null)} id={id} onSaved={reload} cur={cur} />
      <CancelModal open={modal === 'cancel'} onClose={() => setModal(null)} id={id} onSaved={reload} />
      <HoursModal m={typeof modal === 'object' && modal ? modal.hours : null} onClose={() => setModal(null)} id={id} onSaved={reload} />
    </>
  );
}

function RenewModal({ open, term, onClose, id, onSaved, cur }: any) {
  const toast = useToast();
  const [v, setV] = useState({ monthlyFee: '', endDate: '', includedHours: '', overageRate: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  useEffect(() => { if (open && term) { const e = new Date(term.endDate + 'T00:00:00Z'); e.setUTCFullYear(e.getUTCFullYear() + 1); setV({ monthlyFee: String(Number(term.monthlyFee)), endDate: e.toISOString().slice(0, 10), includedHours: String(Number(term.includedHours)), overageRate: String(Number(term.overageRate)) }); setError(null); } }, [open, term]);
  const submit = async () => { setBusy(true); setError(null); try { await api.post(`/api/retainers/${id}/renew`, { monthlyFee: v.monthlyFee, endDate: v.endDate, includedHours: Number(v.includedHours || 0), overageRate: v.overageRate || '0' }); toast.success('Retainer renewed'); onSaved(); onClose(); } catch (e) { setError(e as ApiFail); } setBusy(false); };
  return (
    <FormModal open={open} onClose={onClose} title="Renew retainer" onSubmit={submit} busy={busy} error={error} size="sm" submitLabel="Renew">
      <Notice>The new term starts the day after the current term ends.{term && ` Current term ends ${dmy(term.endDate)}.`}</Notice>
      <Field label={`New monthly fee (${cur})`}><MoneyInput value={v.monthlyFee} onChange={(x) => setV({ ...v, monthlyFee: x })} /></Field>
      <Field label="New term ends"><Input type="date" value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} /></Field>
      <Field label="Included hours / month"><Input inputMode="decimal" value={v.includedHours} onChange={(e) => setV({ ...v, includedHours: e.target.value })} /></Field>
      <Field label="Overage rate / hour"><MoneyInput value={v.overageRate} onChange={(x) => setV({ ...v, overageRate: x })} /></Field>
    </FormModal>
  );
}
function CancelModal({ open, onClose, id, onSaved }: any) {
  const toast = useToast(); const confirm = useConfirm();
  const [cancelOn, setCancelOn] = useState(today()); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  useEffect(() => { if (open) { setCancelOn(today()); setReason(''); setError(null); } }, [open]);
  const submit = async () => {
    if (!reason.trim()) { setError(new ApiFail(422, 'VALIDATION', 'Please give a reason.')); return; }
    const c = await confirm({ title: 'Cancel this retainer?', message: 'Future fees stop from the cancellation date. Invoices already issued remain.', danger: true, confirmLabel: 'Cancel retainer' }); if (!c.ok) return;
    setBusy(true); setError(null);
    try { await api.post(`/api/retainers/${id}/cancel`, { cancelOn, reason }); toast.success('Retainer cancelled'); onSaved(); onClose(); } catch (e) { setError(e as ApiFail); }
    setBusy(false);
  };
  return (
    <FormModal open={open} onClose={onClose} title="Cancel retainer" onSubmit={submit} busy={busy} error={error} size="sm" submitLabel="Cancel retainer">
      <Field label="Effective from"><Input type="date" value={cancelOn} onChange={(e) => setCancelOn(e.target.value)} /></Field>
      <Field label="Reason" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} /></Field>
    </FormModal>
  );
}
function HoursModal({ m, onClose, id, onSaved }: any) {
  const toast = useToast();
  const [hours, setHours] = useState(''); const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  useEffect(() => { if (m) { setHours(String(m.hoursUsed)); setNotes(''); setError(null); } }, [m]);
  const submit = async () => { if (hours === '' || Number(hours) < 0) { setError(new ApiFail(422, 'VALIDATION', 'Enter the hours used (0 or more).')); return; } setBusy(true); setError(null); try { await api.put(`/api/retainers/${id}/hours`, { month: m.month, hoursUsed: Number(hours), notes: notes || null }); toast.success('Hours saved'); onSaved(); onClose(); } catch (e) { setError(e as ApiFail); } setBusy(false); };
  return (
    <FormModal open={!!m} onClose={onClose} title={m ? `Hours — ${monthShort(m.month)}` : ''} onSubmit={submit} busy={busy} error={error} size="sm">
      <Field label={`Hours used (included: ${m?.includedHours ?? 0})`}><Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} autoFocus /></Field>
      <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field>
    </FormModal>
  );
}
