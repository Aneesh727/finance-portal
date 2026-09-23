'use client';
import { useEffect, useState } from 'react';
import { Button, ErrorBox, Modal, Notice } from '@/ui/kit';
import type { ApiFail } from '@/ui/api';

/** Standard modal wrapper for create/edit forms: title, error area, Cancel + Save. */
export function FormModal({ open, onClose, title, onSubmit, busy, error, submitLabel = 'Save', size = 'md', children, disabled, extraFooter }: {
  open: boolean; onClose: () => void; title: string; onSubmit: () => void; busy?: boolean; error?: ApiFail | null; submitLabel?: string; size?: 'sm' | 'md' | 'lg' | 'xl'; children: React.ReactNode; disabled?: boolean; extraFooter?: React.ReactNode;
}) {
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={title} size={size} footer={<>{extraFooter}<Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={disabled} onClick={onSubmit}>{submitLabel}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (!busy && !disabled) onSubmit(); }} className="space-y-4" noValidate>
        {error && error.code !== 'BUDGET_WOULD_BE_EXCEEDED' && <ErrorBox error={error} />}
        {children}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

/** shown when the server reports the budget guard tripped and the caller may override it */
export function BudgetOverride({ error, on, reason, setReason, setOn }: { error: ApiFail | null; on: boolean; reason: string; setReason: (s: string) => void; setOn: (b: boolean) => void }) {
  // Once the server has said "this would exceed a budget" the override controls must stay on screen: a later, different
  // error (e.g. "please give a reason") replaces `error`, and losing the checkbox/reason field there would strand the user.
  const [seen, setSeen] = useState<ApiFail | null>(null);
  useEffect(() => { if (error?.code === 'BUDGET_WOULD_BE_EXCEEDED') setSeen(error); }, [error]);
  if (!seen) return null;
  const reasons = (seen.details?.reasons as string[] | undefined) ?? [seen.message];
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
      <p className="font-medium">This would exceed a budget</p>
      <ul className="mt-1 list-disc pl-5 text-xs">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" className="h-4 w-4 rounded border-ink-300" checked={on} onChange={(e) => setOn(e.target.checked)} />Record it anyway (budget override — audited)</label>
      {on && <input className="input mt-2" placeholder="Reason for the override (required)" aria-label="Reason for the override" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
    </div>
  );
}
export { Notice };
