'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, Download, Plus, Trash2 } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { Badge, Button, Card, CardHeader, Check, ErrorBox, Field, Input, Loading, MoneyInput, Notice, PageHeader, Select, SimpleTable, Tabs, Textarea, useConfirm, useToast } from '@/ui/kit';
import { useApi } from '@/ui/hooks';
import { dmy, title, today } from '@/ui/format';
import { useSession } from '@/ui/session';
import { Guard } from '@/components/guard';

type Tab = 'company' | 'thresholds' | 'approvals' | 'notifications' | 'tax' | 'categories' | 'currency' | 'backup';
export default function SettingsPage() { return <Guard any={['settings.manage', 'backup.run']}><Suspense><Settings /></Suspense></Guard>; }

function Settings() {
  const { can } = useSession();
  const router = useRouter(); const sp = useSearchParams();
  const s = can('settings.manage');
  const tabs: { id: Tab; label: string; hidden?: boolean }[] = [
    { id: 'company', label: 'Company', hidden: !s }, { id: 'thresholds', label: 'Margins & budgets', hidden: !s }, { id: 'approvals', label: 'Approvals', hidden: !s }, { id: 'notifications', label: 'Notifications', hidden: !s },
    { id: 'tax', label: 'Tax & payment terms', hidden: !s }, { id: 'categories', label: 'Categories', hidden: !s }, { id: 'currency', label: 'Exchange rates', hidden: !s }, { id: 'backup', label: 'Backup & data', hidden: !can('backup.run') },
  ];
  const visible = tabs.filter((t) => !t.hidden);
  const tab = visible.find((t) => t.id === sp.get('tab'))?.id ?? visible[0].id;
  const { data, error, reload } = useApi<any>(s ? '/api/settings' : null);
  return (
    <>
      <PageHeader title="Settings" sub="Company profile, thresholds, approval rules and reference data" />
      <Tabs tabs={tabs} value={tab} onChange={(t) => router.replace(`/settings?tab=${t}`)} />
      <div className="mt-4">
        {tab === 'backup' ? <Backup /> : error ? <ErrorBox error={error} /> : !data ? <Loading /> : (
          <>
            {tab === 'company' && <CompanyTab data={data} reload={reload} />}
            {tab === 'thresholds' && <ThresholdsTab data={data} reload={reload} />}
            {tab === 'approvals' && <ApprovalsTab data={data} reload={reload} />}
            {tab === 'notifications' && <NotificationsTab data={data} reload={reload} />}
            {tab === 'tax' && <TaxTab data={data} reload={reload} />}
            {tab === 'categories' && <CategoriesTab />}
            {tab === 'currency' && <CurrencyTab data={data} reload={reload} />}
          </>)}
      </div>
    </>
  );
}

/** shared PATCH /api/settings save button logic */
function useSave(reload: () => void) {
  const toast = useToast(); const { reloadMeta } = useSession();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null); const [fields, setFields] = useState<Record<string, string>>({});
  const save = async (body: unknown) => {
    setBusy(true); setError(null); setFields({});
    try { await api.patch('/api/settings', body); toast.success('Settings saved'); reload(); reloadMeta(); } catch (e) { setError(e as ApiFail); if (e instanceof ApiFail) setFields(e.fields); }
    setBusy(false);
  };
  return { busy, error, fields, save };
}

// ───────────── company ─────────────
function CompanyTab({ data, reload }: { data: any; reload: () => void }) {
  const { meta } = useSession();
  const c = data.company ?? {};
  const [v, setV] = useState({ name: c.name ?? '', legalName: c.legalName ?? '', gstin: c.gstin ?? '', pan: c.pan ?? '', address: c.address ?? '', email: c.email ?? '', phone: c.phone ?? '', baseCurrency: c.baseCurrency ?? 'INR', fyStartMonth: String(c.fyStartMonth ?? 4), dateFormat: c.dateFormat ?? 'DD/MM/YYYY' });
  const { busy, error, fields, save } = useSave(reload);
  const set = (k: string) => (e: React.ChangeEvent<any>) => setV({ ...v, [k]: e.target.value });
  const months = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, i, 1))));
  return (
    <Card>
      <CardHeader title="Company profile" sub="Printed on invoices and exports. The GSTIN’s state code decides CGST/SGST vs IGST." />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Company name" required error={fields.name}><Input value={v.name} onChange={set('name')} maxLength={150} /></Field>
        <Field label="Legal name" error={fields.legalName}><Input value={v.legalName} onChange={set('legalName')} maxLength={150} /></Field>
        <Field label="GSTIN" error={fields.gstin}><Input value={v.gstin} onChange={(e) => setV({ ...v, gstin: e.target.value.toUpperCase() })} maxLength={15} /></Field>
        <Field label="PAN" error={fields.pan}><Input value={v.pan} onChange={(e) => setV({ ...v, pan: e.target.value.toUpperCase() })} maxLength={10} /></Field>
        <Field label="Email" error={fields.email}><Input type="email" value={v.email} onChange={set('email')} /></Field>
        <Field label="Phone" error={fields.phone}><Input value={v.phone} onChange={set('phone')} maxLength={40} /></Field>
        <Field label="Address" className="md:col-span-2" error={fields.address}><Textarea rows={2} value={v.address} onChange={set('address')} maxLength={500} /></Field>
        <Field label="Base currency" hint="All portfolio totals are reported in this currency. Locked once projects exist." error={fields.baseCurrency}>
          <Select value={v.baseCurrency} onChange={set('baseCurrency')}>{(meta?.currencies ?? ['INR']).map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Financial year starts in" hint="India: April" error={fields.fyStartMonth}><Select value={v.fyStartMonth} onChange={set('fyStartMonth')}>{months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
        <Field label="Date format" error={fields.dateFormat}><Select value={v.dateFormat} onChange={set('dateFormat')}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option></Select></Field>
      </div>
      <ErrorBox error={error} className="mt-4" />
      <div className="mt-4"><Button variant="primary" loading={busy} onClick={() => save({ company: { ...v, fyStartMonth: Number(v.fyStartMonth) } })}>Save company</Button></div>
    </Card>
  );
}

// ───────────── numeric settings helper ─────────────
function NumForm({ fields, values, onSave, busy, error, serverErrors }: { fields: { key: string; label: string; hint?: string; suffix?: string; money?: boolean }[]; values: Record<string, any>; onSave: (v: Record<string, number>) => void; busy: boolean; error: ApiFail | null; serverErrors: Record<string, string> }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, String(values[f.key] ?? '')])));
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint} error={serverErrors[f.key]}>
            <div className="flex items-center gap-2">{f.money ? <MoneyInput value={v[f.key]} onChange={(x) => setV({ ...v, [f.key]: x })} /> : <Input inputMode="decimal" value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />}{f.suffix && <span className="text-sm text-ink-500">{f.suffix}</span>}</div>
          </Field>))}
      </div>
      <ErrorBox error={error} className="mt-4" />
      <div className="mt-4"><Button variant="primary" loading={busy} onClick={() => onSave(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)])))}>Save</Button></div>
    </>
  );
}

function ThresholdsTab({ data, reload }: { data: any; reload: () => void }) {
  const { busy, error, fields, save } = useSave(reload);
  return (
    <Card>
      <CardHeader title="Margin & budget thresholds" sub="These drive project health colours, dashboard alerts and notifications everywhere in the portal." />
      <NumForm busy={busy} error={error} serverErrors={fields} values={data.settings.thresholds} onSave={(v) => save({ thresholds: v })} fields={[
        { key: 'targetMarginPct', label: 'Target margin', suffix: '%', hint: 'At or above this a project is healthy.' },
        { key: 'criticalMarginPct', label: 'Critical margin', suffix: '%', hint: 'Below this a project is flagged as low margin.' },
        { key: 'budgetWarnPct', label: 'Budget warning at', suffix: '% used' }, { key: 'budgetAlertPct', label: 'Budget alert at', suffix: '% used' },
        { key: 'overdueSharePct', label: 'Overdue share flagged at', suffix: '% of billed', hint: 'Share of invoiced amount overdue before a project turns critical.' },
        { key: 'overdueDays', label: 'Overdue after', suffix: 'days past due date' },
      ]} />
    </Card>
  );
}

function ApprovalsTab({ data, reload }: { data: any; reload: () => void }) {
  const a = data.settings.approvals;
  const { busy, error, fields, save } = useSave(reload);
  const [flags, setFlags] = useState({ requireNewProjectApproval: !!a.requireNewProjectApproval, budgetIncreaseRequiresApproval: !!a.budgetIncreaseRequiresApproval, cancellationRequiresApproval: !!a.cancellationRequiresApproval, overBudgetRequiresApproval: !!a.overBudgetRequiresApproval });
  const [nums, setNums] = useState<Record<string, number>>({});
  return (
    <Card>
      <CardHeader title="Approval rules" sub="Requests that break a rule are routed to someone with the approve permission. Nobody can approve their own request." />
      <ApprovalNums a={a} onChange={setNums} errors={fields} />
      <div className="mt-4 space-y-2">
        <Check label="New projects need approval before they become active" checked={flags.requireNewProjectApproval} onChange={(c) => setFlags({ ...flags, requireNewProjectApproval: c })} />
        <div><Check label="Budget increases need approval" checked={flags.budgetIncreaseRequiresApproval} onChange={(c) => setFlags({ ...flags, budgetIncreaseRequiresApproval: c })} /></div>
        <div><Check label="Project cancellation needs approval" checked={flags.cancellationRequiresApproval} onChange={(c) => setFlags({ ...flags, cancellationRequiresApproval: c })} /></div>
        <div><Check label="Costs that would exceed a budget need approval" checked={flags.overBudgetRequiresApproval} onChange={(c) => setFlags({ ...flags, overBudgetRequiresApproval: c })} /></div>
      </div>
      <ErrorBox error={error} className="mt-4" />
      <div className="mt-4"><Button variant="primary" loading={busy} onClick={() => save({ approvals: { ...nums, ...flags } })}>Save approval rules</Button></div>
    </Card>
  );
}
function ApprovalNums({ a, onChange, errors }: { a: any; onChange: (n: Record<string, number>) => void; errors: Record<string, string> }) {
  const [v, setV] = useState({ expenseThreshold: String(a.expenseThreshold), vendorExpenseThreshold: String(a.vendorExpenseThreshold), discountThresholdPct: String(a.discountThresholdPct) });
  useEffect(() => { onChange(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)]))); /* eslint-disable-next-line */ }, [v]);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Field label="Costs / expenses above" hint="0 turns this rule off" error={errors.expenseThreshold}><MoneyInput value={v.expenseThreshold} onChange={(x) => setV({ ...v, expenseThreshold: x })} /></Field>
      <Field label="Vendor expenses above" hint="0 turns this rule off" error={errors.vendorExpenseThreshold}><MoneyInput value={v.vendorExpenseThreshold} onChange={(x) => setV({ ...v, vendorExpenseThreshold: x })} /></Field>
      <Field label="Discount above (% of price)" hint="0 turns this rule off" error={errors.discountThresholdPct}><Input inputMode="decimal" value={v.discountThresholdPct} onChange={(e) => setV({ ...v, discountThresholdPct: e.target.value })} /></Field>
    </div>
  );
}

function NotificationsTab({ data, reload }: { data: any; reload: () => void }) {
  const n = data.settings.notifications;
  const { busy, error, fields, save } = useSave(reload);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ ...n.enabled });
  const [nums, setNums] = useState<Record<string, number>>({ renewalDays: n.renewalDays, endingSoonDays: n.endingSoonDays, largeExpense: n.largeExpense });
  const toast = useToast();
  const scan = async () => { try { const r = await api.post('/api/notifications/scan', {}); toast.success(`Scan finished — ${r.data?.created ?? 0} new alert(s)`); } catch (e) { toast.fail(e); } };
  return (
    <Card>
      <CardHeader title="Notifications" sub="Choose which alerts the portal raises. Individual users can also mute types for themselves." />
      <div className="grid gap-2 sm:grid-cols-2">{Object.keys(n.enabled).map((k) => <Check key={k} label={title(k)} checked={!!enabled[k]} onChange={(c) => setEnabled({ ...enabled, [k]: c })} />)}</div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Field label="Warn before retainer renewal" error={fields.renewalDays}><div className="flex items-center gap-2"><Input inputMode="numeric" value={nums.renewalDays} onChange={(e) => setNums({ ...nums, renewalDays: e.target.value as never })} /><span className="text-sm text-ink-500">days</span></div></Field>
        <Field label="Warn before project end" error={fields.endingSoonDays}><div className="flex items-center gap-2"><Input inputMode="numeric" value={nums.endingSoonDays} onChange={(e) => setNums({ ...nums, endingSoonDays: e.target.value as never })} /><span className="text-sm text-ink-500">days</span></div></Field>
        <Field label="Large expense at or above" error={fields.largeExpense}><MoneyInput value={String(nums.largeExpense)} onChange={(x) => setNums({ ...nums, largeExpense: x as never })} /></Field>
      </div>
      <ErrorBox error={error} className="mt-4" />
      <div className="mt-4 flex gap-2"><Button variant="primary" loading={busy} onClick={() => save({ notifications: { enabled, renewalDays: Number(nums.renewalDays), endingSoonDays: Number(nums.endingSoonDays), largeExpense: Number(nums.largeExpense) } })}>Save notifications</Button><Button onClick={scan}>Run alert scan now</Button></div>
      <p className="mt-2 text-xs text-ink-500">Alerts are also evaluated whenever a cost, invoice or payment changes, and once a day by the scheduled job (<span className="font-mono">npm run jobs:daily</span>).</p>
    </Card>
  );
}

// ───────────── tax & payment terms ─────────────
function TaxTab({ data, reload }: { data: any; reload: () => void }) {
  const toast = useToast();
  const [tax, setTax] = useState({ name: '', ratePct: '', isDefault: false });
  const [term, setTerm] = useState({ name: '', days: '' });
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.success(ok); reload(); } catch (e) { toast.fail(e); } };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card pad={false}>
        <div className="p-4 pb-0"><CardHeader title="Tax rates" sub="Rates are data, not code — add or change them as GST rules change." /></div>
        <SimpleTable rows={data.taxRates} columns={[
          { key: 'name', label: 'Name', render: (r: any) => <span>{r.name}{r.isDefault && <Badge tone="blue" className="ml-2">Default</Badge>}{!r.active && <Badge className="ml-2">Inactive</Badge>}</span> },
          { key: 'ratePct', label: 'Rate', align: 'right', render: (r: any) => `${Number(r.ratePct)}%` },
          { key: 'a', label: '', render: (r: any) => <span className="flex justify-end gap-1">
            {!r.isDefault && r.active && <Button size="sm" variant="ghost" onClick={() => act(() => api.patch(`/api/settings/tax-rates/${r.id}`, { isDefault: true }), 'Default tax rate updated')}>Make default</Button>}
            {!r.isDefault && <Button size="sm" variant="ghost" onClick={() => act(() => api.patch(`/api/settings/tax-rates/${r.id}`, { active: !r.active }), r.active ? 'Rate deactivated' : 'Rate activated')}>{r.active ? 'Deactivate' : 'Activate'}</Button>}</span> },
        ]} />
        <form className="flex flex-wrap items-end gap-2 border-t border-ink-100 p-4" onSubmit={(e) => { e.preventDefault(); act(async () => { await api.post('/api/settings/tax-rates', { name: tax.name, ratePct: Number(tax.ratePct), isDefault: tax.isDefault }); setTax({ name: '', ratePct: '', isDefault: false }); }, 'Tax rate added'); }}>
          <Field label="Name"><Input value={tax.name} onChange={(e) => setTax({ ...tax, name: e.target.value })} className="w-36" required /></Field>
          <Field label="Rate %"><Input value={tax.ratePct} onChange={(e) => setTax({ ...tax, ratePct: e.target.value })} inputMode="decimal" className="w-24" required /></Field>
          <Check label="Default" checked={tax.isDefault} onChange={(c) => setTax({ ...tax, isDefault: c })} />
          <Button type="submit" icon={<Plus className="h-4 w-4" />}>Add</Button>
        </form>
      </Card>
      <Card pad={false}>
        <div className="p-4 pb-0"><CardHeader title="Payment terms" sub="Used to compute invoice due dates." /></div>
        <SimpleTable rows={data.paymentTerms} columns={[
          { key: 'name', label: 'Name', render: (r: any) => <span>{r.name}{!r.active && <Badge className="ml-2">Inactive</Badge>}</span> },
          { key: 'days', label: 'Days', align: 'right' },
          { key: 'a', label: '', render: (r: any) => <span className="flex justify-end"><Button size="sm" variant="ghost" onClick={() => act(() => api.patch(`/api/settings/payment-terms/${r.id}`, { active: !r.active }), r.active ? 'Term deactivated' : 'Term activated')}>{r.active ? 'Deactivate' : 'Activate'}</Button></span> },
        ]} />
        <form className="flex flex-wrap items-end gap-2 border-t border-ink-100 p-4" onSubmit={(e) => { e.preventDefault(); act(async () => { await api.post('/api/settings/payment-terms', { name: term.name, days: Number(term.days) }); setTerm({ name: '', days: '' }); }, 'Payment term added'); }}>
          <Field label="Name"><Input value={term.name} onChange={(e) => setTerm({ ...term, name: e.target.value })} className="w-40" required /></Field>
          <Field label="Days"><Input value={term.days} onChange={(e) => setTerm({ ...term, days: e.target.value })} inputMode="numeric" className="w-24" required /></Field>
          <Button type="submit" icon={<Plus className="h-4 w-4" />}>Add</Button>
        </form>
      </Card>
    </div>
  );
}

// ───────────── categories ─────────────
function CategoriesTab() {
  const toast = useToast(); const { reloadMeta } = useSession();
  const [kind, setKind] = useState<'SERVICE' | 'COST' | 'EXPENSE'>('SERVICE');
  const { data, error, reload } = useApi<any[]>(`/api/categories?kind=${kind}&includeInactive=1`);
  const [name, setName] = useState(''); const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const done = () => { reload(); reloadMeta(); };
  const act = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast.success(ok); done(); } catch (e) { toast.fail(e); } };
  const move = (i: number, d: -1 | 1) => { const ids = data!.map((c) => c.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; act(() => api.post('/api/categories/reorder', { ids })); };
  return (
    <Card>
      <CardHeader title="Categories" sub="Service types classify projects; cost and expense categories classify spending. Categories in use are deactivated rather than deleted." />
      <Tabs tabs={[{ id: 'SERVICE', label: 'Services' }, { id: 'COST', label: 'Project cost categories' }, { id: 'EXPENSE', label: 'Expense categories' }]} value={kind} onChange={setKind} />
      {error ? <ErrorBox error={error} className="mt-3" /> : !data ? <Loading /> : (
        <ul className="mt-3 divide-y divide-ink-100 rounded-lg border border-ink-200">
          {data.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-2">
              {edit?.id === c.id
                ? <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); act(async () => { await api.patch(`/api/categories/${c.id}`, { name: edit!.name }); setEdit(null); }, 'Category renamed'); }}><Input value={edit!.name} onChange={(e) => setEdit({ id: c.id, name: e.target.value })} autoFocus maxLength={80} /><Button type="submit" size="sm" variant="primary">Save</Button><Button size="sm" onClick={() => setEdit(null)}>Cancel</Button></form>
                : <><span className={`flex-1 text-sm ${c.active ? 'text-ink-900' : 'text-ink-400 line-through'}`}>{c.name}</span>
                  <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === data.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ id: c.id, name: c.name })}>Rename</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(() => api.patch(`/api/categories/${c.id}`, { active: !c.active }), c.active ? 'Category deactivated' : 'Category activated')}>{c.active ? 'Deactivate' : 'Activate'}</Button></>}
            </li>))}
        </ul>)}
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; act(async () => { await api.post('/api/categories', { kind, name: name.trim() }); setName(''); }, 'Category added'); }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" maxLength={80} className="max-w-xs" aria-label="New category name" /><Button type="submit" icon={<Plus className="h-4 w-4" />}>Add category</Button>
      </form>
    </Card>
  );
}

// ───────────── exchange rates ─────────────
function CurrencyTab({ data, reload }: { data: any; reload: () => void }) {
  const toast = useToast(); const confirm = useConfirm(); const { meta } = useSession();
  const base = data.company?.baseCurrency ?? 'INR';
  const [f, setF] = useState({ currency: '', rateToBase: '', effectiveOn: today() });
  const add = async () => { try { await api.post('/api/settings/exchange-rates', { currency: f.currency, rateToBase: Number(f.rateToBase), effectiveOn: f.effectiveOn }); toast.success('Exchange rate added'); setF({ ...f, rateToBase: '' }); reload(); } catch (e) { toast.fail(e); } };
  const del = async (r: any) => { const c = await confirm({ title: 'Delete this rate?', message: 'Existing projects keep the rate they were created with.', confirmLabel: 'Delete', danger: true }); if (!c.ok) return; try { await api.del(`/api/settings/exchange-rates/${r.id}`); toast.success('Rate deleted'); reload(); } catch (e) { toast.fail(e); } };
  return (
    <Card pad={false}>
      <div className="p-4 pb-0"><CardHeader title="Exchange rates" sub={`Rates convert a foreign currency into ${base}. A project takes the latest rate on or before its start date, and you can override it on the project.`} /></div>
      <SimpleTable rows={data.exchangeRates} empty={<p className="p-4 text-sm text-ink-500">No foreign-currency rates yet. Projects in {base} need none.</p>} columns={[
        { key: 'currency', label: 'Currency' }, { key: 'rateToBase', label: `1 unit in ${base}`, align: 'right', render: (r: any) => Number(r.rateToBase).toLocaleString('en-IN', { maximumFractionDigits: 6 }) },
        { key: 'effectiveOn', label: 'Effective from', render: (r: any) => dmy(r.effectiveOn) }, { key: 'a', label: '', render: (r: any) => <span className="flex justify-end"><Button size="sm" variant="ghost" aria-label="Delete rate" onClick={() => del(r)}><Trash2 className="h-4 w-4" /></Button></span> },
      ]} />
      <form className="flex flex-wrap items-end gap-2 border-t border-ink-100 p-4" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Field label="Currency"><Select className="w-28" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} required><option value="">Select…</option>{(meta?.currencies ?? []).filter((c) => c !== base).map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label={`Rate (${base} per unit)`}><Input inputMode="decimal" className="w-36" value={f.rateToBase} onChange={(e) => setF({ ...f, rateToBase: e.target.value })} required /></Field>
        <Field label="Effective from"><Input type="date" value={f.effectiveOn} onChange={(e) => setF({ ...f, effectiveOn: e.target.value })} required /></Field>
        <Button type="submit" icon={<Plus className="h-4 w-4" />}>Add rate</Button>
      </form>
    </Card>
  );
}

// ───────────── backup ─────────────
function Backup() {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { await api.download('/api/backup', 'finance-portal-export.json'); toast.success('Data export downloaded'); } catch (e) { toast.fail(e); } setBusy(false); };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Portable data export" sub="A JSON file of every business table: projects, costs, invoices, payments, expenses, clients, settings and the audit log. Password hashes and sessions are never included." />
        <Button variant="primary" icon={<Download className="h-4 w-4" />} loading={busy} onClick={run}>Download JSON export</Button>
        <p className="mt-2 text-xs text-ink-500">Limited to 5 exports per hour. Every export is written to the audit log.</p>
      </Card>
      <Notice tone="warn">
        <b>The JSON export is not a disaster-recovery backup.</b> Take real backups of the database with <span className="font-mono">npm run db:backup</span> (a compressed <span className="font-mono">pg_dump</span>), schedule it daily and store copies off the server.
        Restore with <span className="font-mono">npm run db:restore -- &lt;file&gt;</span>. Uploaded attachments live in the upload directory and must be backed up too. See <span className="font-mono">docs/BACKUP_RESTORE.md</span>.
      </Notice>
    </div>
  );
}
