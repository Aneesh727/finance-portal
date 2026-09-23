'use client';
/** Config-driven CRUD: table + create/edit modal + archive/restore. Used for clients, vendors, resources and simple reference data. */
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { Badge, Button, DataTable, Field, Input, MoneyInput, Select, Textarea, useConfirm, useForm, useToast, type Column } from '@/ui/kit';
import { useSession } from '@/ui/session';
import { FormModal } from '@/components/form-modal';
import { RowActions } from '@/components/row-actions';
import { ExportMenu } from '@/components/export-menu';

export interface FieldDef {
  key: string; label: string; type?: 'text' | 'email' | 'textarea' | 'select' | 'money' | 'date' | 'number' | 'tel'; required?: boolean; options?: { value: string; label: string }[]; hint?: string; wide?: boolean;
  maxLength?: number; default?: string; showIf?: (v: Record<string, any>) => boolean; pattern?: RegExp; patternMsg?: string; upper?: boolean;
}
export interface CrudConfig {
  noun: string; plural: string; url: string; exportDataset?: string; manage: string; view: string; versioned?: boolean;
  fields: FieldDef[]; columns: Column<any>[]; searchPlaceholder: string; emptyHint: string; nameKey: string;
  extraFilters?: (f: Record<string, string>, set: (k: string, v: string) => void) => React.ReactNode; filterDefaults?: Record<string, string>;
  onRow?: (r: any) => void; hideArchived?: boolean; initialSearch?: string; toBody?: (v: Record<string, any>) => Record<string, unknown>; fromRow?: (r: any) => Record<string, any>; extraActions?: (r: any, reload: () => void) => import('./row-actions').RowAction[];
}

export function CrudPage({ cfg }: { cfg: CrudConfig }) {
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [key, setKey] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({ archived: '0', ...(cfg.filterDefaults ?? {}) });
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const manage = can(cfg.manage);
  const reload = () => setKey((k) => k + 1);
  const archive = async (r: any, restore: boolean) => {
    if (!restore) { const c = await confirm({ title: `Archive ${r[cfg.nameKey]}?`, message: `It will be hidden from pickers and lists. Existing records are kept and you can restore it any time.`, confirmLabel: 'Archive', danger: true }); if (!c.ok) return; }
    try { await api.post(`${cfg.url}/${r.id}/${restore ? 'restore' : 'archive'}`, {}); toast.success(restore ? `${cfg.noun} restored` : `${cfg.noun} archived`); reload(); } catch (e) { toast.fail(e); }
  };
  const cols: Column<any>[] = [
    ...cfg.columns,
    { key: 'actions', label: '', render: (r) => manage ? <RowActions actions={[{ label: 'Edit', onClick: () => setEdit(r), hidden: !!r.archivedAt }, ...(cfg.extraActions?.(r, reload) ?? []), { label: r.archivedAt ? 'Restore' : 'Archive', danger: !r.archivedAt, onClick: () => archive(r, !!r.archivedAt) }]} /> : null },
  ];
  return (
    <>
      <DataTable<any> url={cfg.url} params={filters} reloadKey={key} columns={cols} defaultSort="name" defaultDir="asc" searchPlaceholder={cfg.searchPlaceholder} onRow={cfg.onRow} initialSearch={cfg.initialSearch}
        emptyTitle={`No ${cfg.plural} yet`} emptyHint={cfg.emptyHint} emptyAction={manage ? <Button variant="primary" onClick={() => setEdit('new')}>Add {cfg.noun}</Button> : undefined}
        filters={<>{cfg.extraFilters?.(filters, (k, v) => setFilters({ ...filters, [k]: v }))}{!cfg.hideArchived && <Select className="w-32" aria-label="Archived" value={filters.archived} onChange={(e) => setFilters({ ...filters, archived: e.target.value })}><option value="0">Active</option><option value="1">Archived</option><option value="all">All</option></Select>}</>}
        toolbar={<>{cfg.exportDataset && <ExportMenu dataset={cfg.exportDataset} />}{manage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Add {cfg.noun}</Button>}</>} />
      <CrudForm cfg={cfg} row={edit && edit !== 'new' ? edit : null} open={!!edit} onClose={() => setEdit(null)} onSaved={reload} />
    </>
  );
}

export function CrudForm({ cfg, row, open, onClose, onSaved }: { cfg: CrudConfig; row: any | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const blank = Object.fromEntries(cfg.fields.map((f) => [f.key, f.default ?? '']));
  const f = useForm<Record<string, any>>(blank);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  useEffect(() => { if (open) { f.reset(row ? (cfg.fromRow ? cfg.fromRow(row) : Object.fromEntries(cfg.fields.map((fd) => [fd.key, row[fd.key] ?? '']))) : blank); setError(null); } /* eslint-disable-next-line */ }, [open, row?.id]);
  const v = f.values;
  const submit = async () => {
    const e: Record<string, string> = {};
    for (const fd of cfg.fields) {
      if (fd.showIf && !fd.showIf(v)) continue;
      const val = String(v[fd.key] ?? '').trim();
      if (fd.required && !val) e[fd.key] = 'Required';
      else if (val && fd.type === 'email' && !/^\S+@\S+\.\S+$/.test(val)) e[fd.key] = 'Enter a valid email address';
      else if (val && fd.pattern && !fd.pattern.test(fd.upper ? val.toUpperCase() : val)) e[fd.key] = fd.patternMsg ?? 'Invalid format';
      else if (val && (fd.type === 'money' || fd.type === 'number') && Number.isNaN(Number(val))) e[fd.key] = 'Enter a number';
    }
    if (Object.keys(e).length) { f.setErrors(e); return; }
    setBusy(true); setError(null);
    let body: Record<string, unknown> = {};
    for (const fd of cfg.fields) { if (fd.showIf && !fd.showIf(v)) continue; const raw = String(v[fd.key] ?? '').trim(); body[fd.key] = raw === '' ? (fd.type === 'money' ? '0' : null) : fd.upper ? raw.toUpperCase() : raw; }
    if (cfg.toBody) body = cfg.toBody({ ...v, ...body });
    if (row && cfg.versioned) body.version = row.version;
    try { if (row) await api.patch(`${cfg.url}/${row.id}`, body); else await api.post(cfg.url, body); toast.success(`${cfg.noun[0].toUpperCase()}${cfg.noun.slice(1)} ${row ? 'updated' : 'created'}`); onSaved(); onClose(); }
    catch (err) { setError(err as ApiFail); f.fail(err); }
    setBusy(false);
  };
  return (
    <FormModal open={open} onClose={onClose} title={row ? `Edit ${cfg.noun}` : `Add ${cfg.noun}`} onSubmit={submit} busy={busy} error={error} size="lg">
      <div className="grid gap-4 sm:grid-cols-2">
        {cfg.fields.filter((fd) => !fd.showIf || fd.showIf(v)).map((fd) => (
          <Field key={fd.key} label={fd.label} required={fd.required} error={f.errors[fd.key]} hint={fd.hint} className={fd.wide || fd.type === 'textarea' ? 'sm:col-span-2' : ''}>
            {fd.type === 'textarea' ? <Textarea {...f.bind(fd.key)} rows={2} maxLength={fd.maxLength ?? 2000} invalid={!!f.errors[fd.key]} />
              : fd.type === 'select' ? <Select {...f.bind(fd.key)}>{!fd.required && <option value="">—</option>}{fd.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
              : fd.type === 'money' ? <MoneyInput value={String(v[fd.key] ?? '')} onChange={(x) => f.set(fd.key, x)} invalid={!!f.errors[fd.key]} />
              : <Input {...f.bind(fd.key)} type={fd.type === 'email' ? 'email' : fd.type === 'date' ? 'date' : fd.type === 'tel' ? 'tel' : 'text'} inputMode={fd.type === 'number' ? 'decimal' : undefined} maxLength={fd.maxLength ?? 200} className={fd.upper ? 'uppercase' : undefined} />}
          </Field>))}
      </div>
    </FormModal>
  );
}
export { Badge };
