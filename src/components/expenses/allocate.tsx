'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { useApi } from '@/ui/hooks';
import { Button, Input, Notice, Select, useToast } from '@/ui/kit';
import { inr, money, title } from '@/ui/format';
import { FormModal } from '@/components/form-modal';
import { ProjectPicker } from '@/components/pickers';
import { toMinor } from '@/lib/money';

interface Row { targetType: 'PROJECT' | 'DEPARTMENT' | 'OVERHEAD'; projectId: string; department: string; method: 'FIXED' | 'PERCENT' | 'HOURS' | 'REVENUE_PERCENT'; value: string }

/** Split a company / department expense across projects; whatever is not allocated stays as company overhead */
export function AllocateExpense({ expense, onClose, onSaved }: { expense: any | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data } = useApi<any>(expense ? `/api/expenses/${expense.id}` : null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  useEffect(() => { if (data) setRows(data.allocations.map((a: any) => ({ targetType: a.targetType, projectId: a.projectId ?? '', department: a.department ?? '', method: a.method, value: String(Number(a.value)) }))); setError(null); }, [data]);
  const total = expense ? toMinor(expense.amount) : 0;
  const preview = rows.reduce((s, r) => s + (r.method === 'FIXED' ? toMinor(r.value || '0') : r.method === 'PERCENT' ? Math.round((total * Number(r.value || 0)) / 100) : 0), 0);
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const submit = async () => {
    setBusy(true); setError(null);
    try { await api.put(`/api/expenses/${expense.id}/allocations`, { rows: rows.map((r) => ({ targetType: r.targetType, projectId: r.targetType === 'PROJECT' ? r.projectId : null, department: r.targetType === 'DEPARTMENT' ? r.department : null, method: r.method, value: Number(r.value || 0) })) }); toast.success('Allocation saved'); onSaved(); onClose(); }
    catch (e) { setError(e as ApiFail); }
    setBusy(false);
  };
  return (
    <FormModal open={!!expense} onClose={onClose} title="Allocate expense" onSubmit={submit} busy={busy} error={error} size="xl" submitLabel="Save allocation">
      {expense && <Notice>“{expense.description}” — {money(expense.amount)}. Allocated amounts become project cost; the rest stays as company overhead.</Notice>}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid items-center gap-2 sm:grid-cols-[8rem_1fr_9rem_8rem_auto]">
            <Select aria-label="Target" value={r.targetType} onChange={(e) => set(i, { targetType: e.target.value as Row['targetType'] })}><option value="PROJECT">Project</option><option value="DEPARTMENT">Department</option></Select>
            {r.targetType === 'PROJECT' ? <ProjectPicker value={r.projectId} onChange={(x) => set(i, { projectId: x })} /> : <Input aria-label="Department" placeholder="Department" value={r.department} onChange={(e) => set(i, { department: e.target.value })} />}
            <Select aria-label="Method" value={r.method} onChange={(e) => set(i, { method: e.target.value as Row['method'] })}><option value="FIXED">Fixed amount</option><option value="PERCENT">Percent</option><option value="HOURS">By hours</option><option value="REVENUE_PERCENT">By revenue</option></Select>
            <Input aria-label="Value" inputMode="decimal" placeholder={r.method === 'FIXED' ? '₹' : r.method === 'PERCENT' ? '%' : 'weight'} value={r.value} onChange={(e) => set(i, { value: e.target.value })} />
            <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>))}
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setRows([...rows, { targetType: 'PROJECT', projectId: '', department: '', method: 'PERCENT', value: '' }])}>Add line</Button>
      </div>
      <p className="text-sm text-ink-600">Fixed/percent lines allocate {inr(preview)}; unallocated overhead {inr(Math.max(0, total - preview))}. “By hours” / “By revenue” share the remainder in proportion to each project’s logged hours or revenue.</p>
    </FormModal>
  );
}
export { title };
