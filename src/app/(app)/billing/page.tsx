'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader, Tabs } from '@/ui/kit';
import { Guard } from '@/components/guard';
import { InvoicesTable, PaymentsTable } from '@/components/billing-tables';

export default function BillingPage() { return <Guard any={['payments.view']}><Suspense><Billing /></Suspense></Guard>; }
function Billing() {
  const sp = useSearchParams();
  const [tab, setTab] = useState<'invoices' | 'payments'>('invoices');
  return (
    <>
      <PageHeader title="Invoices & payments" sub="Billing, receivables and cash received across all projects" />
      <Tabs tabs={[{ id: 'invoices', label: 'Invoices' }, { id: 'payments', label: 'Payments' }]} value={tab} onChange={setTab} />
      {tab === 'invoices' ? <InvoicesTable initialStatus={sp.get('status') ?? ''} initialQ={sp.get('q') ?? ''} /> : <PaymentsTable />}
    </>
  );
}
