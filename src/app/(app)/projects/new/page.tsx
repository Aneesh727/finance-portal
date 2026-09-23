'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { Button, Card, CardHeader, ErrorBox, Field, Input, MoneyInput, Notice, PageHeader, Select, Textarea, useForm, useToast } from '@/ui/kit';
import { inr, pct, title, today } from '@/ui/format';
import { toMinor } from '@/lib/money';
import { calculateProjectRevenue } from '@/lib/finance/engine';
import { useSession } from '@/ui/session';
import { Guard } from '@/components/guard';
import { CategorySelect, ClientSelect, UserSelect } from '@/components/pickers';
import { useApi } from '@/ui/hooks';

const TYPES = [
  ['ONE_TIME', 'One-time / fixed price', 'A single agreed price for the whole project.'],
  ['MILESTONE', 'Milestone based', 'Price split across milestones, each billed when reached.'],
  ['FIXED_RECURRING', 'Fixed recurring', 'Setup fee plus a fixed monthly fee for a set duration.'],
  ['RETAINER', 'Monthly retainer', 'A recurring monthly fee with included hours and overage.'],
  ['HOURLY', 'Hourly / time & material', 'Revenue = hours worked × billing rate of assigned resources.'],
] as const;

interface Ms { name: string; price: string; cost: string; dueDate: string }
interface Sched { label: string; type: string; mode: 'pct' | 'amount'; value: string; dueDate: string }
interface CatBud { categoryId: string; amount: string }

export default function NewProjectPage() { return <Guard any={['projects.create']}><NewProject /></Guard>; }

function NewProject() {
  const router = useRouter();
  const toast = useToast();
  const { me, meta } = useSession();
  const base = meta?.company?.baseCurrency ?? 'INR';
  const f = useForm({
    name: '', clientId: '', serviceId: '', type: 'ONE_TIME', managerId: me.user.id, salesOwnerId: '', priority: 'MEDIUM', status: 'WON', startDate: today(), endDate: '', contractDate: '', description: '',
    currency: base, fxRateToBase: '', taxMode: 'EXCLUSIVE', taxRatePct: String(Number(meta?.taxRates.find((t) => t.isDefault)?.ratePct ?? 18)), sellingPrice: '', discount: '', setupFee: '', monthlyFee: '', durationMonths: '', paymentTerms: '',
    budget: '', notes: '',
    rMonthly: '', rStart: today(), rEnd: '', rHours: '', rOverage: '', rFreq: 'MONTHLY', rManager: '',
  });
  const [ms, setMs] = useState<Ms[]>([]);
  const [sched, setSched] = useState<Sched[]>([]);
  const [cats, setCats] = useState<CatBud[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);
  const v = f.values;
  const users = useApi<{ id: string; name: string }[]>('/api/users?pageSize=200&active=1');

  const preview = useMemo(() => {
    try {
      const msTotal = ms.reduce((s, m) => s + (m.price ? toMinor(m.price) : 0), 0);
      const monthly = v.type === 'RETAINER' ? toMinor(v.rMonthly || '0') : toMinor(v.monthlyFee || '0');
      let months = Number(v.durationMonths || 0);
      if (v.type === 'RETAINER' && v.rStart && v.rEnd && v.rEnd >= v.rStart) months = (Number(v.rEnd.slice(0, 4)) - Number(v.rStart.slice(0, 4))) * 12 + (Number(v.rEnd.slice(5, 7)) - Number(v.rStart.slice(5, 7))) + 1;
      const r = calculateProjectRevenue({
        type: v.type as never, status: 'ACTIVE', sellingPrice: toMinor(v.sellingPrice || '0'), discount: toMinor(v.discount || '0'), taxMode: v.taxMode as never, taxRatePct: Number(v.taxRatePct || 0),
        setupFee: toMinor(v.setupFee || '0'), monthlyFee: monthly, durationMonths: months, milestonesTotal: msTotal, retainerRevenue: v.type === 'RETAINER' ? monthly * months : 0,
      });
      const budget = toMinor(v.budget || '0');
      return { ...r, budget, margin: r.taxable > 0 && budget > 0 ? ((r.taxable - budget) / r.taxable) * 100 : null };
    } catch { return null; }
  }, [v, ms]);

  const schedTotalPct = sched.filter((s) => s.mode === 'pct').reduce((a, s) => a + Number(s.value || 0), 0);
  const addTemplate = (parts: [string, string, number][]) => setSched(parts.map(([label, type, p]) => ({ label, type, mode: 'pct', value: String(p), dueDate: '' })));

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!v.name.trim()) e.name = 'Enter a project name';
    if (!v.clientId) e.clientId = 'Choose a client';
    if (!v.serviceId) e.serviceId = 'Choose a service';
    if (v.currency !== base && !(Number(v.fxRateToBase) > 0)) e.fxRateToBase = `Enter the ${v.currency} → ${base} rate`;
    if (v.startDate && v.endDate && v.endDate < v.startDate) e.endDate = 'End date is before the start date';
    if (v.type === 'RETAINER') {
      if (!(Number(v.rMonthly) > 0)) e.rMonthly = 'Enter the monthly fee';
      if (!v.rStart) e.rStart = 'Required'; if (!v.rEnd) e.rEnd = 'Required'; else if (v.rEnd < v.rStart) e.rEnd = 'Ends before it starts';
    }
    if (v.type === 'FIXED_RECURRING' && !(Number(v.durationMonths) > 0)) e.durationMonths = 'Enter the number of months';
    if (v.type === 'MILESTONE' && ms.some((m) => !m.name.trim())) e.milestones = 'Every milestone needs a name';
    if (sched.some((s) => !s.dueDate)) e.schedule = 'Every instalment needs a due date';
    if (schedTotalPct > 100) e.schedule = 'Percentages add up to more than 100%';
    if (Object.keys(e).length) { f.setErrors(e); window.scrollTo({ top: 0, behavior: 'smooth' }); setError(new ApiFail(422, 'VALIDATION', 'Please fix the highlighted fields.')); return; }
    setBusy(true); setError(null);
    const body: Record<string, unknown> = {
      name: v.name.trim(), clientId: v.clientId, serviceId: v.serviceId, type: v.type, description: v.description || null, managerId: v.managerId || null, salesOwnerId: v.salesOwnerId || null,
      startDate: v.startDate || null, endDate: v.endDate || null, contractDate: v.contractDate || null, priority: v.priority, status: v.status,
      currency: v.currency, fxRateToBase: v.currency !== base ? Number(v.fxRateToBase) : undefined, taxMode: v.taxMode, taxRatePct: Number(v.taxRatePct || 0),
      sellingPrice: v.type === 'ONE_TIME' || v.type === 'MILESTONE' ? v.sellingPrice || '0' : '0', discount: v.discount || '0', setupFee: v.type === 'FIXED_RECURRING' ? v.setupFee || '0' : '0', monthlyFee: v.type === 'FIXED_RECURRING' ? v.monthlyFee || '0' : '0',
      durationMonths: v.type === 'FIXED_RECURRING' ? Number(v.durationMonths || 0) : 0, paymentTerms: v.paymentTerms || null, notes: v.notes || null, budget: v.budget || '0', memberIds: members.length ? members : undefined,
      categoryBudgets: cats.filter((c) => c.categoryId && Number(c.amount) > 0).map((c) => ({ categoryId: c.categoryId, amount: c.amount })),
    };
    if (v.type === 'MILESTONE' && ms.length) body.milestones = ms.map((m) => ({ name: m.name.trim(), price: m.price || '0', cost: m.cost || '0', dueDate: m.dueDate || null, status: 'NOT_STARTED' }));
    if (sched.length) body.paymentSchedule = sched.map((s) => ({ label: s.label || null, type: s.type, ...(s.mode === 'pct' ? { pct: Number(s.value) } : { amount: s.value }), dueDate: s.dueDate }));
    if (v.type === 'RETAINER') body.retainer = { monthlyFee: v.rMonthly, startDate: v.rStart, endDate: v.rEnd, includedHours: Number(v.rHours || 0), overageRate: v.rOverage || '0', billingFrequency: v.rFreq, accountManagerId: v.rManager || null };
    try {
      const r = await api.post<{ id: string; code: string; pendingApprovals: number }>('/api/projects', body);
      toast.success(`Project ${r.data.code} created${r.data.pendingApprovals ? ' — some changes are waiting for approval' : ''}`);
      router.push(`/projects/${r.data.id}`);
    } catch (err) { setError(err as ApiFail); f.fail(err); window.scrollTo({ top: 0, behavior: 'smooth' }); setBusy(false); }
  };

  const showPrice = v.type === 'ONE_TIME' || (v.type === 'MILESTONE' && ms.length === 0);
  return (
    <>
      <PageHeader title="New project" sub="Set up the commercials and budget once — profitability updates automatically as costs and payments come in" back={{ href: '/projects', label: 'Projects' }} />
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <ErrorBox error={error} />
          <Card><CardHeader title="Basics" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Project name" required error={f.errors.name} className="sm:col-span-2"><Input {...f.bind('name')} maxLength={150} autoFocus /></Field>
              <Field label="Client" required error={f.errors.clientId}><ClientSelect value={v.clientId} onChange={(x) => f.set('clientId', x)} invalid={!!f.errors.clientId} /></Field>
              <Field label="Service" required error={f.errors.serviceId}><CategorySelect kind="service" value={v.serviceId} onChange={(x) => f.set('serviceId', x)} invalid={!!f.errors.serviceId} /></Field>
              <Field label="Project manager"><UserSelect value={v.managerId} onChange={(x) => f.set('managerId', x)} allowEmpty placeholder="Unassigned" /></Field>
              <Field label="Sales owner"><UserSelect value={v.salesOwnerId} onChange={(x) => f.set('salesOwnerId', x)} allowEmpty placeholder="None" /></Field>
              <Field label="Stage"><Select {...f.bind('status')}>{['LEAD', 'PROPOSAL', 'NEGOTIATION', 'WON', 'ONBOARDING', 'ACTIVE'].map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select></Field>
              <Field label="Priority"><Select {...f.bind('priority')}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select></Field>
              <Field label="Start date"><Input type="date" {...f.bind('startDate')} /></Field>
              <Field label="End date" error={f.errors.endDate}><Input type="date" {...f.bind('endDate')} /></Field>
              <Field label="Contract signed on"><Input type="date" {...f.bind('contractDate')} /></Field>
              <Field label="Description" className="sm:col-span-2"><Textarea {...f.bind('description')} rows={2} maxLength={4000} /></Field>
            </div>
          </Card>

          <Card><CardHeader title="Project type" />
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Project type">
              {TYPES.map(([k, l, d]) => (
                <label key={k} className={`cursor-pointer rounded-lg border p-3 text-sm transition ${v.type === k ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-ink-200 hover:border-ink-300'}`}>
                  <input type="radio" name="type" className="sr-only" checked={v.type === k} onChange={() => f.set('type', k)} /><span className="block font-medium text-ink-900">{l}</span><span className="text-xs text-ink-500">{d}</span>
                </label>))}
            </div>
          </Card>

          <Card><CardHeader title="Pricing & tax" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Currency"><Select {...f.bind('currency')}>{(meta?.currencies ?? [base]).map((c) => <option key={c}>{c}</option>)}</Select></Field>
              {v.currency !== base ? <Field label={`1 ${v.currency} = ? ${base}`} required error={f.errors.fxRateToBase} hint="Fixed for this project."><Input inputMode="decimal" {...f.bind('fxRateToBase')} /></Field> : <div />}
              {showPrice && <Field label={v.type === 'MILESTONE' ? 'Price (or add milestones below)' : 'Selling price'} className="sm:col-span-1"><MoneyInput value={v.sellingPrice} onChange={(x) => f.set('sellingPrice', x)} /></Field>}
              {v.type === 'FIXED_RECURRING' && <>
                <Field label="Setup fee"><MoneyInput value={v.setupFee} onChange={(x) => f.set('setupFee', x)} /></Field>
                <Field label="Monthly fee"><MoneyInput value={v.monthlyFee} onChange={(x) => f.set('monthlyFee', x)} /></Field>
                <Field label="Duration (months)" required error={f.errors.durationMonths}><Input inputMode="numeric" {...f.bind('durationMonths')} /></Field>
              </>}
              {v.type === 'HOURLY' && <Notice tone="info" className="sm:col-span-2">Revenue is calculated from the hours logged for assigned resources × their billing rate. Assign resources after creating the project.</Notice>}
              <Field label="Discount" hint="Amount off the price, before tax."><MoneyInput value={v.discount} onChange={(x) => f.set('discount', x)} /></Field>
              <Field label="Tax treatment"><Select {...f.bind('taxMode')}><option value="EXCLUSIVE">Tax added on top (exclusive)</option><option value="INCLUSIVE">Price includes tax (inclusive)</option><option value="NONE">No tax</option></Select></Field>
              {v.taxMode !== 'NONE' && <Field label="Tax rate (%)"><div className="flex gap-2"><Select className="w-32" value={meta?.taxRates.some((t) => Number(t.ratePct) === Number(v.taxRatePct)) ? String(Number(v.taxRatePct)) : 'x'} onChange={(e) => e.target.value !== 'x' && f.set('taxRatePct', e.target.value)}>{meta?.taxRates.map((t) => <option key={t.id} value={Number(t.ratePct)}>{t.name}</option>)}<option value="x">Custom</option></Select><Input inputMode="decimal" {...f.bind('taxRatePct')} /></div></Field>}
              <Field label="Payment terms"><Select {...f.bind('paymentTerms')}><option value="">—</option>{meta?.paymentTerms.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</Select></Field>
            </div>
          </Card>

          {v.type === 'RETAINER' && (
            <Card><CardHeader title="Retainer terms" sub="The monthly fee is invoiced in advance each month; hours beyond the included amount are billed as overage." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Monthly fee" required error={f.errors.rMonthly}><MoneyInput value={v.rMonthly} onChange={(x) => f.set('rMonthly', x)} invalid={!!f.errors.rMonthly} /></Field>
                <Field label="Billing frequency"><Select {...f.bind('rFreq')}><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option></Select></Field>
                <Field label="Term starts" required error={f.errors.rStart}><Input type="date" {...f.bind('rStart')} /></Field>
                <Field label="Term ends" required error={f.errors.rEnd}><Input type="date" {...f.bind('rEnd')} /></Field>
                <Field label="Included hours / month"><Input inputMode="decimal" {...f.bind('rHours')} /></Field>
                <Field label="Overage rate / hour"><MoneyInput value={v.rOverage} onChange={(x) => f.set('rOverage', x)} /></Field>
                <Field label="Account manager"><UserSelect value={v.rManager} onChange={(x) => f.set('rManager', x)} allowEmpty placeholder="Same as project manager" /></Field>
              </div>
            </Card>)}

          {v.type === 'MILESTONE' && (
            <Card><CardHeader title="Milestones" sub="Price and planned cost per milestone." right={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setMs([...ms, { name: '', price: '', cost: '', dueDate: '' }])}>Add</Button>} />
              {f.errors.milestones && <p className="mb-2 text-xs text-red-600">{f.errors.milestones}</p>}
              {ms.length === 0 ? <p className="text-sm text-ink-500">No milestones — the project price above is used. Add milestones to bill in stages.</p> : (
                <div className="space-y-2">{ms.map((m, i) => (
                  <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_9rem_9rem_9rem_auto]">
                    <Field label={i === 0 ? 'Name' : undefined}><Input aria-label="Milestone name" value={m.name} onChange={(e) => setMs(ms.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></Field>
                    <Field label={i === 0 ? 'Price' : undefined}><MoneyInput aria-label="Milestone price" value={m.price} onChange={(x) => setMs(ms.map((y, j) => (j === i ? { ...y, price: x } : y)))} /></Field>
                    <Field label={i === 0 ? 'Planned cost' : undefined}><MoneyInput aria-label="Milestone cost" value={m.cost} onChange={(x) => setMs(ms.map((y, j) => (j === i ? { ...y, cost: x } : y)))} /></Field>
                    <Field label={i === 0 ? 'Due' : undefined}><Input type="date" aria-label="Milestone due date" value={m.dueDate} onChange={(e) => setMs(ms.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} /></Field>
                    <Button variant="ghost" size="icon" aria-label="Remove milestone" onClick={() => setMs(ms.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>))}</div>)}
            </Card>)}

          <Card><CardHeader title="Cost budget" sub="The most you plan to spend. Category budgets are optional and checked when costs are added." right={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCats([...cats, { categoryId: '', amount: '' }])}>Category budget</Button>} />
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Total project budget"><MoneyInput value={v.budget} onChange={(x) => f.set('budget', x)} /></Field></div>
            {cats.length > 0 && <div className="mt-3 space-y-2">{cats.map((c, i) => (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_10rem_auto]">
                <CategorySelect kind="cost" value={c.categoryId} onChange={(x) => setCats(cats.map((y, j) => (j === i ? { ...y, categoryId: x } : y)))} />
                <MoneyInput aria-label="Category budget" value={c.amount} onChange={(x) => setCats(cats.map((y, j) => (j === i ? { ...y, amount: x } : y)))} />
                <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setCats(cats.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>))}
              {toMinor(v.budget || '0') > 0 && cats.reduce((s, c) => s + toMinor(c.amount || '0'), 0) > toMinor(v.budget || '0') && <p className="text-xs text-amber-700">Category budgets add up to more than the total budget.</p>}
            </div>}
          </Card>

          <Card><CardHeader title="Payment schedule" sub="Optional. Creates scheduled invoices you can issue when due." right={<>
            <Button size="sm" onClick={() => addTemplate([['Advance', 'ADVANCE', 50], ['Final payment', 'FINAL', 50]])}>50 / 50</Button>
            <Button size="sm" onClick={() => addTemplate([['Advance', 'ADVANCE', 30], ['Milestone', 'MILESTONE', 40], ['Final payment', 'FINAL', 30]])}>30 / 40 / 30</Button>
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setSched([...sched, { label: '', type: 'CUSTOM', mode: 'pct', value: '', dueDate: '' }])}>Add</Button></>} />
            {f.errors.schedule && <p className="mb-2 text-xs text-red-600">{f.errors.schedule}</p>}
            {sched.length === 0 ? <p className="text-sm text-ink-500">No schedule yet.</p> : (
              <div className="space-y-2">{sched.map((s, i) => (
                <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_8rem_7rem_9rem_9rem_auto]">
                  <Input aria-label="Instalment label" placeholder="Label" value={s.label} onChange={(e) => setSched(sched.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <Select aria-label="Type" value={s.type} onChange={(e) => setSched(sched.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>{['ADVANCE', 'MILESTONE', 'MONTHLY', 'QUARTERLY', 'FINAL', 'CUSTOM'].map((t) => <option key={t} value={t}>{title(t)}</option>)}</Select>
                  <Select aria-label="Percent or amount" value={s.mode} onChange={(e) => setSched(sched.map((x, j) => (j === i ? { ...x, mode: e.target.value as 'pct' | 'amount', value: '' } : x)))}><option value="pct">% of value</option><option value="amount">Fixed ₹</option></Select>
                  <Input aria-label="Value" inputMode="decimal" value={s.value} onChange={(e) => setSched(sched.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  <Input type="date" aria-label="Due date" value={s.dueDate} onChange={(e) => setSched(sched.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
                  <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setSched(sched.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>))}
                <p className="text-xs text-ink-500">Percentage instalments total {schedTotalPct}%.</p></div>)}
          </Card>

          <Card><CardHeader title="Team access" sub="Project managers and team members only see projects they manage or are added to." />
            <div className="flex flex-wrap gap-2">
              {users.data?.map((u) => { const on = members.includes(u.id); return <button type="button" key={u.id} onClick={() => setMembers(on ? members.filter((x) => x !== u.id) : [...members, u.id])} aria-pressed={on} className={`rounded-full border px-3 py-1 text-xs ${on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-600 hover:bg-ink-50'}`}>{u.name}</button>; })}
            </div>
            <Field label="Internal notes" className="mt-4"><Textarea {...f.bind('notes')} rows={2} maxLength={4000} /></Field>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card><CardHeader title="Summary" />
            {preview ? <dl className="space-y-2 text-sm">
              <Row k="Price before discount" v={inr(preview.listPrice, v.currency)} />
              {preview.discount > 0 && <Row k="Discount" v={`− ${inr(preview.discount, v.currency)}`} />}
              <Row k="Contract value (ex-tax)" v={inr(preview.taxable, v.currency)} bold />
              <Row k={`Tax (${v.taxMode === 'NONE' ? 'none' : Number(v.taxRatePct) + '%'})`} v={inr(preview.tax, v.currency)} />
              <Row k="Client pays" v={inr(preview.totalIncludingTax, v.currency)} />
              <hr className="border-ink-100" />
              <Row k="Budget" v={preview.budget ? inr(preview.budget, v.currency) : '—'} />
              <Row k="Planned margin" v={preview.margin === null ? '—' : pct(preview.margin)} bold />
            </dl> : <p className="text-sm text-ink-500">Enter valid amounts to see the summary.</p>}
            <Button type="submit" variant="primary" className="mt-4 w-full" loading={busy}>Create project</Button>
            <Button className="mt-2 w-full" onClick={() => router.push('/projects')} disabled={busy}>Cancel</Button>
          </Card>
        </aside>
      </form>
    </>
  );
}
const Row = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => <div className="flex justify-between gap-3"><dt className="text-ink-500">{k}</dt><dd className={`tabular-nums ${bold ? 'font-semibold text-ink-900' : 'text-ink-800'}`}>{v}</dd></div>;
