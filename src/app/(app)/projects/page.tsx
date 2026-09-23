'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Badge, DataTable, HealthDot, LinkButton, PageHeader, ProgressBar, Select, StatusBadge, type Column } from '@/ui/kit';
import { dmy, inr0, pct, title } from '@/ui/format';
import { useSession } from '@/ui/session';
import { Guard } from '@/components/guard';
import { ExportMenu } from '@/components/export-menu';
import { ClientSelect, CategorySelect } from '@/components/pickers';

const STATUSES = ['LEAD', 'PROPOSAL', 'NEGOTIATION', 'WON', 'ONBOARDING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'LOST'];
const TYPES = ['ONE_TIME', 'RETAINER', 'MILESTONE', 'HOURLY', 'FIXED_RECURRING'];

export default function ProjectsPage() { return <Guard any={['projects.view']}><Suspense><Projects /></Suspense></Guard>; }

function Projects() {
  const router = useRouter();
  const sp = useSearchParams();
  const { can } = useSession();
  const [f, setF] = useState({ status: sp.get('status') ?? '', type: '', health: sp.get('health') ?? '', clientId: '', serviceId: '', archived: '0', overdue: sp.get('overdue') ?? '' });
  const showMoney = can('profit.view');
  const showCost = can('costs.view');
  const cols: Column<any>[] = [
    { key: 'code', label: 'Project', sort: 'code', className: 'min-w-[15rem]', render: (r) => <span><span className="font-medium text-ink-900">{r.name}</span>{r.archived && <Badge className="ml-2">Archived</Badge>}{r.isDemo && <Badge tone="purple" className="ml-2">Demo</Badge>}<span className="block text-xs text-ink-500">{r.code} · {r.client?.name}</span></span> },
    { key: 'status', label: 'Status', sort: 'status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'service', label: 'Service', hideBelow: 'lg', render: (r) => <span className="text-xs">{r.service?.name}<span className="block text-ink-400">{title(r.type)}</span></span> },
    { key: 'health', label: 'Health', hideBelow: 'md', render: (r) => <HealthDot status={r.health.status} /> },
    ...(showMoney ? [
      { key: 'revenue', label: 'Contract value', sort: 'revenue', align: 'right' as const, render: (r: any) => inr0(r.revenue?.revenue, r.currency) },
      { key: 'profit', label: 'Profit', sort: 'profit', align: 'right' as const, hideBelow: 'md' as const, render: (r: any) => <span className={r.profit?.actual < 0 ? 'text-red-600' : ''}>{inr0(r.profit?.actual, r.currency)}<span className="block text-xs text-ink-400">{pct(r.profit?.grossMarginPct)}</span></span> },
      { key: 'out', label: 'Outstanding', sort: 'outstanding', align: 'right' as const, hideBelow: 'lg' as const, render: (r: any) => <span className={r.receivables?.overdue > 0 ? 'text-red-600' : ''}>{inr0(r.receivables?.outstanding, r.currency)}</span> },
    ] : []),
    ...(showCost ? [{ key: 'budget', label: 'Budget used', sort: 'budgetUsed', hideBelow: 'md' as const, className: 'min-w-[8rem]', render: (r: any) => r.budget?.budget > 0 ? <div><div className="mb-1 text-xs tabular-nums text-ink-600">{pct(r.budget.utilizationPct, 0)} of {inr0(r.budget.budget, r.currency)}</div><ProgressBar pct={r.budget.utilizationPct} /></div> : <span className="text-xs text-ink-400">No budget</span> }] : []),
    { key: 'end', label: 'End date', sort: 'endDate', hideBelow: 'lg', render: (r) => dmy(r.endDate) },
  ];
  return (
    <>
      <PageHeader title="Projects" sub="Every project with live profitability, budget and receivables" actions={<>
        <ExportMenu dataset="projects" params={{ status: f.status || undefined }} />
        {can('projects.create') && <LinkButton href="/projects/new" variant="primary" icon={<Plus className="h-4 w-4" />}>New project</LinkButton>}
      </>} />
      <DataTable<any> url="/api/projects" params={f} columns={cols} onRow={(r) => router.push(`/projects/${r.id}`)} defaultSort="createdAt" searchPlaceholder="Search name, code or client…" emptyTitle="No projects match" emptyHint="Change the filters or create a new project."
        emptyAction={can('projects.create') ? <LinkButton href="/projects/new" variant="primary">New project</LinkButton> : undefined}
        filters={<>
          <Select className="w-40" aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select>
          <Select className="w-36" aria-label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">All types</option>{TYPES.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select>
          <Select className="w-36" aria-label="Health" value={f.health} onChange={(e) => setF({ ...f, health: e.target.value })}><option value="">Any health</option><option value="HEALTHY">Healthy</option><option value="ATTENTION">Attention</option><option value="CRITICAL">Critical</option></Select>
          {can('clients.view') && <div className="w-44"><ClientSelect value={f.clientId} onChange={(x) => setF({ ...f, clientId: x })} placeholder="All clients" /></div>}
          <div className="w-44"><CategorySelect kind="service" allowEmpty placeholder="All services" value={f.serviceId} onChange={(x) => setF({ ...f, serviceId: x })} /></div>
          <Select className="w-32" aria-label="Archived" value={f.archived} onChange={(e) => setF({ ...f, archived: e.target.value })}><option value="0">Active</option><option value="1">Archived</option><option value="all">All</option></Select>
        </>} />
    </>
  );
}
