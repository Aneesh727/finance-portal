'use client';
import { useEffect, useState } from 'react';
import { api, ApiFail } from '@/ui/api';
import { Field, Input, MoneyInput, Notice, useToast } from '@/ui/kit';
import { today, money } from '@/ui/format';
import { FormModal, BudgetOverride } from '@/components/form-modal';
import type { CostRow } from './cost-form';

/** turn a committed (promised) cost into an actual expense */
export function ConvertCost({ cost, onClose, onDone }: { cost: CostRow | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);
  const [ov, setOv] = useState(false); const [reason, setReason] = useState('');
  useEffect(() => { if (cost) { setDate(today()); setAmount(cost.amount); setError(null); setOv(false); setReason(''); } }, [cost]);
  const submit = async () => {
    if (!cost) return;
    setBusy(true); setError(null);
    try { await api.post(`/api/costs/${cost.id}/convert`, { date, amount: amount || undefined, overrideBudget: ov, overrideReason: ov ? reason : undefined }); toast.success('Converted to an actual cost'); onDone(); onClose(); }
    catch (e) { setError(e as ApiFail); }
    setBusy(false);
  };
  return (
    <FormModal open={!!cost} onClose={onClose} title="Convert committed cost to actual" onSubmit={submit} busy={busy} error={error} submitLabel="Convert" size="sm">
      <Notice>“{cost?.name}” was committed for {cost ? money(cost.amount) : ''}. Enter the amount actually incurred.</Notice>
      <Field label="Actual amount" required><MoneyInput value={amount} onChange={setAmount} /></Field>
      <Field label="Date incurred" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <BudgetOverride error={error} on={ov} setOn={setOv} reason={reason} setReason={setReason} />
    </FormModal>
  );
}
