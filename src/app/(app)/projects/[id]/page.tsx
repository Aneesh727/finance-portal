'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Archive, ArrowRightLeft, Pencil, RotateCcw } from 'lucide-react';
import { api } from '@/ui/api';
import { useApi } from '@/ui/hooks';
import { Badge, Button, Card, CardHeader, DL, ErrorBox, HealthDot, Loading, Notice, PageHeader, ProgressBar, Stat, StatusBadge, Tabs, useConfirm, useToast } from '@/ui/kit';
import { dmy, inr, inr0, pct, title } from '@/ui/format';
import { useSession } from '@/ui/session';
import { MoneyBars, MoneyDonut, MoneyLines } from '@/components/charts';
import { CostsTable } from '@/components/costs-table';
import { InvoicesTable, PaymentsTable } from '@/components/billing-tables';
import { Attachments } from '@/components/attachments';
import { MilestonesTab } from '@/components/project/milestones-tab';
import { ResourcesTab } from '@/components/project/resources-tab';
import { AdjustmentsCard, BudgetTab } from '@/components/project/budget-tab';
import { HistoryTab } from '@/components/project/history-tab';
import { ChangeStatus, EditProject } from '@/components/project/edit-project';
import { PaymentForm } from '@/components/forms/billing-forms';
import { InvoiceForm } from '@/components/forms/billing-forms';

type TabId = 'overview' | 'costs' | 'billing' | 'resources' | 'milestones' | 'budget' | 'files' | 'history';

export default function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const sp = useSearchParams();
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<TabId>((sp.get('tab') as TabId) ?? 'overview');
  const { data, error, loading, reload } = useApi<any>(`/api/projects/${id}`);
  const [edit, setEdit] = useState(false);
  const [status, setStatus] = useState(false);
  const [billTab, setBillTab] = useState<'invoices' | 'payments'>('invoices');
  const [quickPay, setQuickPay] = useState(false);
  const [quickInv, setQuickInv] = useState(false);
  useEffect(() => { const t = sp.get('tab'); if (t) setTab(t as TabId); }, [sp]);

  if (error) return <div className="mx-auto max-w-md pt-16 text-center"><ErrorBox error={error} /><Button className="mt-4" onClick={() => router.push('/projects')}>Back to projects</Button></div>;
  if (!data) return <Loading />;
  const p = data.project; const fin = data.financials;
  const cur: string = p.currency;
  const seeMoney = can('profit.view'); const seeCost = can('costs.view');
  const canEdit = can('projects.edit') && !p.archivedAt && p.status !== 'CANCELLED';
  const archive = async () => {
    const c = await confirm({ title: p.archivedAt ? 'Restore this project?' : 'Archive this project?', message: p.archivedAt ? 'It will appear in lists and reports again.' : 'It will be hidden from lists and excluded from dashboards. Nothing is deleted and it can be restored.', confirmLabel: p.archivedAt ? 'Restore' : 'Archive', danger: !p.archivedAt });
    if (!c.ok) return;
    try { await api.post(`/api/projects/${id}/${p.archivedAt ? 'restore' : 'archive'}`, {}); toast.success(p.archivedAt ? 'Project restored' : 'Project archived'); reload(); } catch (e) { toast.fail(e); }
  };
  const openAdj = data.adjustments ?? [];
  return (
    <>
      <PageHeader back={{ href: '/projects', label: 'Projects' }}
        title={<span className="flex flex-wrap items-center gap-2">{p.name}<StatusBadge status={p.status} />{p.archivedAt && <Badge>Archived</Badge>}{p.isDemo && <Badge tone="purple">Demo</Badge>}</span>}
        sub={<span>{p.code} · <Link className="link" href={`/clients/${p.clientId}`}>{fin.client.name}</Link> · {fin.service.name} · {title(p.type)} · <HealthDot status={fin.health.status} /></span>}
        actions={<>
          {canEdit && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>Edit</Button>}
          {can('projects.edit') && !p.archivedAt && <Button icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setStatus(true)}>Status</Button>}
          {can('projects.archive') && <Button icon={p.archivedAt ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />} onClick={archive}>{p.archivedAt ? 'Restore' : 'Archive'}</Button>}
        </>} />
      {fin.health.reasons.length > 0 && fin.health.status !== 'HEALTHY' && <Notice tone={fin.health.status === 'CRITICAL' ? 'danger' : 'warn'} className="mb-4"><b>{title(fin.health.status)}:</b> {fin.health.reasons.join(' · ')}</Notice>}
      {p.status === 'CANCELLED' && <Notice tone="warn" className="mb-4">This project is cancelled. Revenue counts only what was already invoiced; new invoices are blocked. Costs can still be recorded for wind-down.</Notice>}

      <Tabs<TabId> value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview' }, { id: 'costs', label: 'Costs', hidden: !seeCost }, { id: 'billing', label: 'Billing', hidden: !can('payments.view') },
        { id: 'resources', label: 'Resources', count: data.resources.length, hidden: !can('resources.view') && !seeCost }, { id: 'milestones', label: 'Milestones', count: data.milestones.length },
        { id: 'budget', label: 'Budget', hidden: !seeCost }, { id: 'files', label: 'Files' }, { id: 'history', label: 'History', hidden: !can('audit.view') && !seeCost },
      ]} />

      {tab === 'overview' && (
        <div className={loading ? 'opacity-70' : ''}>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {seeMoney && <Stat label="Contract value (ex-tax)" value={inr0(fin.revenue?.revenue, cur)} sub={`Client pays ${inr0(fin.revenue?.total, cur)} incl. tax`} />}
            {seeCost && <Stat label="Actual cost" value={inr0(fin.cost?.actual, cur)} sub={`Committed ${inr0(fin.cost?.committed, cur)} · pending approval ${inr0(fin.cost?.pendingApproval, cur)}`} />}
            {seeMoney && <Stat label="Actual profit" value={inr0(fin.profit?.actual, cur)} tone={fin.profit?.actual < 0 ? 'bad' : 'good'} sub={`Margin ${pct(fin.profit?.grossMarginPct)} · projected ${pct(fin.profit?.projectedMarginPct)}`} />}
            {seeMoney && <Stat label="Projected profit" value={inr0(fin.profit?.projected, cur)} tone={fin.profit?.projected < 0 ? 'bad' : 'neutral'} sub={`If all planned costs land (${inr0(fin.cost?.projected, cur)})`} />}
            {seeMoney && <Stat label="Invoiced" value={inr0(fin.receivables?.invoiced, cur)} sub={`Received ${inr0(fin.receivables?.received, cur)} · TDS ${inr0(fin.receivables?.tds, cur)}`} />}
            {seeMoney && <Stat label="Outstanding" value={inr0(fin.receivables?.outstanding, cur)} tone={fin.receivables?.overdue > 0 ? 'bad' : 'neutral'} sub={fin.receivables?.overdue > 0 ? `${inr0(fin.receivables.overdue)} overdue` : `Upcoming ${inr0(fin.receivables?.upcoming, cur)}`} />}
            {seeMoney && <Stat label="Cash position" value={inr0(fin.cash?.cashPosition, cur)} tone={fin.cash?.cashPosition < 0 ? 'bad' : 'good'} sub="Received (net of TDS) minus costs paid" />}
            {seeCost && fin.budget && <Stat label="Budget used" value={fin.budget.budget > 0 ? pct(fin.budget.utilizationPct) : '—'} tone={fin.budget.state === 'EXCEEDED' ? 'bad' : fin.budget.state === 'WARNING' ? 'warn' : 'neutral'} sub={fin.budget.budget > 0 ? `${inr0(fin.budget.used, cur)} of ${inr0(fin.budget.budget, cur)}` : 'No budget set'} />}
          </div>
          {seeMoney && fin.receivables?.creditBalance > 0 && <Notice tone="info" className="mb-4">The client has paid {inr(fin.receivables.creditBalance, cur)} more than invoiced — held as a credit balance.</Notice>}
          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            {seeCost && <Card className="lg:col-span-2"><CardHeader title="Cost by category" sub="Actual vs. estimated spend" />
              {data.costByCategory.length ? <MoneyBars data={data.costByCategory} x="name" bars={[{ key: 'estimated', name: 'Estimated', color: '#c4cad6' }, { key: 'actual', name: 'Actual', color: '#4f46e5' }, { key: 'committed', name: 'Committed', color: '#f59e0b' }]} /> : <p className="py-10 text-center text-sm text-ink-500">No costs recorded yet.</p>}</Card>}
            {seeCost && data.costByCategory.length > 0 && <Card><CardHeader title="Where the money went" /><MoneyDonut height={170} data={data.costByCategory.filter((c: any) => c.actual > 0).map((c: any) => ({ name: c.name, value: c.actual }))} /></Card>}
          </div>
          {seeCost && data.costTrend.length > 1 && <Card className="mb-4"><CardHeader title="Cost trend" /><MoneyLines area height={200} data={data.costTrend} lines={[{ key: 'actual', name: 'Actual cost' }]} /></Card>}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader title="Details" />
              <DL items={[
                ['Client', <Link key="c" className="link" href={`/clients/${p.clientId}`}>{fin.client.name}</Link>], ['Manager', fin.manager?.name], ['Team', data.members.map((m: any) => m.name).join(', ') || '—'],
                ['Start – End', `${dmy(p.startDate)} – ${dmy(p.endDate)}`], ['Contract date', dmy(p.contractDate)], ['Priority', title(p.priority)], ['Currency', cur + (Number(p.fxRateToBase) !== 1 ? ` (1 = ${Number(p.fxRateToBase)} base)` : '')],
                ...(p.sellingPrice !== undefined ? [['Tax', p.taxMode === 'NONE' ? 'None' : `${Number(p.taxRatePct)}% ${p.taxMode.toLowerCase()}`] as [string, string], ['Payment terms', p.paymentTerms ?? '—'] as [string, string]] : []),
                ['Description', p.description], ['Notes', p.notes],
              ]} /></Card>
            {seeMoney && <Card><CardHeader title="Profit summary" />
              <dl className="space-y-1.5 text-sm">
                <Line k="Contract value" v={inr(fin.revenue?.revenue, cur)} /><Line k="Actual cost" v={`− ${inr(fin.cost?.actual, cur)}`} /><Line k="Actual profit" v={inr(fin.profit?.actual, cur)} bold />
                <Line k="Planned (estimated) profit" v={`${inr(fin.profit?.estimated, cur)} · ${pct(fin.profit?.estimatedMarginPct)}`} />
                <Line k="Projected profit" v={`${inr(fin.profit?.projected, cur)} · ${pct(fin.profit?.projectedMarginPct)}`} />
                {p.status === 'WON' || p.status === 'LEAD' ? <p className="pt-2 text-xs text-ink-500">Work has not started, so no cost has been booked yet — actual margin will look like 100% until costs arrive. Use projected margin for planning.</p> : null}
              </dl>
              {p.type !== 'HOURLY' && <div className="mt-4"><ProgressBar pct={fin.receivables?.invoiced && fin.revenue?.total ? (fin.receivables.received / fin.revenue.total) * 100 : 0} tone="good" /><p className="mt-1 text-xs text-ink-500">{pct(fin.receivables?.collectionPct)} of invoiced amount collected</p></div>}
              {can('payments.manage') && !p.archivedAt && <div className="mt-4 flex gap-2"><Button size="sm" onClick={() => setQuickInv(true)}>New invoice</Button><Button size="sm" onClick={() => setQuickPay(true)}>Record payment</Button></div>}
            </Card>}
          </div>
        </div>
      )}
      {tab === 'costs' && seeCost && <CostsTable projectId={id} onChange={reload} />}
      {tab === 'billing' && can('payments.view') && (
        <div className="space-y-4">
          <div className="flex gap-2"><Button size="sm" variant={billTab === 'invoices' ? 'primary' : 'secondary'} onClick={() => setBillTab('invoices')}>Invoices</Button><Button size="sm" variant={billTab === 'payments' ? 'primary' : 'secondary'} onClick={() => setBillTab('payments')}>Payments</Button></div>
          {billTab === 'invoices' ? <InvoicesTable projectId={id} /> : <PaymentsTable projectId={id} />}
          {seeMoney && <AdjustmentsCard projectId={id} rows={openAdj} currency={cur} canEdit={can('payments.manage') && !p.archivedAt} onChange={reload} />}
          {seeMoney && data.invoiceCounts.length > 0 && <p className="text-xs text-ink-500">Scheduled instalments appear in Invoices with status “Scheduled” until you issue them.</p>}
        </div>)}
      {tab === 'resources' && <ResourcesTab projectId={id} rows={data.resources} canEdit={canEdit} canSeeMoney={seeCost} currency={cur} onChange={reload} />}
      {tab === 'milestones' && <MilestonesTab projectId={id} milestones={data.milestones} canEdit={canEdit} canSeeMoney={seeMoney} currency={cur} onChange={reload} />}
      {tab === 'budget' && seeCost && <BudgetTab projectId={id} fin={fin} budgetRaw={p.budget ?? '0'} currency={cur} canEdit={can('budgets.edit') || can('projects.edit')} categoryBudgets={data.categoryBudgets} onChange={reload} />}
      {tab === 'files' && <Attachments entityType="PROJECT" entityId={id} canWrite={can('projects.edit')} />}
      {tab === 'history' && <HistoryTab projectId={id} />}

      {edit && <EditProject open={edit} onClose={() => setEdit(false)} project={p} memberIds={data.members.map((m: any) => m.id)} onSaved={reload} />}
      <ChangeStatus open={status} onClose={() => setStatus(false)} project={p} onSaved={reload} />
      <PaymentForm open={quickPay} onClose={() => setQuickPay(false)} projectId={id} onSaved={reload} />
      <InvoiceForm open={quickInv} onClose={() => setQuickInv(false)} projectId={id} onSaved={reload} />
    </>
  );
}
const Line = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => <div className="flex justify-between gap-3"><dt className="text-ink-500">{k}</dt><dd className={`tabular-nums ${bold ? 'font-semibold text-ink-900' : ''}`}>{v}</dd></div>;
