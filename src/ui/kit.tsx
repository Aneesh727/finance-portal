'use client';
/** Design-system primitives: buttons, fields, modal, toasts, confirm, tables, badges, stats, tabs. */
import { createContext, cloneElement, forwardRef, isValidElement, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Info, Loader2, Search, X, Inbox } from 'lucide-react';
import { useApi, useDebounced } from './hooks';
import { ApiFail } from './api';
import { qs } from './api';
import { title } from './format';

export const cn = clsx;

// ───────────────────────── buttons ─────────────────────────
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'md' | 'sm' | 'icon'; loading?: boolean; icon?: React.ReactNode };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...p }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={cn(`btn-${variant}`, size === 'sm' && 'btn-sm', size === 'icon' && 'btn-icon', className)} {...p}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({ href, variant = 'secondary', size = 'md', icon, children, className }: { href: string; variant?: BtnProps['variant']; size?: 'md' | 'sm'; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <Link href={href} className={cn(`btn-${variant}`, size === 'sm' && 'btn-sm', className)}>{icon}{children}</Link>;
}

// ───────────────────────── fields ─────────────────────────
export function Field({ label, error, hint, required, children, className }: { label?: string; error?: string; hint?: string; required?: boolean; children: React.ReactNode; className?: string }) {
  const id = useId();
  const only = isValidElement(children) ? (children as React.ReactElement<Record<string, unknown>>) : null;
  // associate the label with a single control (input / select / textarea / picker) so screen readers and tests can find it
  const single = !!only && (typeof only.type !== 'string' || ['input', 'select', 'textarea'].includes(only.type));
  const child = single && only && !only.props.id ? cloneElement(only, { id, ...(error ? { 'aria-invalid': true } : {}), 'aria-describedby': error || hint ? `${id}-msg` : undefined }) : children;
  return (
    <div className={className} role={single ? undefined : 'group'} aria-labelledby={!single && label ? `${id}-l` : undefined}>
      {label && <label id={`${id}-l`} htmlFor={single ? (only?.props.id as string | undefined) ?? id : undefined} className="label">{label}{required && <span className="text-red-500"> *</span>}</label>}
      {child}
      {error ? <p id={`${id}-msg`} role="alert" className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p id={`${id}-msg`} className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}
type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, className, ...p }, ref) {
  return <input ref={ref} className={cn('input', invalid && 'input-error', className)} aria-invalid={invalid || undefined} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ invalid, className, ...p }, ref) {
  return <textarea ref={ref} className={cn('input', invalid && 'input-error', className)} {...p} />;
});
export function Select({ invalid, className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return <select className={cn('input pr-8', invalid && 'input-error', className)} aria-invalid={invalid || undefined} {...p}>{children}</select>;
}
/** amount input: digits, optional minus, up to 2 decimals. Value stays a plain string ("1234.5"). */
export function MoneyInput({ value, onChange, invalid, allowNegative, ...p }: Omit<InputProps, 'value' | 'onChange' | 'type'> & { value: string; onChange: (v: string) => void; allowNegative?: boolean }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">₹</span>
      <Input inputMode="decimal" className="pl-7 text-right tabular-nums" invalid={invalid} value={value} placeholder="0.00"
        onChange={(e) => { const v = e.target.value.replace(/,/g, ''); if (v === '' || (allowNegative ? /^-?\d{0,13}(\.\d{0,2})?$/ : /^\d{0,13}(\.\d{0,2})?$/).test(v)) onChange(v); }} {...p} />
    </div>
  );
}
export function Check({ label, checked, onChange, disabled }: { label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className="inline-flex items-center gap-2 text-sm text-ink-700 cursor-pointer select-none">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500" />
      {label}
    </label>
  );
}

/** tiny form state helper: values, per-field errors (also fed from API validation errors) */
export function useForm<T extends Record<string, any>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = useCallback(<K extends keyof T>(k: K, v: T[K]) => { setValues((s) => ({ ...s, [k]: v })); setErrors((e) => (e[k as string] ? { ...e, [k as string]: '' } : e)); }, []);
  const bind = <K extends keyof T>(k: K) => ({ value: (values[k] ?? '') as any, onChange: (e: React.ChangeEvent<any>) => set(k, e.target.value as T[K]), invalid: !!errors[k as string] });
  const reset = useCallback((v?: T) => { setValues(v ?? initial); setErrors({}); /* eslint-disable-next-line */ }, []);
  const fail = useCallback((e: unknown) => { if (e instanceof ApiFail && Object.keys(e.fields).length) setErrors(e.fields); }, []);
  return { values, set, bind, errors, setErrors, reset, setValues, fail };
}

export function ErrorBox({ error, className }: { error: ApiFail | Error | string | null | undefined; className?: string }) {
  if (!error) return null;
  const msg = typeof error === 'string' ? error : error.message;
  const rid = error instanceof ApiFail ? error.requestId : undefined;
  return (
    <div role="alert" className={cn('flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800', className)}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{msg}{rid && <span className="ml-2 text-[11px] text-red-500">ref {rid.slice(0, 8)}</span>}</div>
    </div>
  );
}
export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'success' | 'danger'; children: React.ReactNode; className?: string }) {
  const t = { info: 'border-blue-200 bg-blue-50 text-blue-900', warn: 'border-amber-200 bg-amber-50 text-amber-900', success: 'border-emerald-200 bg-emerald-50 text-emerald-900', danger: 'border-red-200 bg-red-50 text-red-900' }[tone];
  return <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm', t, className)}><Info className="mt-0.5 h-4 w-4 shrink-0" /><div>{children}</div></div>;
}

// ───────────────────────── layout bits ─────────────────────────
export function Card({ children, className, pad = true }: { children: React.ReactNode; className?: string; pad?: boolean }) {
  return <section className={cn('card min-w-0', pad && 'card-pad', className)}>{children}</section>;
}
export function CardHeader({ title: t, right, sub }: { title: React.ReactNode; right?: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h2>{t}</h2>{sub && <p className="text-xs text-ink-500 mt-0.5">{sub}</p>}</div>{right && <div className="flex items-center gap-2">{right}</div>}</div>;
}
export function PageHeader({ title: t, sub, actions, back }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5">
      {back && <Link href={back.href} className="mb-1 inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800"><ChevronLeft className="h-3.5 w-3.5" />{back.label}</Link>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h1 className="truncate">{t}</h1>{sub && <p className="mt-1 text-sm text-ink-500">{sub}</p>}</div>
        {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
      </div>
    </div>
  );
}
export function Stat({ label, value, sub, tone, icon, href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'bad' | 'warn' | 'neutral'; icon?: React.ReactNode; href?: string }) {
  const color = { good: 'text-emerald-700', bad: 'text-red-700', warn: 'text-amber-700', neutral: 'text-ink-900' }[tone ?? 'neutral'];
  const body = (
    <div className="card card-pad h-full">
      <div className="flex items-center justify-between text-xs font-medium text-ink-500"><span>{label}</span>{icon}</div>
      <div className={cn('mt-1.5 text-2xl font-semibold tabular-nums tracking-tight', color)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-500">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block transition hover:-translate-y-px hover:shadow-pop rounded-xl">{body}</Link> : body;
}
export function Spinner({ className }: { className?: string }) { return <Loader2 className={cn('h-5 w-5 animate-spin text-ink-400', className)} />; }
export function Loading({ label = 'Loading…' }: { label?: string }) { return <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-500"><Spinner />{label}</div>; }
export function Empty({ title: t, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-2 py-12 text-center"><Inbox className="h-8 w-8 text-ink-300" /><p className="text-sm font-medium text-ink-700">{t}</p>{hint && <p className="max-w-sm text-xs text-ink-500">{hint}</p>}{action}</div>;
}
export function ProgressBar({ pct, tone }: { pct: number; tone?: 'good' | 'warn' | 'bad' }) {
  const w = Math.max(0, Math.min(100, pct));
  const c = tone ? { good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500' }[tone] : pct >= 100 ? 'bg-red-500' : pct >= 85 ? 'bg-amber-500' : 'bg-emerald-500';
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><div className={cn('h-full rounded-full transition-all', c)} style={{ width: `${w}%` }} /></div>;
}

// ───────────────────────── badges ─────────────────────────
const TONES: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', red: 'bg-red-50 text-red-700 ring-1 ring-red-200', amber: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  blue: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200', gray: 'bg-ink-100 text-ink-600 ring-1 ring-ink-200', purple: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200', brand: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
};
export function Badge({ tone = 'gray', children, className }: { tone?: keyof typeof TONES; children: React.ReactNode; className?: string }) { return <span className={cn('badge', TONES[tone], className)}>{children}</span>; }
const STATUS_TONE: Record<string, keyof typeof TONES> = {
  ACTIVE: 'green', APPROVED: 'green', PAID: 'green', COMPLETED: 'blue', HEALTHY: 'green', WON: 'green', DONE: 'green', FULFILLED: 'blue', ISSUED: 'blue', RECEIPT: 'green',
  PENDING: 'amber', PENDING_APPROVAL: 'amber', ATTENTION: 'amber', ON_HOLD: 'amber', PARTIALLY_PAID: 'amber', ONBOARDING: 'blue', EXPECTED: 'amber', NEGOTIATION: 'purple', PROPOSAL: 'purple', OPEN: 'blue', IN_PROGRESS: 'blue', PLANNED: 'gray', SCHEDULED: 'gray', NOT_STARTED: 'gray',
  OVERDUE: 'red', CRITICAL: 'red', CANCELLED: 'gray', LOST: 'red', REJECTED: 'red', EXCEEDED: 'red', REFUND: 'purple', EXPIRED: 'gray', LEAD: 'gray', COMMITTED: 'purple', NA: 'gray', INACTIVE: 'gray',
};
export const StatusBadge = ({ status }: { status: string | null | undefined }) => (status ? <Badge tone={STATUS_TONE[status] ?? 'gray'}>{status === 'NA' ? 'N/A' : title(status)}</Badge> : <span>—</span>);
export const HealthDot = ({ status, label }: { status: string; label?: boolean }) => {
  const c = { HEALTHY: 'bg-emerald-500', ATTENTION: 'bg-amber-500', CRITICAL: 'bg-red-500', NA: 'bg-ink-300' }[status] ?? 'bg-ink-300';
  return <span className="inline-flex items-center gap-1.5 text-xs text-ink-600"><span className={cn('h-2 w-2 rounded-full', c)} />{label !== false && (status === 'NA' ? 'N/A' : title(status))}</span>;
};

// ───────────────────────── modal ─────────────────────────
export function Modal({ open, onClose, title: t, children, footer, size = 'md', dismissible = true }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; dismissible?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input:not([disabled]),select,textarea')?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open, onClose, dismissible]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={typeof t === 'string' ? t : undefined}>
      <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-[1px]" onMouseDown={() => dismissible && onClose()} />
      <div ref={ref} className={cn('relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-pop sm:rounded-2xl', w)}>
        <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
          <h2 className="text-base">{t}</h2>
          <button className="btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-3 sm:rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}

// ───────────────────────── toasts ─────────────────────────
interface Toast { id: number; tone: 'success' | 'error' | 'info'; text: string }
const ToastCtx = createContext<{ push: (t: Toast['tone'], text: string) => void } | null>(null);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { id, tone, text }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), tone === 'error' ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={useMemo(() => ({ push }), [push])}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,24rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role="status" className={cn('pointer-events-auto flex items-start gap-2 rounded-lg border bg-white px-3 py-2.5 text-sm shadow-pop', t.tone === 'error' ? 'border-red-200' : t.tone === 'success' ? 'border-emerald-200' : 'border-ink-200')}>
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : t.tone === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 text-red-600" /> : <Info className="mt-0.5 h-4 w-4 text-brand-600" />}
            <span className="text-ink-800">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('useToast outside provider');
  return useMemo(() => ({ success: (m: string) => c.push('success', m), error: (m: string) => c.push('error', m), info: (m: string) => c.push('info', m), fail: (e: unknown) => c.push('error', e instanceof Error ? e.message : 'Something went wrong') }), [c]);
}

// ───────────────────────── confirm dialog (optionally asks for a reason) ─────────────────────────
interface ConfirmOpts { title: string; message?: React.ReactNode; confirmLabel?: string; danger?: boolean; reason?: { label: string; required?: boolean; placeholder?: string } }
const ConfirmCtx = createContext<((o: ConfirmOpts) => Promise<{ ok: boolean; reason: string }>) | null>(null);
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: { ok: boolean; reason: string }) => void }) | null>(null);
  const [reason, setReason] = useState('');
  const ask = useCallback((o: ConfirmOpts) => new Promise<{ ok: boolean; reason: string }>((resolve) => { setReason(''); setState({ ...o, resolve }); }), []);
  const done = (ok: boolean) => { state?.resolve({ ok, reason: reason.trim() }); setState(null); };
  const missing = !!state?.reason?.required && !reason.trim();
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal open={!!state} onClose={() => done(false)} size="sm" title={state?.title ?? ''} footer={<>
        <Button onClick={() => done(false)}>Cancel</Button>
        <Button variant={state?.danger ? 'danger' : 'primary'} disabled={missing} onClick={() => done(true)}>{state?.confirmLabel ?? 'Confirm'}</Button>
      </>}>
        {state?.message && <div className="text-sm text-ink-700">{state.message}</div>}
        {state?.reason && <Field className="mt-3" label={state.reason.label} required={state.reason.required}><Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={state.reason.placeholder} maxLength={300} /></Field>}
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => { const c = useContext(ConfirmCtx); if (!c) throw new Error('useConfirm outside provider'); return c; };

// ───────────────────────── tabs ─────────────────────────
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number; hidden?: boolean }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-ink-200 no-print" role="tablist">
      {tabs.filter((t) => !t.hidden).map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition', value === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 rounded-full bg-ink-100 px-1.5 text-[11px] text-ink-600">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── tables ─────────────────────────
export interface Column<R> { key: string; label: React.ReactNode; sort?: string; render?: (r: R) => React.ReactNode; align?: 'right' | 'center'; className?: string; hideBelow?: 'sm' | 'md' | 'lg' }
const hide = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };

export function SimpleTable<R extends { id?: string }>({ rows, columns, onRow, empty, foot }: { rows: R[]; columns: Column<R>[]; onRow?: (r: R) => void; empty?: React.ReactNode; foot?: React.ReactNode }) {
  if (!rows.length) return <>{empty ?? <Empty title="Nothing to show yet" />}</>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead><tr>{columns.map((c) => <th key={c.key} className={cn('th', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.hideBelow && hide[c.hideBelow])}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i} className={cn('hover:bg-ink-50/70', onRow && 'cursor-pointer')} onClick={onRow ? () => onRow(r) : undefined}>
              {columns.map((c) => <td key={c.key} className={cn('td', c.align === 'right' && 'num', c.align === 'center' && 'text-center', c.hideBelow && hide[c.hideBelow], c.className)}>{c.render ? c.render(r) : (r as any)[c.key] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
        {foot && <tfoot>{foot}</tfoot>}
      </table>
    </div>
  );
}

export function Pager({ page, totalPages, total, pageSize, onPage, onPageSize }: { page: number; totalPages: number; total: number; pageSize: number; onPage: (p: number) => void; onPageSize?: (n: number) => void }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-3 py-2 text-xs text-ink-500 no-print">
      <span>{total === 0 ? 'No results' : `${from}–${Math.min(page * pageSize, total)} of ${total.toLocaleString('en-IN')}`}</span>
      <div className="flex items-center gap-2">
        {onPageSize && <select aria-label="Rows per page" className="input h-7 w-auto py-0 pr-7 text-xs" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}</select>}
        <Button size="icon" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
        <span className="tabular-nums">{page} / {Math.max(1, totalPages)}</span>
        <Button size="icon" variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input className="input pl-8" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={100} />
    </div>
  );
}

/** server-paginated, sortable, searchable table bound to a list endpoint */
export function DataTable<R extends { id?: string }>({
  url, params, columns, onRow, searchPlaceholder = 'Search…', toolbar, filters, reloadKey = 0, defaultSort, defaultDir = 'desc', pageSize: ps = 25, emptyTitle = 'Nothing here yet', emptyHint, emptyAction, summary, noSearch, initialSearch,
}: {
  url: string; params?: Record<string, string | number | boolean | null | undefined>; columns: Column<R>[]; onRow?: (r: R) => void; searchPlaceholder?: string; toolbar?: React.ReactNode; filters?: React.ReactNode;
  reloadKey?: number; defaultSort?: string; defaultDir?: 'asc' | 'desc'; pageSize?: number; emptyTitle?: string; emptyHint?: string; emptyAction?: React.ReactNode; summary?: (meta: Record<string, any>) => React.ReactNode; noSearch?: boolean; initialSearch?: string;
}) {
  const [q, setQ] = useState(initialSearch ?? '');
  const dq = useDebounced(q, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ps);
  const [sort, setSort] = useState<string | undefined>(defaultSort);
  const [dir, setDir] = useState<'asc' | 'desc'>(defaultDir);
  const key = JSON.stringify(params ?? {});
  useEffect(() => { setPage(1); }, [dq, key, pageSize]);
  const full = url + qs({ page, pageSize, q: dq || undefined, sort, dir, ...(params ?? {}) });
  const { data, meta, error, loading, reload } = useApi<R[]>(full);
  useEffect(() => { if (reloadKey) reload(); /* eslint-disable-next-line */ }, [reloadKey]);
  const total = meta?.total ?? 0;
  const toggle = (s?: string) => { if (!s) return; if (sort === s) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(s); setDir('asc'); } };
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-3 no-print">
        {!noSearch && <SearchBox value={q} onChange={setQ} placeholder={searchPlaceholder} className="w-full sm:w-64" />}
        {filters}
        <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>
      </div>
      {summary && meta && <div className="border-b border-ink-100 bg-ink-50/50 px-3 py-2 text-xs text-ink-600">{summary(meta)}</div>}
      {error ? <div className="p-4"><ErrorBox error={error} /><Button className="mt-2" size="sm" onClick={reload}>Retry</Button></div>
        : !data ? <Loading />
        : data.length === 0 ? <Empty title={dq ? 'No matches' : emptyTitle} hint={dq ? 'Try a different search.' : emptyHint} action={dq ? undefined : emptyAction} />
        : (
          <div className={cn('overflow-x-auto transition-opacity', loading && 'opacity-60')}>
            <table className="w-full border-collapse">
              <thead><tr>{columns.map((c) => (
                <th key={c.key} className={cn('th', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.hideBelow && hide[c.hideBelow], c.sort && 'cursor-pointer select-none hover:text-ink-800')} onClick={() => toggle(c.sort)} aria-sort={sort === c.sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <span className="inline-flex items-center gap-1">{c.label}{c.sort && sort === c.sort && (dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}</span>
                </th>))}</tr></thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={r.id ?? i} className={cn('hover:bg-ink-50/70', onRow && 'cursor-pointer')} onClick={onRow ? () => onRow(r) : undefined}>
                    {columns.map((c) => <td key={c.key} className={cn('td', c.align === 'right' && 'num', c.align === 'center' && 'text-center', c.hideBelow && hide[c.hideBelow], c.className)}>{c.render ? c.render(r) : (r as any)[c.key] ?? '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {data && data.length > 0 && <Pager page={page} totalPages={meta?.totalPages ?? 1} total={total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />}
    </div>
  );
}

/** label/value list */
export function DL({ items }: { items: [React.ReactNode, React.ReactNode][] }) {
  return <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">{items.map(([k, v], i) => <div key={i} className="contents"><dt className="text-ink-500">{k}</dt><dd className="text-ink-900">{v ?? '—'}</dd></div>)}</dl>;
}
