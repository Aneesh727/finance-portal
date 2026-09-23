'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Trophy } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { useApi } from '@/ui/hooks';
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Loading, MoneyInput, Notice, PageHeader, StatusBadge, Textarea, useToast } from '@/ui/kit';
import { inr, pct } from '@/ui/format';
import { toMinor } from '@/lib/money';
import { useSession } from '@/ui/session';
import { FormModal } from '@/components/form-modal';
import { CategorySelect, ClientSelect } from '@/components/pickers';
import { Attachments } from '@/components/attachments';

interface Line { categoryId: string; name: string; amount: string }
interface Scn { id?: string; name: string; sellingPrice: string; costLines: Line[] }

export default function DealDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { can } = useSession();
  const toast = useToast();
  const { data, error, reload } = useApi<any>(`/api/deals/${id}`);
  const [scn, setScn] = useState<Scn[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false); const [saveErr, setSaveErr] = useState<ApiFail | null>(null);
  const [convert, setConvert] = useState(false); const [lost, setLost] = useState(false);
  useEffect(() => { if (data) { setScn(data.scenarios.map((s: any) => ({ id: s.id, name: s.name, sellingPrice: s.sellingPrice, costLines: s.costLines.map((l: any) => ({ categoryId: l.categoryId, name: l.name, amount: l.amount })) }))); setSelected(data.deal.selectedScenarioId); setDirty(false); } }, [data]);
  if (error) return <div className="mx-auto max-w-md pt-16 text-center"><ErrorBox error={error} /><Button className="mt-4" onClick={() => router.push('/deals')}>Back</Button></div>;
  if (!data) return <Loading />;
  const d = data.deal; const open = d.status === 'OPEN'; const manage = can('deals.manage') && open;
  const calc = (s: Scn) => { const price = toMinor(s.sellingPrice || '0'); const cost = s.costLines.reduce((a, l) => a + toMinor(l.amount || '0'), 0); return { price, cost, profit: price - cost, margin: price > 0 ? ((price - cost) / price) * 100 : null }; };
  const best = scn.reduce<{ i: number; m: number } | null>((b, s, i) => { const c = calc(s); return c.margin !== null && (!b || c.profit > b.m) ? { i, m: c.profit } : b; }, null);
  const upd = (i: number, p: Partial<Scn>) => { setScn(scn.map((s, j) => (j === i ? { ...s, ...p } : s))); setDirty(true); };
  const save = async () => {
    if (scn.some((s) => !s.name.trim())) { setSaveErr(new ApiFail(422, 'VALIDATION', 'Every scenario needs a name.')); return; }
    if (scn.some((s) => s.costLines.some((l) => !l.categoryId || !l.name.trim()))) { setSaveErr(new ApiFail(422, 'VALIDATION', 'Every cost line needs a category and a name.')); return; }
    setBusy(true); setSaveErr(null);
    try { await api.patch(`/api/deals/${id}`, { scenarios: scn.map((s) => ({ id: s.id, name: s.name.trim(), sellingPrice: s.sellingPrice || '0', costLines: s.costLines.map((l) => ({ categoryId: l.categoryId, name: l.name.trim(), amount: l.amount || '0' })) })), selectedScenarioId: selected }); toast.success('Deal saved'); reload(); }
    catch (e) { setSaveErr(e as ApiFail); }
    setBusy(false);
  };
  return (
    <>
      <PageHeader back={{ href: '/deals', label: 'Deals' }} title={<span className="flex flex-wrap items-center gap-2">{d.name}<StatusBadge status={d.status} /></span>} sub={<span>{d.clientName ?? (d.clientId ? <Link className="link" href={`/clients/${d.clientId}`}>Client</Link> : 'No client yet')}{d.projectId && <> · <Link className="link" href={`/projects/${d.projectId}`}>Open project</Link></>}</span>}
        actions={<>{manage && <Button variant="primary" loading={busy} disabled={!dirty} onClick={save}>Save changes</Button>}{manage && <Button disabled={dirty} onClick={() => setConvert(true)} title={dirty ? 'Save your changes first' : undefined}>Convert to project</Button>}{manage && <Button variant="danger" onClick={() => setLost(true)}>Mark lost</Button>}</>} />
      {d.notes && <Notice className="mb-4">{d.notes}</Notice>}
      <ErrorBox error={saveErr} className="mb-4" />
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {scn.map((s, i) => { const c = calc(s); const isSel = selected === s.id; const low = c.margin !== null && c.margin < (data.thresholds?.criticalMarginPct ?? 10); return (
          <Card key={s.id ?? i} className={isSel ? 'ring-2 ring-brand-500' : ''}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <Input aria-label="Scenario name" className="font-semibold" value={s.name} disabled={!manage} onChange={(e) => upd(i, { name: e.target.value })} maxLength={60} />
              {best?.i === i && scn.length > 1 && <Badge tone="green"><Trophy className="h-3 w-3" />Best profit</Badge>}
            </div>
            <Field label="Selling price (ex-tax)"><MoneyInput value={s.sellingPrice} disabled={!manage} onChange={(x) => upd(i, { sellingPrice: x })} /></Field>
            <p className="label mt-4">Estimated costs</p>
            <div className="space-y-2">{s.costLines.map((l, j) => (
              <div key={j} className="grid grid-cols-[1fr_7rem_auto] items-center gap-2">
                <div className="space-y-1"><CategorySelect kind="cost" value={l.categoryId} disabled={!manage} onChange={(x) => upd(i, { costLines: s.costLines.map((y, k) => (k === j ? { ...y, categoryId: x } : y)) })} /><Input aria-label="Cost line name" placeholder="What is this?" value={l.name} disabled={!manage} maxLength={120} onChange={(e) => upd(i, { costLines: s.costLines.map((y, k) => (k === j ? { ...y, name: e.target.value } : y)) })} /></div>
                <MoneyInput aria-label="Cost amount" value={l.amount} disabled={!manage} onChange={(x) => upd(i, { costLines: s.costLines.map((y, k) => (k === j ? { ...y, amount: x } : y)) })} />
                {manage && <Button variant="ghost" size="icon" aria-label="Remove cost line" onClick={() => upd(i, { costLines: s.costLines.filter((_, k) => k !== j) })}><Trash2 className="h-4 w-4" /></Button>}
              </div>))}
              {manage && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => upd(i, { costLines: [...s.costLines, { categoryId: '', name: '', amount: '' }] })}>Add cost</Button>}</div>
            <dl className="mt-4 space-y-1 border-t border-ink-100 pt-3 text-sm">
              <div className="flex justify-between"><dt className="text-ink-500">Total cost</dt><dd className="tabular-nums">{inr(c.cost)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>Estimated profit</dt><dd className={`tabular-nums ${c.profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{inr(c.profit)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Margin</dt><dd className={`tabular-nums ${low ? 'text-red-600' : ''}`}>{pct(c.margin)}</dd></div>
            </dl>
            {low && <p className="mt-2 text-xs text-red-600">Below the {data.thresholds?.criticalMarginPct}% minimum margin.</p>}
            {c.margin !== null && !low && c.margin < (data.thresholds?.targetMarginPct ?? 30) && <p className="mt-2 text-xs text-amber-700">Below the {data.thresholds?.targetMarginPct}% target margin.</p>}
            {manage && s.id && <div className="mt-3 flex items-center justify-between"><label className="flex items-center gap-2 text-sm"><input type="radio" name="sel" className="h-4 w-4" checked={isSel} onChange={() => { setSelected(s.id!); setDirty(true); }} />Use for conversion</label>{scn.length > 1 && <Button size="sm" variant="ghost" onClick={() => { setScn(scn.filter((_, j) => j !== i)); setDirty(true); }}>Remove</Button>}</div>}
          </Card>); })}
        {manage && scn.length < 6 && <button className="grid min-h-40 place-items-center rounded-xl border-2 border-dashed border-ink-200 text-sm text-ink-500 hover:border-brand-400 hover:text-brand-700" onClick={() => { setScn([...scn, { name: `Scenario ${scn.length + 1}`, sellingPrice: '', costLines: [] }]); setDirty(true); }}><span className="flex items-center gap-1"><Plus className="h-4 w-4" />Add scenario</span></button>}
      </div>
      <div className="mt-4"><Attachments entityType="DEAL" entityId={id} canWrite={can('deals.manage')} /></div>
      <ConvertModal open={convert} onClose={() => setConvert(false)} deal={d} scenarios={data.scenarios} onDone={(pid) => router.push(`/projects/${pid}`)} />
      <LostModal open={lost} onClose={() => setLost(false)} id={id} onDone={reload} />
    </>
  );
}

function ConvertModal({ open, onClose, deal, scenarios, onDone }: { open: boolean; onClose: () => void; deal: any; scenarios: any[]; onDone: (pid: string) => void }) {
  const toast = useToast();
  const [clientId, setClientId] = useState(''); const [start, setStart] = useState(''); const [end, setEnd] = useState(''); const [sid, setSid] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  useEffect(() => { if (open) { setClientId(deal.clientId ?? ''); setSid(deal.selectedScenarioId ?? scenarios[0]?.id ?? ''); setStart(''); setEnd(''); setError(null); } }, [open, deal, scenarios]);
  const submit = async () => { setBusy(true); setError(null); try { const r = await api.post<any>(`/api/deals/${deal.id}/convert`, { scenarioId: sid || null, clientId: clientId || null, startDate: start || null, endDate: end || null }); toast.success(`Project ${r.data.code} created from this deal`); onDone(r.data.projectId); } catch (e) { setError(e as ApiFail); } setBusy(false); };
  return (
    <FormModal open={open} onClose={onClose} title="Convert deal to project" onSubmit={submit} busy={busy} error={error} size="sm" submitLabel="Create project">
      <Notice>The selected scenario’s price becomes the project price and its cost lines become the estimated costs and budget.</Notice>
      <Field label="Scenario"><select className="input" value={sid} onChange={(e) => setSid(e.target.value)}>{scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      {!deal.clientId && <Field label="Client" required hint={deal.clientName ? `Prospect: ${deal.clientName}. Create the client first if missing.` : undefined}><ClientSelect value={clientId} onChange={setClientId} /></Field>}
      <div className="grid grid-cols-2 gap-3"><Field label="Start"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field><Field label="End"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field></div>
    </FormModal>
  );
}
function LostModal({ open, onClose, id, onDone }: { open: boolean; onClose: () => void; id: string; onDone: () => void }) {
  const toast = useToast(); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  useEffect(() => { if (open) { setReason(''); setError(null); } }, [open]);
  const submit = async () => { if (!reason.trim()) { setError(new ApiFail(422, 'VALIDATION', 'Please give a reason.')); return; } setBusy(true); try { await api.post(`/api/deals/${id}/lost`, { reason }); toast.success('Deal marked lost'); onDone(); onClose(); } catch (e) { setError(e as ApiFail); } setBusy(false); };
  return (
    <FormModal open={open} onClose={onClose} title="Mark deal as lost" onSubmit={submit} busy={busy} error={error} size="sm" submitLabel="Mark lost">
      <Field label="Reason" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} /></Field>
    </FormModal>
  );
}
