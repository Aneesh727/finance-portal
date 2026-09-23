'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { useApi, useDebounced } from '@/ui/hooks';
import { qs } from '@/ui/api';
import { cn, Select } from '@/ui/kit';
import { useSession } from '@/ui/session';

type SelProps = { value: string; onChange: (v: string) => void; invalid?: boolean; disabled?: boolean; placeholder?: string; allowEmpty?: boolean; className?: string; id?: string };

/** select fed from a list endpoint (first 200 rows) */
export function LookupSelect({ url, label, value, onChange, invalid, disabled, placeholder = 'Select…', allowEmpty = true, className, id, params }: SelProps & { url: string; label: (r: any) => string; params?: Record<string, string | number | undefined> }) {
  const { data } = useApi<any[]>(`${url}${qs({ pageSize: 200, sort: undefined, ...params })}`);
  return (
    <Select id={id} className={className} invalid={invalid} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">{placeholder}</option>}
      {!allowEmpty && !value && <option value="">{placeholder}</option>}
      {data?.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}
      {value && data && !data.some((r) => r.id === value) && <option value={value}>(current)</option>}
    </Select>
  );
}
export const ClientSelect = (p: SelProps) => <LookupSelect {...p} url="/api/clients" params={{ sort: 'name', dir: 'asc' } as any} label={(r) => r.companyName} placeholder={p.placeholder ?? 'Select client…'} />;
export const UserSelect = (p: SelProps) => <LookupSelect {...p} url="/api/users" params={{ active: '1' }} label={(r) => r.name} placeholder={p.placeholder ?? 'Select person…'} />;
export const VendorSelect = (p: SelProps) => <LookupSelect {...p} url="/api/vendors" params={{ sort: 'name', dir: 'asc' } as any} label={(r) => r.name} placeholder={p.placeholder ?? 'No vendor'} />;
export const ResourceSelect = (p: SelProps) => <LookupSelect {...p} url="/api/resources" params={{ sort: 'name', dir: 'asc' } as any} label={(r) => `${r.name} · ${r.role}`} placeholder={p.placeholder ?? 'Select resource…'} />;

/** category select from /api/meta (kind: service | cost | expense) */
export function CategorySelect({ kind, value, onChange, invalid, placeholder = 'Select category…', allowEmpty, id, disabled }: SelProps & { kind: 'service' | 'cost' | 'expense' }) {
  const { meta } = useSession();
  const list = meta?.categories[kind] ?? [];
  return (
    <Select id={id} invalid={invalid} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
      {(allowEmpty || !value) && <option value="">{placeholder}</option>}
      {list.filter((c) => c.active || c.id === value).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </Select>
  );
}

/** typeahead project picker — scales to thousands of projects */
export function ProjectPicker({ value, onChange, invalid, disabled, placeholder = 'Search project…', id, status, initialLabel }: SelProps & { status?: string; initialLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [label, setLabel] = useState(initialLabel ?? '');
  const dq = useDebounced(q, 250);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  const { data, loading } = useApi<any[]>(open ? `/api/projects${qs({ pageSize: 15, q: dq || undefined, sort: 'createdAt', status })}` : null);
  const known = useApi<any>(value && !label ? `/api/projects/${value}` : null);
  useEffect(() => { if (known.data && !label) { const p = known.data.project ?? known.data; setLabel(`${p.code} · ${p.name}`); }; }, [known.data, label]);
  return (
    <div ref={ref} className="relative">
      <button type="button" id={id} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}
        className={cn('input flex items-center justify-between gap-2 text-left', invalid && 'input-error', !value && 'text-ink-400')}>
        <span className="truncate">{value ? label || 'Selected project' : placeholder}</span>
        <span className="flex items-center gap-1">{value && !disabled && <X className="h-3.5 w-3.5 text-ink-400 hover:text-ink-700" onClick={(e) => { e.stopPropagation(); onChange(''); setLabel(''); }} aria-label="Clear" />}<ChevronDown className="h-4 w-4 text-ink-400" /></span>
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-[18rem] rounded-xl border border-ink-200 bg-white p-1 shadow-pop">
          <input autoFocus className="input mb-1" placeholder="Type a name, code or client…" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
          <div className="max-h-60 overflow-y-auto" role="listbox">
            {loading && !data ? <p className="p-2 text-sm text-ink-500">Searching…</p> : !data?.length ? <p className="p-2 text-sm text-ink-500">No projects found.</p> : data.map((p) => (
              <button type="button" key={p.id} role="option" aria-selected={p.id === value} className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-ink-50" onClick={() => { onChange(p.id); setLabel(`${p.code} · ${p.name}`); setOpen(false); setQ(''); }}>
                <span className="block truncate text-sm text-ink-900">{p.code} · {p.name}</span><span className="block truncate text-xs text-ink-500">{p.client?.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
