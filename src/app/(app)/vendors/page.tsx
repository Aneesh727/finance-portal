'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge, PageHeader } from '@/ui/kit';
import { Guard } from '@/components/guard';
import { CrudPage, type CrudConfig } from '@/components/crud';

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export default function VendorsPage() { return <Guard any={['resources.view']}><Suspense><Vendors /></Suspense></Guard>; }
function Vendors() {
  const sp = useSearchParams();
  const cfg: CrudConfig = {
    noun: 'vendor', plural: 'vendors', url: '/api/vendors', exportDataset: 'vendors', manage: 'resources.manage', view: 'resources.view', nameKey: 'name', searchPlaceholder: 'Search vendors…', emptyHint: 'Vendors are suppliers you pay — printers, ad platforms, hosting providers.', initialSearch: sp.get('q') ?? undefined,
    fields: [
      { key: 'name', label: 'Vendor name', required: true, maxLength: 150, wide: true }, { key: 'contactName', label: 'Contact person' }, { key: 'category', label: 'Category', maxLength: 80 },
      { key: 'email', label: 'Email', type: 'email' }, { key: 'phone', label: 'Phone', type: 'tel', maxLength: 40 },
      { key: 'gstin', label: 'GSTIN', upper: true, maxLength: 15, pattern: GSTIN, patternMsg: 'Enter a valid 15-character GSTIN' }, { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    columns: [
      { key: 'name', label: 'Vendor', sort: 'name', render: (r) => <span><span className="font-medium text-ink-900">{r.name}</span>{r.isDemo && <Badge tone="purple" className="ml-2">Demo</Badge>}{r.archivedAt && <Badge className="ml-2">Archived</Badge>}<span className="block text-xs text-ink-500">{r.contactName}</span></span> },
      { key: 'category', label: 'Category', sort: 'category' }, { key: 'email', label: 'Email', hideBelow: 'md' }, { key: 'phone', label: 'Phone', hideBelow: 'lg' }, { key: 'gstin', label: 'GSTIN', hideBelow: 'lg', className: 'font-mono text-xs' },
    ],
  };
  return (<><PageHeader title="Vendors" sub="Suppliers you pay for project and company costs" /><CrudPage cfg={cfg} /></>);
}
