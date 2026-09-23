'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge, PageHeader, Select, StatusBadge } from '@/ui/kit';
import { money, title } from '@/ui/format';
import { useSession } from '@/ui/session';
import { Guard } from '@/components/guard';
import { CrudPage, type CrudConfig } from '@/components/crud';

const TYPES = ['EMPLOYEE', 'FREELANCER', 'CONTRACTOR', 'AGENCY', 'VENDOR'];
export default function ResourcesPage() { return <Guard any={['resources.view']}><Suspense><Resources /></Suspense></Guard>; }
function Resources() {
  const sp = useSearchParams();
  const { can } = useSession();
  const rates = can('resources.manage') || can('profit.view');
  const cfg: CrudConfig = {
    noun: 'resource', plural: 'resources', url: '/api/resources', exportDataset: can('reports.export') && rates ? 'resources' : undefined, manage: 'resources.manage', view: 'resources.view', versioned: true, nameKey: 'name', searchPlaceholder: 'Search name or role…', emptyHint: 'Resources are the people, freelancers and agencies whose time you cost to projects.', initialSearch: sp.get('q') ?? undefined,
    filterDefaults: { type: '', status: '' },
    extraFilters: (f, set) => <><Select className="w-36" aria-label="Type" value={f.type} onChange={(e) => set('type', e.target.value)}><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{title(t)}</option>)}</Select><Select className="w-32" aria-label="Status" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">Any status</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></>,
    fields: [
      { key: 'name', label: 'Name', required: true, maxLength: 120 }, { key: 'role', label: 'Role / title', required: true, maxLength: 120 },
      { key: 'type', label: 'Type', type: 'select', required: true, default: 'EMPLOYEE', options: TYPES.map((t) => ({ value: t, label: title(t) })) },
      { key: 'status', label: 'Status', type: 'select', required: true, default: 'ACTIVE', options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }] },
      { key: 'monthlyCost', label: 'Monthly cost (salary / retainer)', type: 'money', showIf: () => rates, hint: 'Employees: hourly and daily cost are derived from this.' }, { key: 'hourlyCost', label: 'Hourly cost', type: 'money', showIf: () => rates },
      { key: 'dailyCost', label: 'Daily cost', type: 'money', showIf: () => rates }, { key: 'billingRate', label: 'Billing rate / hour', type: 'money', showIf: () => rates, hint: 'Used for hourly-billed projects.' },
      { key: 'email', label: 'Email', type: 'email' }, { key: 'phone', label: 'Phone', type: 'tel', maxLength: 40 }, { key: 'department', label: 'Department', maxLength: 80 },
      { key: 'startDate', label: 'Start date', type: 'date' }, { key: 'endDate', label: 'End date', type: 'date' }, { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    columns: [
      { key: 'name', label: 'Name', sort: 'name', render: (r) => <span><span className="font-medium text-ink-900">{r.name}</span>{r.isDemo && <Badge tone="purple" className="ml-2">Demo</Badge>}{r.archivedAt && <Badge className="ml-2">Archived</Badge>}<span className="block text-xs text-ink-500">{r.role}</span></span> },
      { key: 'type', label: 'Type', sort: 'type', render: (r) => title(r.type) }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ...(rates ? [{ key: 'cost', label: 'Cost rate', align: 'right' as const, render: (r: any) => (r.type === 'EMPLOYEE' && Number(r.monthlyCost) > 0 ? `${money(r.monthlyCost)}/mo` : `${money(r.hourlyCost)}/h`) }, { key: 'bill', label: 'Billing rate', align: 'right' as const, hideBelow: 'md' as const, render: (r: any) => (Number(r.billingRate) > 0 ? `${money(r.billingRate)}/h` : '—') }] : []),
      { key: 'dept', label: 'Department', hideBelow: 'lg', render: (r) => r.department ?? '—' },
    ],
  };
  return (<><PageHeader title="Resources" sub="People, freelancers and agencies you cost to projects" /><CrudPage cfg={cfg} /></>);
}
