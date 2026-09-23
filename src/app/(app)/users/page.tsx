'use client';
import { useEffect, useState } from 'react';
import { Plus, Wand2 } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { Badge, Button, Card, Check, DataTable, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, Tabs, Textarea, useConfirm, useForm, useToast, type Column } from '@/ui/kit';
import { useApi } from '@/ui/hooks';
import { ago, dateTime } from '@/ui/format';
import { useSession } from '@/ui/session';
import { Guard } from '@/components/guard';
import { FormModal } from '@/components/form-modal';
import { RowActions } from '@/components/row-actions';

export default function UsersPage() { return <Guard any={['users.manage', 'roles.manage']}><Users /></Guard>; }

function genPassword() {
  const pick = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const all = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%*?';
  const chars = [pick('abcdefghijkmnpqrstuvwxyz'), pick('ABCDEFGHJKLMNPQRSTUVWXYZ'), pick('23456789'), pick('!@#$%*?')];
  while (chars.length < 14) chars.push(pick(all));
  return chars.sort(() => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 - 0.5).join('');
}

function Users() {
  const { can } = useSession();
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  return (
    <>
      <PageHeader title="Users & roles" sub="Who can sign in and what they are allowed to do" />
      <Tabs tabs={[{ id: 'users', label: 'Users', hidden: !can('users.manage') }, { id: 'roles', label: 'Roles & permissions' }]} value={can('users.manage') ? tab : 'roles'} onChange={setTab} />
      <div className="mt-4">{tab === 'roles' || !can('users.manage') ? <Roles /> : <UserList />}</div>
    </>
  );
}

// ───────────── users ─────────────
function UserList() {
  const { me } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [key, setKey] = useState(0);
  const [active, setActive] = useState('all');
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const [reset, setReset] = useState<any | null>(null);
  const reload = () => setKey((k) => k + 1);
  const toggle = async (u: any) => {
    if (u.active) { const c = await confirm({ title: `Deactivate ${u.name}?`, message: 'They will be signed out immediately and cannot sign in until reactivated. Their history is kept.', confirmLabel: 'Deactivate', danger: true }); if (!c.ok) return; }
    try { await api.patch(`/api/users/${u.id}`, { active: !u.active }); toast.success(u.active ? 'User deactivated' : 'User activated'); reload(); } catch (e) { toast.fail(e); }
  };
  const unlock = async (u: any) => { try { await api.patch(`/api/users/${u.id}`, { unlock: true }); toast.success('Account unlocked'); reload(); } catch (e) { toast.fail(e); } };
  const cols: Column<any>[] = [
    { key: 'name', label: 'User', sort: 'name', render: (u) => <span><span className="font-medium text-ink-900">{u.name}</span>{u.id === me.user.id && <Badge tone="blue" className="ml-2">You</Badge>}<span className="block text-xs text-ink-500">{u.email}</span></span> },
    { key: 'role', label: 'Role', render: (u) => <Badge tone={u.roleKey === 'SUPER_ADMIN' ? 'purple' : 'gray'}>{u.roleName}</Badge> },
    { key: 'status', label: 'Status', render: (u) => (<span className="space-x-1">{u.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}{u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge tone="red">Locked</Badge>}{u.mustChangePw && <Badge tone="amber">Must change password</Badge>}</span>) },
    { key: 'lastLoginAt', label: 'Last sign-in', sort: 'lastLoginAt', hideBelow: 'md', render: (u) => (u.lastLoginAt ? <span title={dateTime(u.lastLoginAt)}>{ago(u.lastLoginAt)}</span> : <span className="text-ink-400">Never</span>) },
    { key: 'actions', label: '', render: (u) => <RowActions actions={[
      { label: 'Edit', onClick: () => setEdit(u) }, { label: 'Reset password', onClick: () => setReset(u) },
      { label: 'Unlock account', onClick: () => unlock(u), hidden: !(u.lockedUntil && new Date(u.lockedUntil) > new Date()) },
      { label: u.active ? 'Deactivate' : 'Activate', danger: u.active, onClick: () => toggle(u), hidden: u.id === me.user.id },
    ]} /> },
  ];
  return (
    <>
      <DataTable<any> url="/api/users" params={{ active }} reloadKey={key} columns={cols} defaultSort="name" defaultDir="asc" searchPlaceholder="Search name or email…"
        filters={<Select className="w-32" aria-label="Status" value={active} onChange={(e) => setActive(e.target.value)}><option value="all">All</option><option value="1">Active</option><option value="0">Inactive</option></Select>}
        toolbar={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Add user</Button>} />
      <UserForm row={edit && edit !== 'new' ? edit : null} open={!!edit} onClose={() => setEdit(null)} onSaved={reload} />
      <ResetPassword user={reset} onClose={() => setReset(null)} />
    </>
  );
}

function UserForm({ row, open, onClose, onSaved }: { row: any | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data: roles } = useApi<any[]>(open ? '/api/roles' : null);
  const f = useForm({ name: '', email: '', roleId: '', password: '', mustChangePw: true });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => { if (open) { f.reset(row ? { name: row.name, email: row.email, roleId: row.roleId, password: '', mustChangePw: true } : { name: '', email: '', roleId: '', password: '', mustChangePw: true }); setError(null); setShown(null); } /* eslint-disable-next-line */ }, [open, row?.id]);
  const v = f.values;
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!v.name.trim()) e.name = 'Required';
    if (!row && !/^\S+@\S+\.\S+$/.test(v.email.trim())) e.email = 'Enter a valid email address';
    if (!v.roleId) e.roleId = 'Choose a role';
    if (!row && !v.password) e.password = 'Set a temporary password';
    if (Object.keys(e).length) { f.setErrors(e); return; }
    setBusy(true); setError(null);
    try {
      if (row) { await api.patch(`/api/users/${row.id}`, { name: v.name.trim(), ...(v.roleId !== row.roleId ? { roleId: v.roleId } : {}) }); toast.success('User updated'); onSaved(); onClose(); }
      else { await api.post('/api/users', { name: v.name.trim(), email: v.email.trim(), roleId: v.roleId, password: v.password, mustChangePw: v.mustChangePw }); toast.success('User created'); setShown(v.password); onSaved(); }
    } catch (err) { setError(err as ApiFail); f.fail(err); }
    setBusy(false);
  };
  if (shown) return (
    <FormModal open={open} onClose={onClose} title="User created" onSubmit={onClose} submitLabel="Done" size="md">
      <Notice tone="success">{v.name} can now sign in with {v.email}.</Notice>
      <Field label="Temporary password" hint="Shown once. Share it securely — the user must change it at first sign-in."><Input readOnly value={shown} className="font-mono" onFocus={(e) => e.target.select()} /></Field>
    </FormModal>);
  return (
    <FormModal open={open} onClose={onClose} title={row ? 'Edit user' : 'Add user'} onSubmit={submit} busy={busy} error={error}>
      <Field label="Full name" required error={f.errors.name}><Input {...f.bind('name')} maxLength={100} autoFocus /></Field>
      <Field label="Email" required error={f.errors.email}><Input type="email" {...f.bind('email')} disabled={!!row} /></Field>
      <Field label="Role" required error={f.errors.roleId}>
        <Select {...f.bind('roleId')}><option value="">Select role…</option>{(roles ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
      </Field>
      {!row && <>
        <Field label="Temporary password" required error={f.errors.password} hint="At least 10 characters with upper and lower case, a number and a symbol.">
          <div className="flex gap-2"><Input {...f.bind('password')} autoComplete="new-password" className="font-mono" /><Button icon={<Wand2 className="h-4 w-4" />} onClick={() => f.set('password', genPassword())}>Generate</Button></div>
        </Field>
        <Check label="Require a password change at first sign-in" checked={v.mustChangePw} onChange={(c) => f.set('mustChangePw', c)} />
      </>}
    </FormModal>
  );
}

function ResetPassword({ user, onClose }: { user: any | null; onClose: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null); const [done, setDone] = useState(false);
  useEffect(() => { if (user) { setPw(''); setError(null); setDone(false); } }, [user]);
  const submit = async () => {
    if (!pw) { setError(new ApiFail(422, 'VALIDATION', 'Enter a new password.')); return; }
    setBusy(true); setError(null);
    try { await api.post(`/api/users/${user.id}/reset-password`, { password: pw }); toast.success('Password reset'); setDone(true); } catch (e) { setError(e as ApiFail); }
    setBusy(false);
  };
  return (
    <FormModal open={!!user} onClose={onClose} title={`Reset password — ${user?.name ?? ''}`} onSubmit={done ? onClose : submit} busy={busy} error={error} submitLabel={done ? 'Done' : 'Reset password'}>
      {done ? <Notice tone="success">Password changed and all of {user?.name}&rsquo;s sessions were signed out. They must choose a new password at next sign-in. Share it securely: <span className="font-mono">{pw}</span></Notice> : <>
        <Field label="New temporary password" required hint="At least 10 characters with upper and lower case, a number and a symbol.">
          <div className="flex gap-2"><Input value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" className="font-mono" /><Button icon={<Wand2 className="h-4 w-4" />} onClick={() => setPw(genPassword())}>Generate</Button></div>
        </Field></>}
    </FormModal>
  );
}

// ───────────── roles ─────────────
function Roles() {
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, reload } = useApi<any[]>('/api/roles');
  const { data: groups } = useApi<{ group: string; items: { key: string; description: string }[] }[]>('/api/permissions');
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const manage = can('roles.manage');
  const del = async (r: any) => {
    const c = await confirm({ title: `Delete role ${r.name}?`, message: 'This cannot be undone. Roles with users assigned cannot be deleted.', confirmLabel: 'Delete role', danger: true });
    if (!c.ok) return;
    try { await api.del(`/api/roles/${r.id}`); toast.success('Role deleted'); reload(); } catch (e) { toast.fail(e); }
  };
  if (error) return <ErrorBox error={error} />;
  if (!data || !groups) return <Loading />;
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  return (
    <div className="space-y-4">
      {manage ? <div className="flex justify-end"><Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>New custom role</Button></div>
        : <Notice>Only a Super Admin can change roles. You can review what each role is allowed to do.</Notice>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.map((r) => (
          <Card key={r.id}>
            <div className="flex items-start justify-between gap-2">
              <div><h3 className="text-base font-semibold text-ink-900">{r.name}</h3><p className="text-xs text-ink-500">{r.userCount} user{r.userCount === 1 ? '' : 's'} · {r.perms.length} of {total} permissions</p></div>
              {r.isSystem ? <Badge>System</Badge> : <Badge tone="blue">Custom</Badge>}
            </div>
            <p className="mt-2 text-sm text-ink-600">{r.description ?? '—'}</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => setEdit(r)}>{manage && r.key !== 'SUPER_ADMIN' ? 'Edit permissions' : 'View permissions'}</Button>
              {manage && !r.isSystem && <Button size="sm" variant="ghost" onClick={() => del(r)}>Delete</Button>}
            </div>
          </Card>))}
      </div>
      <RoleForm row={edit && edit !== 'new' ? edit : null} open={!!edit} groups={groups} readOnly={!manage || (edit && edit !== 'new' && edit.key === 'SUPER_ADMIN')} onClose={() => setEdit(null)} onSaved={reload} />
    </div>
  );
}

function RoleForm({ row, open, groups, readOnly, onClose, onSaved }: { row: any | null; open: boolean; groups: { group: string; items: { key: string; description: string }[] }[]; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [perms, setPerms] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  useEffect(() => { if (open) { setName(row?.name ?? ''); setDesc(row?.description ?? ''); setPerms(new Set(row?.perms ?? [])); setError(null); } }, [open, row]);
  const toggle = (k: string, on: boolean) => setPerms((s) => { const n = new Set(s); if (on) n.add(k); else n.delete(k); return n; });
  const submit = async () => {
    if (readOnly) { onClose(); return; }
    if (!name.trim()) { setError(new ApiFail(422, 'VALIDATION', 'Give the role a name.')); return; }
    setBusy(true); setError(null);
    try {
      const body = { name: name.trim(), description: desc.trim() || null, perms: [...perms] };
      if (row) await api.patch(`/api/roles/${row.id}`, body); else await api.post('/api/roles', body);
      toast.success(row ? 'Role updated — affected users pick up the change on their next request' : 'Role created'); onSaved(); onClose();
    } catch (e) { setError(e as ApiFail); }
    setBusy(false);
  };
  return (
    <FormModal open={open} onClose={onClose} size="xl" title={row ? (readOnly ? `${row.name} — permissions` : `Edit role — ${row.name}`) : 'New custom role'} onSubmit={submit} busy={busy} error={error} submitLabel={readOnly ? 'Close' : 'Save role'}>
      {!readOnly && <div className="grid gap-3 sm:grid-cols-2"><Field label="Role name" required><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={row?.isSystem} /></Field><Field label="Description"><Textarea rows={1} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} /></Field></div>}
      {row?.key === 'SUPER_ADMIN' && <Notice>The Super Admin role always has every permission and cannot be edited.</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map((g) => (
          <fieldset key={g.group} className="rounded-lg border border-ink-200 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{g.group}</legend>
            <div className="space-y-1.5">{g.items.map((p) => <Check key={p.key} disabled={readOnly} checked={row?.key === 'SUPER_ADMIN' || perms.has(p.key)} onChange={(c) => toggle(p.key, c)} label={<span>{p.description}<span className="ml-1 font-mono text-[10px] text-ink-400">{p.key}</span></span>} />)}</div>
          </fieldset>))}
      </div>
      {!readOnly && <p className="text-xs text-ink-500">{perms.size} permission{perms.size === 1 ? '' : 's'} selected. Tip: <span className="font-mono">profit.view</span> and <span className="font-mono">costs.view</span> control whether revenue, margin and cost figures are visible at all.</p>}
    </FormModal>
  );
}
