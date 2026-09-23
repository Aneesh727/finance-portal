'use client';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useApi } from '@/ui/hooks';
import { Badge, Button, Card, CardHeader, DL, ErrorBox, HealthDot, Loading, PageHeader, SimpleTable, Stat, StatusBadge, LinkButton } from '@/ui/kit';
import { dmy, inr0, pct } from '@/ui/format';
import { useSession } from '@/ui/session';
import { Attachments } from '@/components/attachments';
import { CrudForm, type CrudConfig } from '@/components/crud';

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export default function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { can, meta } = useSession();
  const { data, error, reload } = useApi<any>(`/api/clients/${id}`);
  const [edit, setEdit] = useState(false);
  if (error) return <div className="mx-auto max-w-md pt-16 text-center"><ErrorBox error={error} /><Button className="mt-4" onClick={() => router.push('/clients')}>Back to clients</Button></div>;
  if (!data) return <Loading />;
  const c = data.client; const s = data.stats; const seeMoney = can('profit.view');
  const cfg: CrudConfig = {
    noun: 'client', plural: 'clients', url: '/api/clients', manage: 'clients.manage', view: 'clients.view', versioned: true, nameKey: 'companyName', searchPlaceholder: '', emptyHint: '', columns: [],
    fields: [
      { key: 'companyName', label: 'Company name', required: true, maxLength: 150, wide: true }, { key: 'contactPerson', label: 'Contact person' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'phone', label: 'Phone', type: 'tel', maxLength: 40 }, { key: 'website', label: 'Website' },
      { key: 'industry', label: 'Industry' }, { key: 'gstin', label: 'GSTIN', upper: true, maxLength: 15, pattern: GSTIN, patternMsg: 'Enter a valid 15-character GSTIN' }, { key: 'address', label: 'Address', type: 'textarea' }, { key: 'country', label: 'Country', required: true },
      { key: 'currency', label: 'Billing currency', type: 'select', required: true, options: (meta?.currencies ?? ['INR']).map((x) => ({ value: x, label: x })) }, { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  };
  return (
    <>
      <PageHeader back={{ href: '/clients', label: 'Clients' }} title={<span className="flex items-center gap-2">{c.companyName}{c.archivedAt && <Badge>Archived</Badge>}{c.isDemo && <Badge tone="purple">Demo</Badge>}</span>} sub={[c.industry, c.country].filter(Boolean).join(' · ')}
        actions={<>{can('clients.manage') && !c.archivedAt && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>Edit</Button>}{can('projects.create') && !c.archivedAt && <LinkButton href="/projects/new" variant="primary" icon={<Plus className="h-4 w-4" />}>New project</LinkButton>}</>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Projects" value={s?.totalProjects ?? 0} sub={`${s?.activeProjects ?? 0} active · ${s?.completedProjects ?? 0} completed`} />
        {seeMoney && <><Stat label="Revenue" value={inr0(s?.revenue)} sub={`Retainer revenue ${inr0(s?.retainerRevenue)}`} /><Stat label="Profit" value={inr0(s?.profit)} tone={s?.profit < 0 ? 'bad' : 'good'} sub={`Average margin ${pct(s?.avgMarginPct)}`} /><Stat label="Outstanding" value={inr0(s?.outstanding)} tone={s?.outstanding > 0 ? 'warn' : 'neutral'} /></>}
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1"><CardHeader title="Contact" /><DL items={[['Contact', c.contactPerson], ['Email', c.email], ['Phone', c.phone], ['Website', c.website], ['GSTIN', c.gstin && <span key="g" className="font-mono text-xs">{c.gstin}</span>], ['State code', c.stateCode], ['Address', c.address], ['Currency', c.currency], ['Notes', c.notes]]} /></Card>
        <Card pad={false} className="lg:col-span-2"><div className="p-4 pb-0"><CardHeader title="Projects" /></div>
          <SimpleTable rows={data.projects} onRow={(r) => router.push(`/projects/${r.id}`)} empty={<p className="p-8 text-center text-sm text-ink-500">No projects for this client yet.</p>} columns={[
            { key: 'n', label: 'Project', render: (r: any) => <span className="font-medium text-ink-900">{r.name}<span className="block text-xs font-normal text-ink-500">{r.code}</span></span> },
            { key: 's', label: 'Status', render: (r: any) => <StatusBadge status={r.status} /> }, { key: 'h', label: 'Health', render: (r: any) => <HealthDot status={r.health.status} /> },
            ...(seeMoney ? [{ key: 'v', label: 'Value', align: 'right' as const, render: (r: any) => inr0(r.revenue?.revenue, r.currency) }, { key: 'p', label: 'Margin', align: 'right' as const, render: (r: any) => pct(r.profit?.grossMarginPct) }] : []),
            { key: 'e', label: 'Ends', render: (r: any) => dmy(r.endDate) },
          ]} /></Card>
      </div>
      <Attachments entityType="CLIENT" entityId={id} canWrite={can('clients.manage')} />
      {edit && <CrudForm cfg={cfg} row={c} open={edit} onClose={() => setEdit(false)} onSaved={reload} />}
    </>
  );
}
