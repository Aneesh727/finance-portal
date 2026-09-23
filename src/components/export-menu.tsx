'use client';
import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { api, qs } from '@/ui/api';
import { Button, useToast } from '@/ui/kit';
import { useSession } from '@/ui/session';

/** Export dropdown (CSV / Excel / PDF) for a dataset; requires reports.export */
export function ExportMenu({ dataset, params, label = 'Export' }: { dataset: string; params?: Record<string, string | undefined>; label?: string }) {
  const { can } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  if (!can('reports.export')) return null;
  const run = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setOpen(false); setBusy(true);
    try { await api.download(`/api/export/${dataset}${qs({ ...params, format })}`, `${dataset}.${format}`); toast.success('Export downloaded'); } catch (e) { toast.fail(e); }
    setBusy(false);
  };
  return (
    <div ref={ref} className="relative">
      <Button icon={<Download className="h-4 w-4" />} loading={busy} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>{label}</Button>
      {open && <div role="menu" className="absolute right-0 z-30 mt-1 w-40 rounded-xl border border-ink-200 bg-white p-1 shadow-pop">
        {([['csv', 'CSV'], ['xlsx', 'Excel (.xlsx)'], ['pdf', 'PDF']] as const).map(([k, l]) => <button key={k} role="menuitem" className="block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-ink-50" onClick={() => run(k)}>{l}</button>)}
      </div>}
    </div>
  );
}
