'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge, PageHeader } from '@/ui/kit';
import { inr0, pct } from '@/ui/format';
import { useSession } from '@/ui/session';
import { Guard } from '@/components/guard';
import { CrudPage, type CrudConfig } from '@/components/crud';

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export default function ClientsPage() { return <Guard any={['clients.view']}><Suspense><Clients /></Suspense></Guard>; }
function Clients() {
  const router = useRouter(); const sp = useSearchParams();
  const { can, meta } = useSession();
  const money = can('profit.view');
  const cfg: CrudConfig = {
    noun: 'client', plural: 'clients', url: '/api/clients', exportDataset: 'clients', manage: 'clients.manage', view: 'clients.view', versioned: true, nameKey: 'companyName', searchPlaceholder: 'Search company, contact or email…', emptyHint: 'Add your first client to start creating projects.', initialSearch: sp.get('q') ?? undefined,
    onRow: (r) => router.push(`/clients/${r.id}`),
    fields: [
      { key: 'companyName', label: 'Company name', required: true, maxLength: 150, wide: true },
      { key: 'contactPerson', label: 'Contact person' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'phone', label: 'Phone', type: 'tel', maxLength: 40 }, { key: 'website', label: 'Website' },
      { key: 'industry', label: 'Industry' }, { key: 'gstin', label: 'GSTIN', upper: true, maxLength: 15, pattern: GSTIN, patternMsg: 'Enter a valid 15-character GSTIN', hint: 'Sets CGST/SGST vs IGST on invoices.' },
      { key: 'address', label: 'Address', type: 'textarea' }, { key: 'country', label: 'Country', default: 'India', required: true },
      { key: 'currency', label: 'Billing currency', type: 'select', required: true, default: meta?.company?.baseCurrency ?? 'INR', options: (meta?.currencies ?? ['INR']).map((c) => ({ value: c, label: c })) },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    columns: [
      { key: 'name', label: 'Client', sort: 'name', render: (r) => <span><span className="font-medium text-ink-900">{r.companyName}</span>{r.isDemo && <Badge tone="purple" className="ml-2">Demo</Badge>}{r.archivedAt && <Badge className="ml-2">Archived</Badge>}<span className="block text-xs text-ink-500">{r.contactPerson}{r.email ? ` · ${r.email}` : ''}</span></span> },
      { key: 'industry', label: 'Industry', sort: 'industry', hideBelow: 'md' },
      { key: 'projects', label: 'Projects', align: 'right', render: (r) => r.stats ? `${r.stats.activeProjects} active / ${r.stats.totalProjects}` : '—' },
      ...(money ? [
        { key: 'revenue', label: 'Revenue', align: 'right' as const, hideBelow: 'md' as const, render: (r: any) => inr0(r.stats?.revenue) },
        { key: 'margin', label: 'Avg margin', align: 'right' as const, hideBelow: 'lg' as const, render: (r: any) => pct(r.stats?.avgMarginPct) },
        { key: 'out', label: 'Outstanding', align: 'right' as const, render: (r: any) => <span className={r.stats?.outstanding > 0 ? 'text-ink-900' : 'text-ink-400'}>{inr0(r.stats?.outstanding)}</span> },
      ] : []),
    ],
  };
  return (<><PageHeader title="Clients" sub="Companies you bill, with lifetime revenue, margin and outstanding balance" /><CrudPage cfg={cfg} /></>);
}
