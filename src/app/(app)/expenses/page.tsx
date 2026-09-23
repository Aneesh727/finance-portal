'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { api } from '@/ui/api';
import { Badge, Button, DataTable, Input, PageHeader, Select, StatusBadge, Tabs, useConfirm, useToast, type Column } from '@/ui/kit';
import { dmy, inr, money, title } from '@/ui/format';
import { useSession } from '@/ui/session';
import { Guard } from '@/components/guard';
import { ExpenseForm } from '@/components/expenses/expense-form';
import { AllocateExpense } from '@/components/expenses/allocate';
import { RecurringTab } from '@/components/expenses/recurring';
import { RowActions } from '@/components/row-actions';
import { CategorySelect } from '@/components/pickers';
import { ExportMenu } from '@/components/export-menu';

export default function ExpensesPage() { return <Guard any={['expenses.view']}><Suspense><Expenses /></Suspense></Guard>; }

function Expenses() {
  const sp = useSearchParams();
  const { can } = useSession();
  const toast = useToast(); const confirm = useConfirm();
  const [tab, setTab] = useState<'expenses' | 'recurring'>('expenses');
  const [f, setF] = useState({ categoryId: '', scope: '', status: '', from: '', to: '', voided: '0' });
  const [key, setKey] = useState(0);
  const [form, setForm] = useState<{ open: boolean; row?: any }>({ open: false });
  const [alloc, setAlloc] = useState<any | null>(null);
  const reload = () => setKey((k) => k + 1);
  const voidIt = async (r: any) => {
    const c = await confirm({ title: 'Void this expense?', message: `“${r.description}” will be removed from cost and overhead totals.`, danger: true, confirmLabel: 'Void expense', reason: { label: 'Reason', required: true } });
    if (!c.ok) return;
    try { await api.post(`/api/expenses/${r.id}/void`, { reason: c.reason }); toast.success('Expense voided'); reload(); } catch (e) { toast.fail(e); }
  };
  const cols: Column<any>[] = [
    { key: 'date', label: 'Date', sort: 'date', render: (r) => dmy(r.date) },
    { key: 'description', label: 'Expense', sort: 'description', className: 'min-w-[12rem]', render: (r) => <span><span className="font-medium text-ink-900">{r.description}</span>{r.archived && <Badge className="ml-2">Voided</Badge>}{r.recurringRuleId && <Badge tone="blue" className="ml-2">recurring</Badge>}<span className="block text-xs text-ink-500">{r.vendor ?? ''}{r.reference ? ` · ${r.reference}` : ''}</span></span> },
    { key: 'category', label: 'Category', sort: 'category', hideBelow: 'md' },
    { key: 'scope', label: 'Belongs to', render: (r) => r.scope === 'PROJECT' ? <Link className="link" href={`/projects/${r.projectId}`}>{r.projectCode}</Link> : r.scope === 'DEPARTMENT' ? r.department ?? 'Department' : <span className="text-ink-600">Company{Number(r.allocated) > 0 && <span className="block text-xs text-ink-400">{money(r.allocated)} allocated</span>}</span> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'amount', label: 'Amount', sort: 'amount', align: 'right', render: (r) => money(r.amount, r.currency) },
    { key: 'a', label: '', render: (r) => <RowActions actions={[
      { label: 'Edit', onClick: () => setForm({ open: true, row: r }), hidden: r.archived || !can('expenses.create') },
      { label: 'Allocate to projects', onClick: () => setAlloc(r), hidden: r.archived || r.scope === 'PROJECT' || r.status !== 'APPROVED' || !can('allocations.manage') },
      { label: 'Void', danger: true, onClick: () => voidIt(r), hidden: r.archived || !can('expenses.create') },
    ]} /> },
  ];
  return (
    <>
      <PageHeader title="Company expenses" sub="Overhead and project expenses — allocate shared costs across the projects that benefit" />
      <Tabs tabs={[{ id: 'expenses', label: 'Expenses' }, { id: 'recurring', label: 'Recurring rules' }]} value={tab} onChange={setTab} />
      {tab === 'expenses' ? (
        <DataTable<any> url="/api/expenses" params={f} reloadKey={key} columns={cols} defaultSort="date" searchPlaceholder="Search description, vendor, reference…" initialSearch={sp.get('q') ?? undefined}
          emptyTitle="No expenses yet" emptyHint="Record rent, software, travel and other spend here."
          summary={(m) => <>Approved total on this view: <b className="tabular-nums text-ink-900">{inr(m.approvedTotalMinor ?? 0)}</b> · {m.total} expense{m.total === 1 ? '' : 's'}</>}
          toolbar={<><ExportMenu dataset="expenses" params={{ from: f.from || undefined, to: f.to || undefined }} />{can('expenses.create') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ open: true })}>Add expense</Button>}</>}
          filters={<>
            <div className="w-40"><CategorySelect kind="expense" allowEmpty placeholder="All categories" value={f.categoryId} onChange={(x) => setF({ ...f, categoryId: x })} /></div>
            <Select className="w-36" aria-label="Belongs to" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}><option value="">All</option><option value="COMPANY">Company</option><option value="PROJECT">Project</option><option value="DEPARTMENT">Department</option></Select>
            <Select className="w-40" aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All statuses</option>{['EXPECTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'].map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select>
            <Input type="date" aria-label="From date" className="w-36" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /><Input type="date" aria-label="To date" className="w-36" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
            <Select className="w-36" aria-label="Voided" value={f.voided} onChange={(e) => setF({ ...f, voided: e.target.value })}><option value="0">Not voided</option><option value="1">Voided only</option><option value="all">All</option></Select>
          </>} />
      ) : <RecurringTab />}
      <ExpenseForm open={form.open} expense={form.row} onClose={() => setForm({ open: false })} onSaved={reload} />
      <AllocateExpense expense={alloc} onClose={() => setAlloc(null)} onSaved={reload} />
    </>
  );
}
