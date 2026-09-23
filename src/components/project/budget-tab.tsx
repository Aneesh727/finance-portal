'use client';
import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { Button, Card, CardHeader, Field, Input, MoneyInput, Notice, ProgressBar, SimpleTable, StatusBadge, useConfirm, useForm, useToast } from '@/ui/kit';
import { dmy, inr, money, pct } from '@/ui/format';
import { FormModal } from '@/components/form-modal';
import { CategorySelect } from '@/components/pickers';
import { RowActions } from '@/components/row-actions';
import { toMinor } from '@/lib/money';

export function BudgetTab({ projectId, fin, budgetRaw, currency, canEdit, categoryBudgets, onChange }: { projectId: string; fin: any; budgetRaw: string; currency: string; canEdit: boolean; categoryBudgets: any[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const b = fin?.budget;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Cost budget" right={canEdit && <Button size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setOpen(true)}>Edit budget</Button>} />
        {b ? (
          <>
            <div className="grid gap-4 sm:grid-cols-4">
              <Mini label="Budget" v={inr(b.budget, currency)} /><Mini label="Spent (actual)" v={inr(b.used, currency)} /><Mini label="Committed" v={inr(b.committed, currency)} /><Mini label="Remaining" v={inr(b.remaining, currency)} tone={b.remaining < 0 ? 'text-red-600' : ''} />
            </div>
            {b.budget > 0 && <div className="mt-3"><div className="mb-1 flex justify-between text-xs text-ink-500"><span>{pct(b.utilizationPct)} used</span><StatusBadge status={b.state} /></div><ProgressBar pct={b.utilizationPct ?? 0} /></div>}
            {b.state === 'EXCEEDED' && <Notice tone="danger" className="mt-3">Over budget by {inr(b.overBy, currency)}.</Notice>}
          </>
        ) : <p className="text-sm text-ink-500">You do not have permission to see budget figures.</p>}
      </Card>
      <Card pad={false}><div className="p-4 pb-0"><CardHeader title="Budget by category" sub="Actual spend vs. the limit set for each cost category" /></div>
        <SimpleTable rows={categoryBudgets} empty={<p className="p-6 text-center text-sm text-ink-500">No category budgets. Only the total budget is enforced.</p>} columns={[
          { key: 'name', label: 'Category', render: (c) => <span className="font-medium text-ink-900">{c.name}</span> },
          { key: 'budget', label: 'Budget', align: 'right', render: (c) => inr(c.budget, currency) },
          { key: 'used', label: 'Actual', align: 'right', render: (c) => inr(c.used, currency) },
          { key: 'committed', label: 'Committed', align: 'right', render: (c) => inr(c.committed, currency) },
          { key: 'remaining', label: 'Remaining', align: 'right', render: (c) => <span className={c.remaining < 0 ? 'text-red-600' : ''}>{inr(c.remaining, currency)}</span> },
          { key: 'u', label: 'Used', className: 'min-w-[8rem]', render: (c) => <div><span className="text-xs text-ink-500">{pct(c.utilizationPct, 0)}</span><ProgressBar pct={c.utilizationPct ?? 0} /></div> },
        ]} /></Card>
      <BudgetForm projectId={projectId} open={open} onClose={() => setOpen(false)} budgetRaw={budgetRaw} categoryBudgets={categoryBudgets} currency={currency} onSaved={onChange} />
    </div>
  );
}
const Mini = ({ label, v, tone }: { label: string; v: string; tone?: string }) => <div><p className="text-xs text-ink-500">{label}</p><p className={`text-lg font-semibold tabular-nums ${tone ?? 'text-ink-900'}`}>{v}</p></div>;

function BudgetForm({ projectId, open, onClose, budgetRaw, categoryBudgets, currency, onSaved }: { projectId: string; open: boolean; onClose: () => void; budgetRaw: string; categoryBudgets: any[]; currency: string; onSaved: () => void }) {
  const toast = useToast();
  const [total, setTotal] = useState('');
  const [lines, setLines] = useState<{ categoryId: string; amount: string }[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  useEffect(() => { if (open) { setTotal(String(Number(budgetRaw))); setLines(categoryBudgets.map((c) => ({ categoryId: c.categoryId, amount: String(c.budget / 100) }))); setError(null); } }, [open, budgetRaw, categoryBudgets]);
  const sum = lines.reduce((s, l) => s + toMinor(l.amount || '0'), 0);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.put<any>(`/api/projects/${projectId}/budgets`, { budget: total || '0', categoryBudgets: lines.filter((l) => l.categoryId).map((l) => ({ categoryId: l.categoryId, amount: l.amount || '0' })) });
      if (r.data?.pendingApproval) toast.info('Budget increase sent for approval'); else toast.success('Budget updated');
      onSaved(); onClose();
    } catch (e) { setError(e as ApiFail); }
    setBusy(false);
  };
  return (
    <FormModal open={open} onClose={onClose} title="Edit budget" onSubmit={submit} busy={busy} error={error} size="lg">
      <Field label={`Total project budget (${currency})`}><MoneyInput value={total} onChange={setTotal} /></Field>
      <div>
        <div className="mb-2 flex items-center justify-between"><h3>Category budgets</h3><Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setLines([...lines, { categoryId: '', amount: '' }])}>Add</Button></div>
        <div className="space-y-2">{lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_10rem_auto] items-center gap-2">
            <CategorySelect kind="cost" value={l.categoryId} onChange={(x) => setLines(lines.map((y, j) => (j === i ? { ...y, categoryId: x } : y)))} />
            <MoneyInput aria-label="Category budget" value={l.amount} onChange={(x) => setLines(lines.map((y, j) => (j === i ? { ...y, amount: x } : y)))} />
            <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>))}</div>
        {toMinor(total || '0') > 0 && sum > toMinor(total || '0') && <p className="mt-2 text-xs text-amber-700">Category budgets ({inr(sum)}) add up to more than the total budget.</p>}
      </div>
      <Notice>Raising the budget may need approval depending on your role. Every change is recorded in the audit log.</Notice>
    </FormModal>
  );
}

export function AdjustmentsCard({ projectId, rows, currency, canEdit, onChange }: { projectId: string; rows: any[]; currency: string; canEdit: boolean; onChange: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const f = useForm({ amount: '', reason: '', date: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!f.values.amount || Number(f.values.amount) === 0) e.amount = 'Enter a non-zero amount'; if (!f.values.reason.trim()) e.reason = 'Give a reason';
    if (Object.keys(e).length) { f.setErrors(e); return; }
    setBusy(true); setError(null);
    try { await api.post(`/api/projects/${projectId}/adjustments`, f.values); toast.success('Adjustment added'); setOpen(false); f.reset(); onChange(); } catch (err) { setError(err as ApiFail); f.fail(err); }
    setBusy(false);
  };
  const del = async (a: any) => { const c = await confirm({ title: 'Remove adjustment?', danger: true, confirmLabel: 'Remove' }); if (!c.ok) return; try { await api.del(`/api/adjustments/${a.id}`); onChange(); } catch (e) { toast.fail(e); } };
  return (
    <Card pad={false}><div className="p-4 pb-0"><CardHeader title="Revenue adjustments" sub="Credit notes (negative) or extra scope billed (positive), ex-tax. They change the contract value." right={canEdit && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Add adjustment</Button>} /></div>
      <SimpleTable rows={rows} empty={<p className="p-6 text-center text-sm text-ink-500">No adjustments.</p>} columns={[
        { key: 'date', label: 'Date', render: (a) => dmy(a.date) }, { key: 'reason', label: 'Reason' },
        { key: 'amount', label: 'Amount', align: 'right', render: (a) => <span className={Number(a.amount) < 0 ? 'text-red-600' : ''}>{money(a.amount, currency)}</span> },
        { key: 'a', label: '', render: (a) => canEdit && <RowActions actions={[{ label: 'Remove', danger: true, onClick: () => del(a) }]} /> },
      ]} />
      <FormModal open={open} onClose={() => setOpen(false)} title="Add revenue adjustment" onSubmit={submit} busy={busy} error={error} size="sm">
        <Field label="Amount (negative for a credit note)" required error={f.errors.amount}><MoneyInput allowNegative value={f.values.amount} onChange={(x) => f.set('amount', x)} /></Field>
        <Field label="Date"><Input type="date" {...f.bind('date')} /></Field>
        <Field label="Reason" required error={f.errors.reason}><Input {...f.bind('reason')} maxLength={300} /></Field>
      </FormModal>
    </Card>
  );
}
