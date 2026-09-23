'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, DataTable, Input, Modal, PageHeader, Select, Button, type Column } from '@/ui/kit';
import { dateTime } from '@/ui/format';
import { Guard } from '@/components/guard';
import { ExportMenu } from '@/components/export-menu';

const ENTITIES = ['project', 'client', 'cost', 'expense', 'invoice', 'payment', 'user', 'role', 'settings', 'approval', 'retainer', 'deal', 'resource', 'vendor', 'category', 'attachment', 'import', 'export', 'backup', 'auth'];
const tone = (a: string) => (/delete|void|remove|reject|fail|lock|cancel/.test(a) ? 'red' : /create|add|approve|import|login/.test(a) ? 'green' : /update|edit|change|reset/.test(a) ? 'blue' : 'gray');

export default function AuditPage() { return <Guard any={['audit.view']}><Audit /></Guard>; }

function Audit() {
  const [f, setF] = useState({ entityType: '', action: '', from: '', to: '' });
  const [open, setOpen] = useState<any | null>(null);
  const cols: Column<any>[] = [
    { key: 'at', label: 'When', className: 'whitespace-nowrap', render: (r) => dateTime(String(r.at)) },
    { key: 'user', label: 'User', hideBelow: 'md', render: (r) => r.user ?? <span className="text-ink-400">system</span> },
    { key: 'action', label: 'Action', render: (r) => <Badge tone={tone(r.action) as any}>{r.action}</Badge> },
    { key: 'summary', label: 'Summary', render: (r) => <span className="line-clamp-2 max-w-xl">{r.summary}</span> },
    { key: 'view', label: '', render: (r) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setOpen(r); }}>Details</Button> },
  ];
  return (
    <>
      <PageHeader title="Audit log" sub="An append-only record of who changed what. Entries cannot be edited or deleted." />
      <DataTable<any> url="/api/audit" params={f} columns={cols} noSearch={false} searchPlaceholder="Search summary or user…" onRow={setOpen} pageSize={50}
        filters={<>
          <Select className="w-36" aria-label="Entity" value={f.entityType} onChange={(e) => setF({ ...f, entityType: e.target.value })}><option value="">All entities</option>{ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}</Select>
          <Input className="w-36" aria-label="Action" placeholder="Action, e.g. cost." value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} />
          <Input className="w-36" type="date" aria-label="From" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          <Input className="w-36" type="date" aria-label="To" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </>}
        toolbar={<ExportMenu dataset="audit" params={{ from: f.from || undefined, to: f.to || undefined }} />}
        emptyTitle="No audit entries" emptyHint="Actions will appear here as people use the portal." />
      <Detail row={open} onClose={() => setOpen(null)} />
    </>
  );
}

const HIDE = new Set(['updatedAt', 'createdAt', 'version', 'passwordHash']);
function diff(o: any, n: any) {
  const keys = [...new Set([...Object.keys(o ?? {}), ...Object.keys(n ?? {})])].filter((k) => !HIDE.has(k));
  return keys.map((k) => ({ k, o: o?.[k], n: n?.[k] })).filter((x) => JSON.stringify(x.o) !== JSON.stringify(x.n) || (!o && n));
}
const show = (v: unknown) => (v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function Detail({ row, onClose }: { row: any | null; onClose: () => void }) {
  const changes = useMemo(() => (row ? diff(row.old, row.new) : []), [row]);
  return (
    <Modal open={!!row} onClose={onClose} size="lg" title="Audit entry" footer={<Button onClick={onClose}>Close</Button>}>
      {row && (
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
            <dt className="text-ink-500">When</dt><dd>{dateTime(String(row.at))}</dd>
            <dt className="text-ink-500">User</dt><dd>{row.user ?? 'system'}</dd>
            <dt className="text-ink-500">Action</dt><dd><Badge tone={tone(row.action) as any}>{row.action}</Badge></dd>
            <dt className="text-ink-500">Entity</dt><dd>{row.entityType}{row.entityId ? <span className="ml-1 font-mono text-xs text-ink-500">{row.entityId}</span> : null}</dd>
            {row.projectId && <><dt className="text-ink-500">Project</dt><dd><Link className="link" href={`/projects/${row.projectId}`}>Open project</Link></dd></>}
            <dt className="text-ink-500">IP</dt><dd>{row.ip ?? '—'}</dd>
            <dt className="text-ink-500">Summary</dt><dd>{row.summary}</dd>
          </dl>
          {changes.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-ink-200">
              <table className="w-full text-xs"><thead><tr><th className="th">Field</th><th className="th">Before</th><th className="th">After</th></tr></thead>
                <tbody>{changes.map((c) => <tr key={c.k}><td className="td font-medium">{c.k}</td><td className="td break-all text-red-700">{show(c.o)}</td><td className="td break-all text-emerald-700">{show(c.n)}</td></tr>)}</tbody></table>
            </div>)}
        </div>)}
    </Modal>
  );
}
