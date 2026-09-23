'use client';
import { useRef, useState } from 'react';
import { Download, FileText, Paperclip, Trash2 } from 'lucide-react';
import { api } from '@/ui/api';
import { useApi } from '@/ui/hooks';
import { Button, Card, CardHeader, Empty, ErrorBox, useConfirm, useToast } from '@/ui/kit';
import { ago } from '@/ui/format';

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Files attached to any entity: upload (validated server-side), authorised download, remove */
export function Attachments({ entityType, entityId, canWrite = true, compact }: { entityType: string; entityId: string; canWrite?: boolean; compact?: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const { data, error, reload } = useApi<any[]>(`/api/attachments?entityType=${entityType}&entityId=${entityId}`);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try { const fd = new FormData(); fd.set('file', file); fd.set('entityType', entityType); fd.set('entityId', entityId); await api.upload('/api/attachments', fd); toast.success('File uploaded'); reload(); }
    catch (e) { toast.fail(e); }
    setBusy(false); if (input.current) input.current.value = '';
  };
  const remove = async (a: any) => { const c = await confirm({ title: 'Remove file?', message: a.fileName, danger: true, confirmLabel: 'Remove' }); if (!c.ok) return; try { await api.del(`/api/attachments/${a.id}`); reload(); } catch (e) { toast.fail(e); } };
  const body = (
    <>
      <ErrorBox error={error} />
      {!data?.length ? (compact ? null : <Empty title="No files attached" hint="Upload contracts, invoices, receipts or quotations (PDF, images, Office documents, CSV)." />) : (
        <ul className="divide-y divide-ink-100">{data.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-2">
            <FileText className="h-4 w-4 shrink-0 text-ink-400" />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink-900">{a.fileName}</p><p className="text-xs text-ink-500">{size(a.sizeBytes)} · {a.uploadedBy ?? 'Unknown'} · {ago(a.createdAt)}</p></div>
            <Button size="icon" variant="ghost" aria-label={`Download ${a.fileName}`} onClick={() => api.download(`/api/attachments/${a.id}`, a.fileName).catch(toast.fail)}><Download className="h-4 w-4" /></Button>
            {canWrite && <Button size="icon" variant="ghost" aria-label={`Remove ${a.fileName}`} onClick={() => remove(a)}><Trash2 className="h-4 w-4" /></Button>}
          </li>))}</ul>)}
    </>
  );
  const upBtn = canWrite && <><input ref={input} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /><Button size="sm" icon={<Paperclip className="h-4 w-4" />} loading={busy} onClick={() => input.current?.click()}>Attach file</Button></>;
  if (compact) return <div>{(data?.length ?? 0) > 0 && <h3 className="mb-1">Files</h3>}{body}{upBtn}</div>;
  return <Card><CardHeader title="Files" right={upBtn} />{body}</Card>;
}
