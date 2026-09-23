'use client';
import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { Badge, Button, Card, CardHeader, Check, ErrorBox, Field, Notice, PageHeader, Select, SimpleTable, Stat, useConfirm, useToast, type Column } from '@/ui/kit';
import { useSession } from '@/ui/session';
import { Guard } from '@/components/guard';

const KINDS: { id: string; label: string; perm: string; hint: string }[] = [
  { id: 'CLIENTS', label: 'Clients', perm: 'clients.manage', hint: 'Company name, contact, GSTIN, currency…' },
  { id: 'RESOURCES', label: 'Resources / employees', perm: 'resources.manage', hint: 'Employees, freelancers, agencies with cost rates' },
  { id: 'PROJECTS', label: 'Projects', perm: 'projects.create', hint: 'Projects with client, service, dates, selling price and budget' },
  { id: 'COSTS', label: 'Project costs', perm: 'costs.create', hint: 'Actual costs against existing project codes' },
  { id: 'EXPENSES', label: 'Company expenses', perm: 'expenses.create', hint: 'Rent, software, salaries and other overhead' },
];
const TONE = { valid: 'green', invalid: 'red', duplicate: 'amber' } as const;

export default function ImportPage() { return <Guard any={['import.run']}><Importer /></Guard>; }

function Importer() {
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const kinds = KINDS.filter((k) => can(k.perm));
  const [kind, setKind] = useState(kinds[0]?.id ?? 'CLIENTS');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => { setFile(null); setPreview(null); setResult(null); setError(null); setSkipInvalid(false); if (input.current) input.current.value = ''; };
  const form = (extra: Record<string, string> = {}) => { const f = new FormData(); f.set('kind', kind); f.set('file', file!); for (const [k, v] of Object.entries(extra)) f.set(k, v); return f; };

  const validate = async () => {
    if (!file) return;
    setBusy(true); setError(null); setPreview(null); setResult(null);
    try { setPreview((await api.upload('/api/import/validate', form())).data); } catch (e) { setError(e as ApiFail); }
    setBusy(false);
  };
  const commit = async (allowReimport = false) => {
    setBusy(true); setError(null);
    try {
      const r = await api.upload('/api/import/commit', form({ batchId: preview.batchId, skipInvalid: String(skipInvalid), allowReimport: String(allowReimport) }));
      setResult(r.data); setPreview(null); toast.success(`${r.data.inserted} record(s) imported`);
    } catch (e) {
      const err = e as ApiFail;
      if (err.code === 'ALREADY_IMPORTED') {
        const c = await confirm({ title: 'Import this file again?', message: err.message, confirmLabel: 'Import again', danger: true });
        if (c.ok) { await commit(true); return; }
      } else setError(err);
    }
    setBusy(false);
  };
  const template = async () => { try { await api.download(`/api/import/template?kind=${kind}`, `${kind.toLowerCase()}-template.csv`); } catch (e) { toast.fail(e); } };

  const cols: Column<any>[] = [
    { key: 'row', label: 'Row', className: 'w-14' },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={TONE[r.status as keyof typeof TONE]}>{r.status}</Badge> },
    { key: 'data', label: 'Data', render: (r) => <span className="line-clamp-1 max-w-md text-xs text-ink-600">{Object.values(r.data).filter(Boolean).slice(0, 4).join(' · ')}</span> },
    { key: 'errors', label: 'Problems', render: (r) => (r.errors.length ? <ul className="text-xs text-red-700">{r.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul> : <span className="text-ink-400">—</span>) },
  ];
  const t = preview?.totals;
  const blocked = !!t && t.invalid > 0 && !skipInvalid;
  return (
    <>
      <PageHeader title="Import data" sub="Bring existing records in from CSV or Excel. Nothing is saved until you confirm." />
      <div className="space-y-4">
        <Card>
          <CardHeader title="1. Choose what to import" />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Data type" hint={KINDS.find((k) => k.id === kind)?.hint}>
              <Select value={kind} onChange={(e) => { setKind(e.target.value); reset(); }}>{kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select>
            </Field>
            <div className="flex items-end"><Button icon={<Download className="h-4 w-4" />} onClick={template}>Download CSV template</Button></div>
            <Field label="File (.csv or .xlsx)" className="md:col-span-2">
              <div className="flex flex-wrap items-center gap-3">
                <input ref={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="block text-sm file:mr-3 file:rounded-lg file:border file:border-ink-200 file:bg-white file:px-3 file:py-1.5 file:text-sm hover:file:bg-ink-50"
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); setError(null); }} />
                <Button variant="primary" icon={<Upload className="h-4 w-4" />} disabled={!file} loading={busy && !preview} onClick={validate}>Check file</Button>
              </div>
            </Field>
          </div>
          <p className="mt-3 text-xs text-ink-500">Cells that start with = + - @ are rejected to prevent spreadsheet-formula injection. Duplicates (already in the system or repeated in the file) are skipped automatically.</p>
        </Card>
        <ErrorBox error={error} />
        {preview && (
          <Card>
            <CardHeader title="2. Review" sub={preview.fileName} right={<Button variant="ghost" onClick={reset}>Start over</Button>} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Rows in file" value={String(t.rows)} icon={<FileSpreadsheet className="h-4 w-4" />} />
              <Stat label="Ready to import" value={String(t.valid)} tone="good" />
              <Stat label="Duplicates (skipped)" value={String(t.duplicates)} tone={t.duplicates ? 'warn' : 'neutral'} />
              <Stat label="Rows with errors" value={String(t.invalid)} tone={t.invalid ? 'bad' : 'neutral'} />
            </div>
            {preview.ignoredColumns?.length > 0 && <Notice className="mt-3" tone="warn">These columns are not recognised and will be ignored: {preview.ignoredColumns.join(', ')}</Notice>}
            {preview.alreadyImportedOn && <Notice className="mt-3" tone="warn">This exact file was already imported on {String(preview.alreadyImportedOn).slice(0, 10)}. You will be asked to confirm before it is imported again.</Notice>}
            <div className="mt-3 overflow-hidden rounded-lg border border-ink-200"><SimpleTable rows={preview.rows.map((r: any) => ({ ...r, id: String(r.row) }))} columns={cols} /></div>
            {preview.truncated && <p className="mt-2 text-xs text-ink-500">Showing the first 500 rows. All rows are validated and imported.</p>}
            <div className="mt-4 flex flex-wrap items-center gap-4">
              {t.invalid > 0 && <Check checked={skipInvalid} onChange={setSkipInvalid} label={`Skip the ${t.invalid} invalid row(s) and import the rest`} />}
              <Button variant="primary" loading={busy} disabled={blocked || t.valid === 0} onClick={() => commit(false)}>Import {t.valid} record{t.valid === 1 ? '' : 's'}</Button>
              {blocked && <span className="text-xs text-red-600">Fix the errors in your file and check it again, or choose to skip invalid rows.</span>}
            </div>
          </Card>)}
        {result && (
          <Card>
            <CardHeader title="Import finished" right={<Button onClick={reset}>Import another file</Button>} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Imported" value={String(result.inserted)} tone="good" />
              <Stat label="Duplicates skipped" value={String(result.duplicates)} />
              <Stat label="Invalid skipped" value={String(result.invalid)} />
              <Stat label="Failed" value={String(result.failed?.length ?? 0)} tone={result.failed?.length ? 'bad' : 'neutral'} />
            </div>
            {result.failed?.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-red-700">{result.failed.map((f: any) => <li key={f.row}>Row {f.row}: {f.error}</li>)}</ul>}
          </Card>)}
      </div>
    </>
  );
}
