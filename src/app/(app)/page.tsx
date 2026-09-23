'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Banknote, CalendarClock, ClipboardCheck, PiggyBank, TrendingUp, Wallet } from 'lucide-react';
import { useApi } from '@/ui/hooks';
import { qs } from '@/ui/api';
import { Card, CardHeader, Empty, ErrorBox, Field, Input, Loading, PageHeader, ProgressBar, SimpleTable, Stat, StatusBadge, HealthDot, Badge, Button } from '@/ui/kit';
import { dmy, inr, inr0, pct, today } from '@/ui/format';
import { MoneyBars, MoneyDonut, MoneyLines } from '@/components/charts';
import { Guard } from '@/components/guard';
import { useSession } from '@/ui/session';

function fyStart(fyMonth: number) {
  const t = today(); const y = Number(t.slice(0, 4)); const m = Number(t.slice(5, 7));
  const sy = m >= fyMonth ? y : y - 1;
  return `${sy}-${String(fyMonth).padStart(2, '0')}-01`;
}
const monthsAgo = (n: number) => { const t = today(); const d = new Date(`${t.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 10); };

export default function DashboardPage() {
  const { me } = useSession();
  return <Guard any={['dashboard.view']}><Dashboard fy={me.company?.fyStartMonth ?? 4} /></Guard>;
}

function Dashboard({ fy }: { fy: number }) {
  const { can } = useSession();
  const [range, setRange] = useState<{ from?: string; to?: string; label: string }>({ label: '12m' });
  const [custom, setCustom] = useState({ from: '', to: '' });
  const { data: d, error, loading, reload } = useApi<any>(`/api/dashboard${qs({ from: range.from, to: range.to })}`);
  const presets = useMemo(() => [
    { label: 'This FY', from: fyStart(fy), to: today() }, { label: '6 months', from: monthsAgo(5), to: today() }, { label: '12 months', from: monthsAgo(11), to: today() },
  ], [fy]);
  const k = d?.kpis;
  return (
    <>
      <PageHeader title="Dashboard" sub="Portfolio health, profitability and cash at a glance" actions={<Button size="sm" onClick={reload}>Refresh</Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-2 no-print">
        {presets.map((p) => <Button key={p.label} size="sm" variant={range.label === p.label ? 'primary' : 'secondary'} onClick={() => setRange(p)}>{p.label}</Button>)}
        <Field label="From"><Input type="date" className="h-8 w-40" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></Field>
        <Field label="To"><Input type="date" className="h-8 w-40" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></Field>
        <Button size="sm" disabled={!custom.from || !custom.to || custom.from > custom.to} onClick={() => setRange({ label: 'custom', from: custom.from, to: custom.to })}>Apply</Button>
      </div>
      <ErrorBox error={error} />
      {!d ? (error ? null : <Loading />) : (
        <div className={loading ? 'opacity-60 transition-opacity' : ''}>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {k.revenue !== undefined && <Stat label="Revenue (invoiced, portfolio)" value={inr0(k.revenue)} sub={`Collected ${inr0(k.received)} · ${pct(k.collectionPct)}`} icon={<TrendingUp className="h-4 w-4" />} />}
            {k.cost !== undefined && <Stat label="Project cost" value={inr0(k.cost)} sub={k.budget !== undefined ? `Budget ${inr0(k.budget)} · ${pct(k.budgetUsedPct)} used` : undefined} icon={<Wallet className="h-4 w-4" />} tone={k.budgetUsedPct > 100 ? 'bad' : undefined} />}
            {k.grossProfit !== undefined && <Stat label="Gross profit" value={inr0(k.grossProfit)} sub={`Margin ${pct(k.marginPct)} · projected ${pct(k.projectedMarginPct)}`} tone={k.grossProfit < 0 ? 'bad' : 'good'} icon={<PiggyBank className="h-4 w-4" />} />}
            {k.outstanding !== undefined && <Stat label="Outstanding receivables" value={inr0(k.outstanding)} sub={<span className={k.overdue > 0 ? 'text-red-600' : ''}>Overdue {inr0(k.overdue)}</span>} tone={k.overdue > 0 ? 'warn' : 'neutral'} icon={<Banknote className="h-4 w-4" />} href="/reports?tab=receivables" />}
            <Stat label="Active projects" value={d.counts.active} sub={`${d.counts.total} total · ${d.counts.overBudget} over budget`} href="/projects" icon={<CalendarClock className="h-4 w-4" />} />
            {k.cashPosition !== undefined && <Stat label="Cash position (received − paid out)" value={inr0(k.cashPosition)} tone={k.cashPosition < 0 ? 'bad' : 'good'} sub="Cash in from clients less project costs paid" />}
            {d.period && <Stat label={`Net profit (${dmy(d.range.from)} – ${dmy(d.range.to)})`} value={inr0(d.period.netProfit)} tone={d.period.netProfit < 0 ? 'bad' : 'good'} sub={`After ${inr0(d.period.overhead)} unallocated overhead`} />}
            <Stat label="Pending approvals" value={d.counts.pendingApprovals} href="/approvals" icon={<ClipboardCheck className="h-4 w-4" />} tone={d.counts.pendingApprovals ? 'warn' : 'neutral'} />
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            {d.period && (
              <Card className="lg:col-span-2"><CardHeader title="Revenue, cost and profit" sub="Monthly, invoices issued vs. costs incurred (activity basis)" />
                <MoneyLines area data={d.series} lines={[{ key: 'revenue', name: 'Revenue', color: '#4f46e5' }, { key: 'cost', name: 'Direct cost', color: '#f59e0b' }, { key: 'profit', name: 'Profit', color: '#10b981' }]} /></Card>
            )}
            {d.costByCategory?.length > 0 && <Card className={d.period ? '' : 'lg:col-span-3'}><CardHeader title="Cost by category" /><MoneyDonut data={d.costByCategory} /></Card>}
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            {k.received !== undefined && <Card className="lg:col-span-2"><CardHeader title="Cash received" sub="Payments received net of refunds, by month" /><MoneyBars data={d.series} x="month" bars={[{ key: 'cash', name: 'Cash received', color: '#0ea5e9' }]} height={220} /></Card>}
            {d.byService?.length > 0 && <Card><CardHeader title="Profit by service" /><MoneyBars layout="vertical" data={d.byService.map((s: any) => ({ ...s, service: s.service }))} x="service" bars={[{ key: 'profit', name: 'Profit', color: '#10b981' }]} height={220} /></Card>}
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card pad={false}><div className="p-4 pb-0"><CardHeader title="Projects needing attention" sub={can('profit.view') ? 'Over budget, low margin, or late payments' : 'Projects at or over their budget'} /></div>
              <SimpleTable rows={d.atRisk ?? []} empty={<Empty title="Nothing at risk" hint="No open project is over budget, low on margin or paying late." />} columns={[
                { key: 'p', label: 'Project', render: (r: any) => <Link className="link" href={`/projects/${r.id}`}>{r.code} · {r.name}<span className="block text-xs text-ink-500">{r.client}</span></Link> },
                { key: 'h', label: 'Health', render: (r: any) => <HealthDot status={r.health} /> },
                { key: 'w', label: 'Why', render: (r: any) => <span className="whitespace-normal text-xs text-ink-600">{(r.reasons ?? []).join(' · ') || '—'}</span> },
              ]} /></Card>
            {can('profit.view') && <Card pad={false}><div className="p-4 pb-0"><CardHeader title="Overdue invoices" right={<Link className="link text-xs" href="/billing?status=OVERDUE">All</Link>} /></div>
              <SimpleTable rows={d.overdueInvoices ?? []} empty={<Empty title="No overdue invoices" />} columns={[
                { key: 'n', label: 'Invoice', render: (r: any) => <Link className="link" href={`/billing?q=${encodeURIComponent(r.number)}`}>{r.number}<span className="block text-xs text-ink-500">{r.client}</span></Link> },
                { key: 'd', label: 'Due', render: (r: any) => <span className="text-red-600">{dmy(r.due_date ?? r.dueDate)}</span> },
                { key: 'o', label: 'Outstanding', align: 'right', render: (r: any) => inr(r.outstanding) },
              ]} /></Card>}
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            {can('profit.view') && <RankCard title="Most profitable" rows={d.topProfitable} field="profit" />}
            {can('profit.view') && <RankCard title="Lowest margin" rows={d.lowestMargin} field="marginPct" />}
            {can('costs.view') && <RankCard title="Over budget" rows={d.overBudget} field="overBy" />}
          </div>

          {d.renewals?.length > 0 && (
            <Card pad={false}><div className="p-4 pb-0"><CardHeader title="Retainer renewals due" /></div>
              <SimpleTable rows={d.renewals} columns={[
                { key: 'p', label: 'Retainer', render: (r: any) => <Link className="link" href={`/retainers/${r.id}`}>{r.code} · {r.name}</Link> },
                { key: 'e', label: 'Ends', render: (r: any) => dmy(r.endDate ?? r.end_date) },
                ...(can('profit.view') ? [{ key: 'f', label: 'Monthly fee', align: 'right' as const, render: (r: any) => inr(r.monthlyFee) }] : []),
              ]} /></Card>
          )}
        </div>
      )}
      <p className="mt-4 text-xs text-ink-400 no-print">Figures respect your permissions and project access, in the company base currency.</p>
    </>
  );
}

function RankCard({ title, rows, field }: { title: string; rows?: any[]; field: 'profit' | 'marginPct' | 'overBy' }) {
  return (
    <Card pad={false}><div className="p-4 pb-2"><CardHeader title={title} /></div>
      {!rows?.length ? <Empty title="No data yet" /> : (
        <ul className="divide-y divide-ink-100">
          {rows.slice(0, 5).map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1"><Link className="block truncate text-sm font-medium text-ink-900 hover:underline" href={`/projects/${r.id}`}>{r.name}</Link><div className="flex items-center gap-2 text-xs text-ink-500"><span className="truncate">{r.client}</span><StatusBadge status={r.status} /></div></div>
              <div className="text-right text-sm tabular-nums">
                {field === 'profit' && <span className="text-emerald-700">{inr0(r.profit)}</span>}
                {field === 'marginPct' && <span className={r.marginPct < 0 ? 'text-red-600' : ''}>{pct(r.marginPct)}</span>}
                {field === 'overBy' && <><span className="text-red-600">+{inr0(r.overBy)}</span>{r.budgetUtilizationPct != null && <div className="w-20"><ProgressBar pct={r.budgetUtilizationPct} /></div>}</>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
void Badge;
