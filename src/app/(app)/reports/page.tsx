'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Field, HealthDot, Input, Loading, Notice, PageHeader, Select, SimpleTable, Stat, Tabs, type Column } from '@/ui/kit';
import { useApi } from '@/ui/hooks';
import { qs } from '@/ui/api';
import { dmy, inr, inr0, monthShort, pct, title } from '@/ui/format';
import { useSession } from '@/ui/session';
import { Guard } from '@/components/guard';
import { ExportMenu } from '@/components/export-menu';
import { ProjectPicker } from '@/components/pickers';
import { MoneyBars, MoneyLines } from '@/components/charts';

type Tab = 'profitability' | 'compare' | 'receivables' | 'pnl' | 'forecast';

export default function ReportsPage() { return <Guard any={['reports.view', 'forecast.view']}><Suspense><Reports /></Suspense></Guard>; }

function Reports() {
  const { can } = useSession();
  const router = useRouter();
  const sp = useSearchParams();
  const tabs = [
    { id: 'profitability' as Tab, label: 'Profitability', hidden: !(can('reports.view') && can('profit.view')) },
    { id: 'compare' as Tab, label: 'Compare projects', hidden: !can('reports.view') },
    { id: 'receivables' as Tab, label: 'Receivables ageing', hidden: !(can('reports.view') && can('payments.view')) },
    { id: 'pnl' as Tab, label: 'Company P&L', hidden: !(can('reports.view') && can('profit.view') && can('costs.view') && can('expenses.view')) },
    { id: 'forecast' as Tab, label: 'Forecast', hidden: !(can('forecast.view') && can('profit.view') && can('costs.view')) },
  ];
  const visible = tabs.filter((t) => !t.hidden);
  const requested = (sp.get('tab') as Tab) || 'profitability';
  const tab = visible.find((t) => t.id === requested)?.id ?? visible[0]?.id;
  return (
    <>
      <PageHeader title="Reports" sub="Profitability, receivables, company P&L and forecasts — all computed from your live records" />
      {!tab ? <Empty title="No reports available" hint="Your role does not include any report permissions." /> : <>
        <Tabs tabs={tabs} value={tab} onChange={(t) => router.replace(`/reports?tab=${t}`)} />
        <div className="mt-4">
          {tab === 'profitability' && <Profitability />}
          {tab === 'compare' && <Compare />}
          {tab === 'receivables' && <Receivables />}
          {tab === 'pnl' && <Pnl />}
          {tab === 'forecast' && <Forecast />}
        </div>
      </>}
    </>
  );
}

const marginTone = (m: number | null | undefined) => (m === null || m === undefined ? '' : m < 0 ? 'text-red-600' : m < 10 ? 'text-amber-600' : 'text-emerald-700');
const profitCls = (v: number) => (v < 0 ? 'text-red-600' : '');

// ───────────── profitability ─────────────
function Profitability() {
  const [group, setGroup] = useState('service');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const params = { group, from: from || undefined, to: to || undefined };
  const { data, error, loading } = useApi<any>(`/api/reports/profitability${qs(params)}`);
  const cols: Column<any>[] = [
    { key: 'label', label: title(group === 'type' ? 'project type' : group), render: (r) => <span className="font-medium text-ink-900">{r.label}</span> },
    { key: 'projects', label: 'Projects', align: 'right' },
    { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => inr0(r.revenue) },
    { key: 'cost', label: 'Cost', align: 'right', render: (r) => inr0(r.cost) },
    { key: 'profit', label: 'Profit', align: 'right', render: (r) => <span className={profitCls(r.profit)}>{inr0(r.profit)}</span> },
    { key: 'marginPct', label: 'Margin', align: 'right', render: (r) => <span className={marginTone(r.marginPct)}>{pct(r.marginPct)}</span> },
    { key: 'projectedProfit', label: 'Projected profit', align: 'right', hideBelow: 'md', render: (r) => <span className={profitCls(r.projectedProfit)}>{inr0(r.projectedProfit)}</span> },
    { key: 'overBudget', label: 'Over budget', align: 'right', hideBelow: 'lg', render: (r) => (r.overBudget ? <Badge tone="red">{r.overBudget}</Badge> : '—') },
  ];
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Group by"><Select className="w-44" value={group} onChange={(e) => setGroup(e.target.value)}><option value="service">Service</option><option value="client">Client</option><option value="type">Project type</option><option value="manager">Project manager</option><option value="status">Status</option></Select></Field>
          <Field label="Projects starting from"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          {(from || to) && <Button variant="ghost" onClick={() => { setFrom(''); setTo(''); }}>Clear dates</Button>}
          <div className="ml-auto"><ExportMenu dataset="report-profitability" params={params} /></div>
        </div>
      </Card>
      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Revenue" value={inr0(data.totals.revenue)} sub={`${data.totals.projects} projects`} />
            <Stat label="Cost" value={inr0(data.totals.cost)} />
            <Stat label="Profit" value={inr0(data.totals.profit)} tone={data.totals.profit < 0 ? 'bad' : 'good'} sub={`Margin ${pct(data.totals.marginPct)}`} />
            <Stat label="Best / worst" value={<span className="text-base">{data.best ?? '—'}</span>} sub={data.worst ? `Lowest: ${data.worst}` : undefined} />
          </div>
          <Card>
            <CardHeader title="Revenue, cost and profit" />
            {data.rows.length ? <MoneyBars data={data.rows} x="label" bars={[{ key: 'revenue', name: 'Revenue' }, { key: 'cost', name: 'Cost', color: '#f59e0b' }, { key: 'profit', name: 'Profit', color: '#10b981' }]} height={280} /> : <Empty title="No data for this selection" />}
          </Card>
          <Card pad={false}><div className={loading ? 'opacity-60' : ''}><SimpleTable rows={data.rows.map((r: any) => ({ ...r, id: r.key }))} columns={cols} empty={<Empty title="No projects match" />}
            foot={<tr className="bg-ink-50 font-medium"><td className="td">Total</td><td className="td num">{data.totals.projects}</td><td className="td num">{inr0(data.totals.revenue)}</td><td className="td num">{inr0(data.totals.cost)}</td><td className="td num">{inr0(data.totals.profit)}</td><td className="td num">{pct(data.totals.marginPct)}</td><td className="td hidden md:table-cell" /><td className="td hidden lg:table-cell" /></tr>} /></div></Card>
          <p className="text-xs text-ink-500">Revenue is invoiced revenue excluding tax; cost is approved/paid actual cost including allocated payroll and expenses. Projects in draft or cancelled status are excluded from revenue totals.</p>
        </>)}
    </div>
  );
}

// ───────────── compare ─────────────
function Compare() {
  const [ids, setIds] = useState<string[]>([]);
  const [pick, setPick] = useState(0);
  const { data, error } = useApi<any[]>(ids.length >= 2 ? `/api/reports/compare${qs({ ids: ids.join(',') })}` : null);
  const { can } = useSession();
  const rows: [string, (r: any) => React.ReactNode][] = [
    ['Client', (r) => r.client], ['Service', (r) => r.service], ['Type', (r) => title(r.type)], ['Status', (r) => title(r.status)], ['Dates', (r) => `${dmy(r.startDate)} – ${dmy(r.endDate)}`],
    ['Revenue', (r) => inr0(r.revenue, r.currency)], ['Estimated cost', (r) => inr0(r.estimatedCost, r.currency)], ['Actual cost', (r) => inr0(r.actualCost, r.currency)], ['Projected cost', (r) => inr0(r.projectedCost, r.currency)],
    ['Estimated profit', (r) => inr0(r.estimatedProfit, r.currency)], ['Actual profit', (r) => <span className={profitCls(r.actualProfit)}>{inr0(r.actualProfit, r.currency)}</span>], ['Projected profit', (r) => <span className={profitCls(r.projectedProfit)}>{inr0(r.projectedProfit, r.currency)}</span>],
    ['Actual margin', (r) => <span className={marginTone(r.marginPct)}>{pct(r.marginPct)}</span>], ['Projected margin', (r) => <span className={marginTone(r.projectedMarginPct)}>{pct(r.projectedMarginPct)}</span>],
    ['Budget', (r) => inr0(r.budget, r.currency)], ['Budget used', (r) => pct(r.budgetUtilizationPct, 0)], ['Outstanding', (r) => inr0(r.outstanding, r.currency)], ['Collected', (r) => pct(r.collectionPct, 0)],
    ['Health', (r) => <HealthDot status={r.health} label />],
  ];
  const visible = rows.filter(([label]) => !['Revenue', 'Estimated profit', 'Actual profit', 'Projected profit', 'Actual margin', 'Projected margin', 'Outstanding', 'Collected'].includes(label) || can('profit.view')).filter(([label]) => !['Estimated cost', 'Actual cost', 'Projected cost', 'Budget', 'Budget used'].includes(label) || can('costs.view'));
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Add a project (2–6)" className="w-full sm:w-80"><ProjectPicker key={pick} value="" onChange={(v) => { if (v && !ids.includes(v) && ids.length < 6) setIds([...ids, v]); setPick(pick + 1); }} placeholder="Search project to add…" /></Field>
          {ids.length > 0 && <Button variant="ghost" onClick={() => setIds([])}>Clear all</Button>}
        </div>
        {ids.length === 1 && <p className="mt-2 text-sm text-ink-500">Add at least one more project to compare.</p>}
      </Card>
      {ids.length < 2 ? <Empty title="Pick projects to compare" hint="Compare revenue, cost, margin, budget use and collections side by side." />
        : error ? <ErrorBox error={error} /> : !data ? <Loading /> : (
          <Card pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr><th className="th">Metric</th>{data.map((p) => (
                  <th key={p.id} className="th min-w-40 normal-case">
                    <div className="flex items-start justify-between gap-1"><span><Link className="text-brand-700 hover:underline" href={`/projects/${p.id}`}>{p.code}</Link><span className="block font-normal text-ink-600">{p.name}</span></span>
                      <button aria-label={`Remove ${p.code}`} className="text-ink-400 hover:text-ink-700" onClick={() => setIds(ids.filter((i) => i !== p.id))}><X className="h-4 w-4" /></button></div>
                  </th>))}</tr></thead>
                <tbody>{visible.map(([label, f]) => <tr key={label}><td className="td font-medium text-ink-700">{label}</td>{data.map((p) => <td key={p.id} className="td num">{f(p)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </Card>)}
    </div>
  );
}

// ───────────── receivables ─────────────
const BUCKETS: [string, string][] = [['current', 'Not yet due'], ['d1_30', '1–30 days'], ['d31_60', '31–60 days'], ['d61_90', '61–90 days'], ['d90plus', '90+ days']];
function Receivables() {
  const [asOf, setAsOf] = useState('');
  const params = { asOf: asOf || undefined };
  const { data, error } = useApi<any>(`/api/reports/receivables${qs(params)}`);
  const cols: Column<any>[] = [
    { key: 'number', label: 'Invoice', render: (r) => <span className="whitespace-nowrap font-mono text-xs">{r.number}</span> },
    { key: 'project', label: 'Project', render: (r) => <span><Link className="text-brand-700 hover:underline" href={`/projects/${r.projectId}`}>{r.code}</Link><span className="block text-xs text-ink-500">{r.client}</span></span> },
    { key: 'dueDate', label: 'Due', render: (r) => dmy(r.dueDate) },
    { key: 'daysOverdue', label: 'Overdue', align: 'right', render: (r) => (r.daysOverdue > 0 ? <span className="text-red-600">{r.daysOverdue} d</span> : '—') },
    { key: 'total', label: 'Invoice total', align: 'right', hideBelow: 'md', render: (r) => inr(r.total, r.currency) },
    { key: 'outstanding', label: 'Outstanding', align: 'right', render: (r) => <span className="font-medium">{inr(r.outstanding, r.currency)}</span> },
  ];
  return (
    <div className="space-y-4">
      <Card><div className="flex flex-wrap items-end gap-3"><Field label="As of date" hint="Leave blank for today"><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field><div className="ml-auto"><ExportMenu dataset="report-receivables" params={params} /></div></div></Card>
      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="Total outstanding" value={inr0(data.totalOutstanding)} sub={`as of ${dmy(data.asOf)}`} />
            <Stat label="Overdue" value={inr0(data.overdue)} tone={data.overdue > 0 ? 'bad' : 'good'} sub={data.totalOutstanding ? `${pct((data.overdue / data.totalOutstanding) * 100, 0)} of outstanding` : undefined} />
            <Stat label="Open invoices" value={String(data.invoices.length)} />
          </div>
          <Card>
            <CardHeader title="Ageing buckets" />
            <MoneyBars data={BUCKETS.map(([k, label]) => ({ label, value: data.buckets[k] }))} x="label" bars={[{ key: 'value', name: 'Outstanding', color: '#4f46e5' }]} height={220} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card pad={false} className="lg:col-span-1">
              <div className="p-4 pb-0"><CardHeader title="By client" /></div>
              <SimpleTable rows={data.byClient.map((c: any) => ({ ...c, id: c.clientId }))} empty={<Empty title="Nothing outstanding" />} columns={[
                { key: 'client', label: 'Client', render: (r: any) => <Link className="text-brand-700 hover:underline" href={`/clients/${r.clientId}`}>{r.client}</Link> },
                { key: 'outstanding', label: 'Outstanding', align: 'right', render: (r: any) => inr0(r.outstanding) },
                { key: 'overdue', label: 'Overdue', align: 'right', render: (r: any) => <span className={r.overdue > 0 ? 'text-red-600' : ''}>{inr0(r.overdue)}</span> },
              ]} />
            </Card>
            <Card pad={false} className="lg:col-span-2">
              <div className="p-4 pb-0"><CardHeader title="Open invoices" sub="Balances are shown in each invoice’s own currency" /></div>
              <SimpleTable rows={data.invoices} columns={cols} empty={<Empty title="No open invoices" />} />
            </Card>
          </div>
          <Notice>Outstanding = invoice balance less payments applied. Unapplied advances are not netted here; see the client page for the net position.</Notice>
        </>)}
    </div>
  );
}

// ───────────── company P&L ─────────────
function Pnl() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const params = { from: from || undefined, to: to || undefined };
  const { data, error } = useApi<any>(`/api/reports/pnl${qs(params)}`);
  const cols: Column<any>[] = [
    { key: 'month', label: 'Month', render: (r) => monthShort(r.month) },
    { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => inr0(r.revenue) },
    { key: 'projectCost', label: 'Project costs', align: 'right', render: (r) => inr0(r.projectCost) },
    { key: 'companyExpenses', label: 'Company expenses', align: 'right', hideBelow: 'md', render: (r) => inr0(r.companyExpenses) },
    { key: 'payroll', label: 'Payroll', align: 'right', hideBelow: 'md', render: (r) => inr0(r.payroll) },
    { key: 'totalCost', label: 'Total cost', align: 'right', render: (r) => inr0(r.totalCost) },
    { key: 'netProfit', label: 'Net profit', align: 'right', render: (r) => <span className={`font-medium ${profitCls(r.netProfit)}`}>{inr0(r.netProfit)}</span> },
    { key: 'marginPct', label: 'Margin', align: 'right', hideBelow: 'sm', render: (r) => <span className={marginTone(r.marginPct)}>{pct(r.marginPct)}</span> },
  ];
  return (
    <div className="space-y-4">
      <Card><div className="flex flex-wrap items-end gap-3"><Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <span className="pb-2 text-xs text-ink-500">Default: last 12 months</span><div className="ml-auto"><ExportMenu dataset="report-pnl" params={params} /></div></div></Card>
      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Revenue" value={inr0(data.totals.revenue)} sub={`${dmy(data.from)} – ${dmy(data.to)}`} />
            <Stat label="Total cost" value={inr0(data.totals.totalCost)} sub={`Payroll ${inr0(data.totals.payroll)}`} />
            <Stat label="Net profit" value={inr0(data.totals.netProfit)} tone={data.totals.netProfit < 0 ? 'bad' : 'good'} />
            <Stat label="Net margin" value={pct(data.totals.marginPct)} tone={data.totals.marginPct !== null && data.totals.marginPct < 0 ? 'bad' : 'neutral'} />
          </div>
          <Card><CardHeader title="Revenue vs cost" /><MoneyLines data={data.rows} lines={[{ key: 'revenue', name: 'Revenue' }, { key: 'totalCost', name: 'Total cost', color: '#f59e0b' }, { key: 'netProfit', name: 'Net profit', color: '#10b981' }]} /></Card>
          <Card pad={false}><SimpleTable rows={data.rows.map((r: any) => ({ ...r, id: r.month }))} columns={cols}
            foot={<tr className="bg-ink-50 font-medium"><td className="td">Total</td><td className="td num">{inr0(data.totals.revenue)}</td><td className="td num">{inr0(data.totals.projectCost)}</td><td className="td num hidden md:table-cell">{inr0(data.totals.companyExpenses)}</td><td className="td num hidden md:table-cell">{inr0(data.totals.payroll)}</td><td className="td num">{inr0(data.totals.totalCost)}</td><td className="td num">{inr0(data.totals.netProfit)}</td><td className="td num hidden sm:table-cell">{pct(data.totals.marginPct)}</td></tr>} /></Card>
          <Notice>{data.notes.basis}{data.notes.undatedResourceCost > 0 && <> Hourly/vendor resource cost of {inr0(data.notes.undatedResourceCost)} is recorded without a date and therefore shows in project totals but not in this monthly view.</>}</Notice>
        </>)}
    </div>
  );
}

// ───────────── forecast ─────────────
function Forecast() {
  const [months, setMonths] = useState('6');
  const { data, error } = useApi<any>(`/api/reports/forecast${qs({ months })}`);
  const cols: Column<any>[] = [
    { key: 'month', label: 'Month', render: (r) => <span>{monthShort(r.month)} <Badge tone={r.phase === 'ACTUAL' ? 'gray' : r.phase === 'CURRENT' ? 'blue' : 'purple'} className="ml-1">{title(r.phase)}</Badge></span> },
    { key: 'projectedRevenue', label: 'Revenue', align: 'right', render: (r) => inr0(r.projectedRevenue) },
    { key: 'projectedCost', label: 'Cost', align: 'right', render: (r) => inr0(r.projectedCost) },
    { key: 'projectedProfit', label: 'Profit', align: 'right', render: (r) => <span className={`font-medium ${profitCls(r.projectedProfit)}`}>{inr0(r.projectedProfit)}</span> },
    { key: 'committedCost', label: 'Committed cost', align: 'right', hideBelow: 'md', render: (r) => inr0(r.committedCost) },
    { key: 'retainerRevenue', label: 'Retainers', align: 'right', hideBelow: 'lg', render: (r) => inr0(r.retainerRevenue) },
    { key: 'scheduledRevenue', label: 'Scheduled invoices', align: 'right', hideBelow: 'lg', render: (r) => inr0(r.scheduledRevenue) },
    { key: 'recurring', label: 'Recurring costs', align: 'right', hideBelow: 'lg', render: (r) => inr0(r.recurringCost + r.recurringExpenses) },
  ];
  return (
    <div className="space-y-4">
      <Card><div className="flex flex-wrap items-end gap-3"><Field label="Horizon"><Select className="w-40" value={months} onChange={(e) => setMonths(e.target.value)}>{[3, 6, 9, 12, 18, 24].map((m) => <option key={m} value={m}>{m} months</option>)}</Select></Field><div className="ml-auto"><ExportMenu dataset="report-forecast" params={{ months }} /></div></div></Card>
      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Projected revenue" value={inr0(data.totals.projectedRevenue)} sub={`next ${data.horizonMonths} months`} />
            <Stat label="Projected cost" value={inr0(data.totals.projectedCost)} />
            <Stat label="Projected profit" value={inr0(data.totals.projectedProfit)} tone={data.totals.projectedProfit < 0 ? 'bad' : 'good'} />
            <Stat label="Committed cost" value={inr0(data.totals.committed)} sub="approved commitments" />
          </div>
          <Card><CardHeader title="Actual and forecast" /><MoneyBars data={data.months} x="month" bars={[{ key: 'projectedRevenue', name: 'Revenue' }, { key: 'projectedCost', name: 'Cost', color: '#f59e0b' }]} height={280} /></Card>
          <Card pad={false}><SimpleTable rows={data.months.map((r: any) => ({ ...r, id: r.month }))} columns={cols} /></Card>
          <Notice>{data.basis}</Notice>
        </>)}
    </div>
  );
}
