'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { api } from '@/ui/api';
import { Badge, Button, DataTable, Input, Select, StatusBadge, useConfirm, useToast, type Column } from '@/ui/kit';
import { dmy, inr, money } from '@/ui/format';
import { useSession } from '@/ui/session';
import { CostForm, type CostRow } from '@/components/forms/cost-form';
import { ConvertCost } from '@/components/forms/convert-cost';
import { RowActions } from '@/components/row-actions';
import { CategorySelect, ProjectPicker } from '@/components/pickers';
import { ExportMenu } from '@/components/export-menu';

export function CostsTable({ projectId, onChange }: { projectId?: string; onChange?: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState({ projectId: projectId ?? '', categoryId: '', kind: '', status: '', from: '', to: '', voided: '0' });
  const [key, setKey] = useState(0);
  const [form, setForm] = useState<{ open: boolean; cost?: CostRow | null; kind?: string }>({ open: false });
  const [conv, setConv] = useState<CostRow | null>(null);
  const reload = () => { setKey((k) => k + 1); onChange?.(); };
  const void_ = async (c: CostRow) => {
    const r = await confirm({ title: 'Void this cost?', message: `“${c.name}” will be removed from all totals. This is recorded in the audit log.`, danger: true, confirmLabel: 'Void cost', reason: { label: 'Reason', required: true } });
    if (!r.ok) return;
    try { await api.post(`/api/costs/${c.id}/void`, { reason: r.reason }); toast.success('Cost voided'); reload(); } catch (e) { toast.fail(e); }
  };
  const cols: Column<any>[] = [
    { key: 'date', label: 'Date', sort: 'date', render: (r) => dmy(r.date) },
    { key: 'name', label: 'Cost', sort: 'name', className: 'min-w-[12rem]', render: (r) => <span><span className="font-medium text-ink-900">{r.name}</span>{r.archivedAt && <Badge tone="gray" className="ml-2">Voided</Badge>}{r.recurrence !== 'NONE' && <Badge tone="blue" className="ml-2">{r.recurrence.toLowerCase()}</Badge>}<span className="block text-xs text-ink-500">{[r.vendor, r.resource].filter(Boolean).join(' · ')}</span></span> },
    ...(projectId ? [] : [{ key: 'project', label: 'Project', sort: 'project', render: (r: any) => <Link className="link" href={`/projects/${r.projectId}`} onClick={(e) => e.stopPropagation()}>{r.projectCode}<span className="block max-w-[14rem] truncate text-xs text-ink-500">{r.projectName}</span></Link> }]),
    { key: 'category', label: 'Category', sort: 'category', hideBelow: 'md' },
    { key: 'kind', label: 'Type', hideBelow: 'lg', render: (r) => <span className="text-xs uppercase tracking-wide text-ink-500">{r.kind.toLowerCase()}</span> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'amount', label: 'Amount', sort: 'amount', align: 'right', render: (r) => <span className={r.isCredit ? 'text-emerald-700' : ''}>{r.isCredit ? '−' : ''}{money(String(Math.abs(Number(r.amount))), r.projectCurrency)}</span> },
    { key: 'a', label: '', render: (r) => (
      <RowActions actions={[
        { label: 'Edit', onClick: () => setForm({ open: true, cost: r }), hidden: !!r.archivedAt || !!r.expenseId || !can('costs.create') },
        { label: 'Convert to actual', onClick: () => setConv(r), hidden: r.kind !== 'COMMITTED' || !!r.archivedAt || !can('costs.approve') || r.status === 'FULFILLED' },
        { label: 'Void', danger: true, onClick: () => void_(r), hidden: !!r.archivedAt || !can('costs.create') },
      ]} />) },
  ];
  return (
    <>
      <DataTable<any> url="/api/costs" params={f} reloadKey={key} columns={cols} defaultSort="date" searchPlaceholder="Search cost, vendor, project…" emptyTitle="No costs yet" emptyHint="Add the first cost entry to start tracking spend."
        emptyAction={can('costs.create') ? <Button variant="primary" onClick={() => setForm({ open: true })}>Add cost</Button> : undefined}
        summary={(m) => <>Actual cost on this view: <b className="tabular-nums text-ink-900">{inr(Number(m.actualTotalMinor ?? 0))}</b> across {m.total} entr{m.total === 1 ? 'y' : 'ies'}</>}
        toolbar={<><ExportMenu dataset="costs" params={{ projectId: f.projectId || undefined, from: f.from || undefined, to: f.to || undefined }} />{can('costs.create') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ open: true })}>Add cost</Button>}</>}
        filters={<>
          {!projectId && <div className="w-56"><ProjectPicker value={f.projectId} onChange={(x) => setF({ ...f, projectId: x })} placeholder="All projects" /></div>}
          <div className="w-40"><CategorySelect kind="cost" allowEmpty placeholder="All categories" value={f.categoryId} onChange={(x) => setF({ ...f, categoryId: x })} /></div>
          <Select className="w-32" aria-label="Type" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">All types</option><option value="ACTUAL">Actual</option><option value="COMMITTED">Committed</option><option value="ESTIMATED">Estimated</option></Select>
          <Select className="w-40" aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All statuses</option>{['PLANNED', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED', 'FULFILLED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}</Select>
          <Input type="date" aria-label="From date" className="w-36" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          <Input type="date" aria-label="To date" className="w-36" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          <Select className="w-36" aria-label="Voided" value={f.voided} onChange={(e) => setF({ ...f, voided: e.target.value })}><option value="0">Not voided</option><option value="1">Voided only</option><option value="all">All</option></Select>
        </>} />
      <CostForm open={form.open} cost={form.cost} projectId={projectId} defaultKind={form.kind} onClose={() => setForm({ open: false })} onSaved={reload} />
      <ConvertCost cost={conv} onClose={() => setConv(null)} onDone={reload} />
    </>
  );
}
