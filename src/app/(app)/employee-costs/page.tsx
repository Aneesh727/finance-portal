'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { useApi } from '@/ui/hooks';
import { Button, Card, ErrorBox, Input, Loading, Notice, PageHeader, Select, Stat, useToast } from '@/ui/kit';
import { inr, inr0, title, today } from '@/ui/format';
import { Guard } from '@/components/guard';
import { FormModal } from '@/components/form-modal';
import { ProjectPicker } from '@/components/pickers';

const shift = (m: string, n: number) => { const d = new Date(m.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const label = (m: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(m.slice(0, 10) + 'T00:00:00Z'));

export default function EmployeeCostsPage() { return <Guard any={['allocations.manage']}><Page /></Guard>; }

function Page() {
  const [month, setMonth] = useState(today().slice(0, 7) + '-01');
  const { data, error, loading, reload } = useApi<any>(`/api/employee-allocations?month=${month}`);
  const [edit, setEdit] = useState<any | null>(null);
  const totalCost = data?.employees.reduce((s: number, e: any) => s + e.monthlyCost, 0) ?? 0;
  const totalAlloc = data?.employees.reduce((s: number, e: any) => s + e.allocated, 0) ?? 0;
  return (
    <>
      <PageHeader title="Employee cost allocation" sub="Salaries only become project cost when you allocate them. Anything unallocated is internal overhead." actions={<div className="flex items-center gap-1"><Button size="icon" aria-label="Previous month" onClick={() => setMonth(shift(month, -1))}><ChevronLeft className="h-4 w-4" /></Button><span className="w-36 text-center text-sm font-medium">{label(month)}</span><Button size="icon" aria-label="Next month" onClick={() => setMonth(shift(month, 1))}><ChevronRight className="h-4 w-4" /></Button></div>} />
      <ErrorBox error={error} />
      {!data ? (error ? null : <Loading />) : (
        <div className={loading ? 'opacity-60' : ''}>
          <div className="mb-4 grid gap-3 sm:grid-cols-3"><Stat label="Payroll this month" value={inr0(totalCost)} /><Stat label="Allocated to projects" value={inr0(totalAlloc)} tone="good" /><Stat label="Internal (unallocated)" value={inr0(totalCost - totalAlloc)} sub={totalCost ? `${Math.round(((totalCost - totalAlloc) / totalCost) * 100)}% of payroll` : undefined} /></div>
          {data.employees.length === 0 ? <Notice>No active employees with a monthly cost. Add employees under <Link className="link" href="/resources">Resources</Link>.</Notice> : (
            <Card pad={false}><div className="overflow-x-auto"><table className="w-full border-collapse">
              <thead><tr><th className="th">Employee</th><th className="th text-right">Monthly cost</th><th className="th">Allocated to</th><th className="th text-right">Allocated</th><th className="th text-right">Internal</th><th className="th" /></tr></thead>
              <tbody>{data.employees.map((e: any) => (
                <tr key={e.id} className="hover:bg-ink-50/70">
                  <td className="td font-medium text-ink-900">{e.name}<span className="block text-xs font-normal text-ink-500">{e.role}</span></td>
                  <td className="td num">{inr(e.monthlyCost)}</td>
                  <td className="td text-xs text-ink-600">{e.rows.length ? e.rows.map((r: any, i: number) => <span key={i} className="mr-2 inline-block">{r.projectCode ?? 'Internal'} <span className="text-ink-400">({title(r.method)} {Number(r.value)})</span></span>) : <span className="text-ink-400">Not allocated</span>}</td>
                  <td className="td num">{inr(e.allocated)}</td>
                  <td className="td num text-ink-500">{inr(e.internal)}</td>
                  <td className="td"><Button size="sm" onClick={() => setEdit(e)}>Allocate</Button></td>
                </tr>))}</tbody></table></div></Card>)}
        </div>)}
      <AllocForm emp={edit} month={month} onClose={() => setEdit(null)} onSaved={reload} />
    </>
  );
}

interface Row { projectId: string; method: string; value: string; notes: string; label?: string }
function AllocForm({ emp, month, onClose, onSaved }: { emp: any | null; month: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  useEffect(() => { if (emp) { setRows(emp.rows.filter((r: any) => r.projectId).map((r: any) => ({ projectId: r.projectId, method: r.method, value: String(Number(r.value)), notes: r.notes ?? '', label: `${r.projectCode} · ${r.projectName}` }))); setError(null); } }, [emp]);
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const pctSum = rows.filter((r) => r.method === 'PERCENT').reduce((s, r) => s + Number(r.value || 0), 0);
  const submit = async () => {
    if (rows.some((r) => !r.projectId)) { setError(new ApiFail(422, 'VALIDATION', 'Choose a project on every line.')); return; }
    setBusy(true); setError(null);
    try { await api.put('/api/employee-allocations', { resourceId: emp.id, month, rows: rows.map((r) => ({ projectId: r.projectId, method: r.method, value: Number(r.value || 0), notes: r.notes || null })) }); toast.success('Allocation saved'); onSaved(); onClose(); }
    catch (e) { setError(e as ApiFail); }
    setBusy(false);
  };
  return (
    <FormModal open={!!emp} onClose={onClose} title={emp ? `Allocate ${emp.name} — ${label(month)}` : ''} onSubmit={submit} busy={busy} error={error} size="xl" submitLabel="Save allocation">
      {emp && <Notice>Monthly cost {inr(emp.monthlyCost)} (prorated if they joined or left this month). Total cannot exceed 100%; the rest is internal cost.</Notice>}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid items-center gap-2 sm:grid-cols-[1fr_8rem_7rem_1fr_auto]">
            <ProjectPicker value={r.projectId} onChange={(x) => set(i, { projectId: x })} initialLabel={r.label} />
            <Select aria-label="Method" value={r.method} onChange={(e) => set(i, { method: e.target.value })}><option value="PERCENT">% of month</option><option value="HOURS">Hours</option><option value="DAYS">Days</option><option value="MANUAL">Amount ₹</option></Select>
            <Input aria-label="Value" inputMode="decimal" value={r.value} onChange={(e) => set(i, { value: e.target.value })} />
            <Input aria-label="Notes" placeholder="Notes (optional)" value={r.notes} onChange={(e) => set(i, { notes: e.target.value })} maxLength={300} />
            <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>))}
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setRows([...rows, { projectId: '', method: 'PERCENT', value: '', notes: '' }])}>Add project</Button>
        {pctSum > 100 && <p className="text-xs text-red-600">Percent lines add up to {pctSum}% — more than 100%.</p>}
      </div>
    </FormModal>
  );
}
