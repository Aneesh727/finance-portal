'use client';
import { PageHeader } from '@/ui/kit';
import { Guard } from '@/components/guard';
import { CostsTable } from '@/components/costs-table';

export default function CostsPage() {
  return (
    <Guard any={['costs.view']}>
      <PageHeader title="Project costs" sub="Every cost booked against a project — estimated, committed and actual" />
      <CostsTable />
    </Guard>
  );
}
