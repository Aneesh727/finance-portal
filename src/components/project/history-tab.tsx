'use client';
import { useState } from 'react';
import { useApi } from '@/ui/hooks';
import { Card, CardHeader, Empty, ErrorBox, Loading, Pager } from '@/ui/kit';
import { dateTime } from '@/ui/format';

export function HistoryTab({ projectId }: { projectId: string }) {
  const [page, setPage] = useState(1);
  const { data, meta, error } = useApi<any[]>(`/api/projects/${projectId}/history?page=${page}&pageSize=25`);
  return (
    <Card pad={false}>
      <div className="p-4 pb-2"><CardHeader title="Change history" sub="Every edit, approval and payment on this project, newest first" /></div>
      <ErrorBox error={error} className="m-4" />
      {!data ? (error ? null : <Loading />) : data.length === 0 ? <Empty title="No history yet" /> : (
        <ol className="divide-y divide-ink-100">
          {data.map((h) => (
            <li key={h.id} className="px-4 py-2.5"><p className="text-sm text-ink-900">{h.summary}</p><p className="text-xs text-ink-500">{dateTime(h.at)} · {h.user ?? 'System'} · <span className="font-mono">{h.action}</span></p></li>
          ))}
        </ol>)}
      {data && meta && <Pager page={page} totalPages={meta.totalPages} total={meta.total} pageSize={25} onPage={setPage} />}
    </Card>
  );
}
