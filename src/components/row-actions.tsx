'use client';
import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/ui/kit';

export interface RowAction { label: string; onClick: () => void; danger?: boolean; hidden?: boolean; disabled?: boolean }
/** kebab menu for table rows; stops row-click propagation */
export function RowActions({ actions }: { actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  const list = actions.filter((a) => !a.hidden);
  if (!list.length) return null;
  return (
    <div ref={ref} className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
      <button className="btn-ghost btn-icon" aria-label="Row actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal className="h-4 w-4" /></button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-44 rounded-xl border border-ink-200 bg-white p-1 shadow-pop">
          {list.map((a) => <button key={a.label} role="menuitem" disabled={a.disabled} onClick={() => { setOpen(false); a.onClick(); }} className={cn('block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-ink-50 disabled:opacity-40', a.danger && 'text-red-700 hover:bg-red-50')}>{a.label}</button>)}
        </div>
      )}
    </div>
  );
}
