'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Bell, Info, ShieldAlert } from 'lucide-react';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Tabs, Pager, useToast } from '@/ui/kit';
import { useApi } from '@/ui/hooks';
import { api, qs } from '@/ui/api';
import { ago, dateTime } from '@/ui/format';
import { useSession } from '@/ui/session';

const ICON: Record<string, React.ReactNode> = { critical: <ShieldAlert className="h-4 w-4 text-red-600" />, warning: <AlertTriangle className="h-4 w-4 text-amber-600" />, info: <Info className="h-4 w-4 text-brand-600" /> };

export default function NotificationsPage() {
  const toast = useToast();
  const { can } = useSession();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const { data, meta, error, loading, reload } = useApi<any[]>(`/api/notifications${qs({ unread: tab === 'unread' ? '1' : '0', page, pageSize: 20 })}`);
  const done = () => reload();
  const readAll = async () => { try { await api.post('/api/notifications/read', { all: true }); toast.success('All marked as read'); done(); } catch (e) { toast.fail(e); } };
  const readOne = async (id: string) => { try { await api.post('/api/notifications/read', { ids: [id] }); done(); } catch (e) { toast.fail(e); } };
  const scan = async () => { try { const r = await api.post<{ created: number }>('/api/notifications/scan', {}); toast.success(`Scan finished — ${r.data?.created ?? 0} new alert(s)`); done(); } catch (e) { toast.fail(e); } };
  return (
    <>
      <PageHeader title="Notifications" sub={meta?.unread ? `${meta.unread} unread` : 'You are all caught up'}
        actions={<>{(can('settings.manage') || can('approvals.decide')) && <Button onClick={scan}>Run alert scan</Button>}<Button onClick={readAll} disabled={!meta?.unread}>Mark all read</Button></>} />
      <Tabs tabs={[{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread', count: meta?.unread }]} value={tab} onChange={(t) => { setTab(t); setPage(1); }} />
      <Card pad={false} className="mt-3">
        {error ? <div className="p-4"><ErrorBox error={error} /></div> : !data ? <Loading /> : data.length === 0 ? <Empty title={tab === 'unread' ? 'No unread notifications' : 'No notifications'} hint="Budget, overdue-payment and approval alerts show up here." /> : (
          <ul className={loading ? 'opacity-60' : ''}>
            {data.map((n) => (
              <li key={n.id} className={`flex items-start gap-3 border-b border-ink-100 px-4 py-3 last:border-0 ${n.read ? '' : 'bg-brand-50/40'}`}>
                <span className="mt-0.5">{ICON[n.severity] ?? <Bell className="h-4 w-4 text-ink-500" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink-900">{n.link ? <Link href={n.link} onClick={() => !n.read && readOne(n.id)} className="hover:underline">{n.title}</Link> : n.title}</div>
                  {n.body && <div className="text-sm text-ink-600">{n.body}</div>}
                  <div className="text-xs text-ink-500" title={dateTime(n.createdAt)}>{ago(n.createdAt)}</div>
                </div>
                {!n.read && <Button size="sm" variant="ghost" onClick={() => readOne(n.id)}>Mark read</Button>}
              </li>))}
          </ul>)}
        {data && data.length > 0 && <Pager page={page} totalPages={meta?.totalPages ?? 1} total={meta?.total ?? 0} pageSize={20} onPage={setPage} />}
      </Card>
    </>
  );
}
