'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Badge, Button, DataTable, PageHeader, Select, Tabs, useConfirm, useToast, type Column } from '@/ui/kit';
import { api } from '@/ui/api';
import { ago, dateTime, money, title } from '@/ui/format';
import { useSession } from '@/ui/session';
import { Guard } from '@/components/guard';

const TONE: Record<string, 'amber' | 'green' | 'red' | 'gray'> = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', CANCELLED: 'gray' };

export default function ApprovalsPage() { return <Guard any={['approvals.decide', 'projects.view']}><Approvals /></Guard>; }

function Approvals() {
  const { can, me: session } = useSession();
  const me = session.user;
  const toast = useToast();
  const confirm = useConfirm();
  const approver = can('approvals.decide');
  const [status, setStatus] = useState('PENDING');
  const [mine, setMine] = useState<'0' | '1'>(approver ? '0' : '1');
  const [key, setKey] = useState(0);
  const reload = () => setKey((k) => k + 1);

  const decide = async (r: any, decision: 'APPROVED' | 'REJECTED') => {
    const c = await confirm({
      title: `${decision === 'APPROVED' ? 'Approve' : 'Reject'} request?`,
      message: <span><b>{r.title}</b>{r.amount ? <> · {money(r.amount, r.currency)}</> : null}<br />Requested by {r.requestedBy}. {r.reason ? `Reason given: "${r.reason}"` : ''}</span>,
      confirmLabel: decision === 'APPROVED' ? 'Approve' : 'Reject', danger: decision === 'REJECTED',
      reason: { label: decision === 'REJECTED' ? 'Reason for rejection' : 'Note (optional)', required: decision === 'REJECTED', placeholder: 'Visible to the requester' },
    });
    if (!c.ok) return;
    try { await api.post(`/api/approvals/${r.id}/decide`, { decision, note: c.reason || undefined }); toast.success(decision === 'APPROVED' ? 'Approved — the change has been applied' : 'Request rejected'); reload(); } catch (e) { toast.fail(e); }
  };
  const cancel = async (r: any) => {
    const c = await confirm({ title: 'Cancel this request?', message: 'The change will not be applied.', confirmLabel: 'Cancel request', danger: true });
    if (!c.ok) return;
    try { await api.post(`/api/approvals/${r.id}/cancel`, {}); toast.success('Request cancelled'); reload(); } catch (e) { toast.fail(e); }
  };

  const cols: Column<any>[] = [
    { key: 'title', label: 'Request', render: (r) => (
      <span><span className="font-medium text-ink-900">{r.title}</span><span className="block text-xs text-ink-500">{title(r.type)}{r.projectId && <> · <Link className="text-brand-700 hover:underline" href={`/projects/${r.projectId}`}>{r.projectCode}</Link></>}</span>{r.reason && <span className="block max-w-md text-xs text-ink-600">“{r.reason}”</span>}</span>) },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => (r.amount ? money(r.amount, r.currency) : '—') },
    { key: 'requestedBy', label: 'Requested by', hideBelow: 'md', render: (r) => <span>{r.requestedBy}<span className="block text-xs text-ink-500" title={dateTime(r.createdAt)}>{ago(r.createdAt)}</span></span> },
    { key: 'status', label: 'Status', render: (r) => <span><Badge tone={TONE[r.status]}>{title(r.status)}</Badge>{r.decidedBy && <span className="block text-xs text-ink-500">{r.decidedBy}{r.decisionNote ? ` — ${r.decisionNote}` : ''}</span>}</span> },
    { key: 'actions', label: '', render: (r) => (
      <span className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
        {r.canDecide && <><Button size="sm" variant="primary" onClick={() => decide(r, 'APPROVED')}>Approve</Button><Button size="sm" onClick={() => decide(r, 'REJECTED')}>Reject</Button></>}
        {r.status === 'PENDING' && r.requestedById === me?.id && <Button size="sm" variant="ghost" onClick={() => cancel(r)}>Cancel</Button>}
        {r.status === 'PENDING' && approver && r.requestedById === me?.id && <span className="self-center text-xs text-ink-500">Needs another approver</span>}
      </span>) },
  ];
  return (
    <>
      <PageHeader title="Approvals" sub="Requests that need sign-off before they take effect" />
      <Tabs tabs={[{ id: 'PENDING', label: 'Pending' }, { id: 'APPROVED', label: 'Approved' }, { id: 'REJECTED', label: 'Rejected' }, { id: 'CANCELLED', label: 'Cancelled' }, { id: 'ALL', label: 'All' }]} value={status} onChange={setStatus} />
      <div className="mt-3">
        <DataTable<any> url="/api/approvals" params={{ status: status === 'ALL' ? undefined : status, mine }} reloadKey={key} columns={cols} noSearch
          emptyTitle={status === 'PENDING' ? 'Nothing waiting for approval' : 'No requests'} emptyHint="Requests appear here when someone adds a cost or change that exceeds a budget or threshold."
          filters={approver ? <Select className="w-40" aria-label="Scope" value={mine} onChange={(e) => setMine(e.target.value as '0' | '1')}><option value="0">All requests</option><option value="1">My requests</option></Select> : undefined} />
      </div>
    </>
  );
}
