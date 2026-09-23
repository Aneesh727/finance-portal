'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, BarChart3, Briefcase, Building2, CheckSquare, ChevronDown, CircleDollarSign, FileClock, FileUp, Handshake, Landmark, LayoutDashboard, LogOut, Menu, Receipt, Repeat, Search, Settings, ShieldCheck, Truck, UserCog, Users, Wallet, X, KeyRound, CalendarClock } from 'lucide-react';
import { useSession } from '@/ui/session';
import { api, qs } from '@/ui/api';
import { useApi, useDebounced } from '@/ui/hooks';
import { cn } from '@/ui/kit';
import { ago } from '@/ui/format';

interface NavItem { href: string; label: string; icon: React.ComponentType<{ className?: string }>; any: string[] }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard, any: ['dashboard.view'] },
    { href: '/projects', label: 'Projects', icon: Briefcase, any: ['projects.view'] },
    { href: '/clients', label: 'Clients', icon: Building2, any: ['clients.view'] },
    { href: '/deals', label: 'Deals & quotes', icon: Handshake, any: ['deals.view'] },
  ] },
  { group: 'Money', items: [
    { href: '/costs', label: 'Project costs', icon: Wallet, any: ['costs.view'] },
    { href: '/billing', label: 'Invoices & payments', icon: Receipt, any: ['payments.view'] },
    { href: '/expenses', label: 'Company expenses', icon: CircleDollarSign, any: ['expenses.view'] },
    { href: '/retainers', label: 'Retainers', icon: Repeat, any: ['retainers.view'] },
    { href: '/employee-costs', label: 'Employee cost allocation', icon: CalendarClock, any: ['allocations.manage'] },
  ] },
  { group: 'People', items: [
    { href: '/resources', label: 'Resources', icon: Users, any: ['resources.view'] },
    { href: '/vendors', label: 'Vendors', icon: Truck, any: ['resources.view'] },
  ] },
  { group: 'Insights', items: [
    { href: '/reports', label: 'Reports', icon: BarChart3, any: ['reports.view', 'forecast.view'] },
    { href: '/approvals', label: 'Approvals', icon: CheckSquare, any: ['approvals.decide', 'projects.view'] },
  ] },
  { group: 'Admin', items: [
    { href: '/import', label: 'Import data', icon: FileUp, any: ['import.run'] },
    { href: '/audit', label: 'Audit log', icon: FileClock, any: ['audit.view'] },
    { href: '/users', label: 'Users & roles', icon: UserCog, any: ['users.manage', 'roles.manage'] },
    { href: '/settings', label: 'Settings', icon: Settings, any: ['settings.manage', 'backup.run'] },
  ] },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { me, can, canAny, signOut } = useSession();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = (h: string) => (h === '/' ? path === '/' : path === h || path.startsWith(h + '/'));
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => canAny(...i.any)) })).filter((g) => g.items.length);
  const nav = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
      {groups.map((g) => (
        <div key={g.group}>
          <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">{g.group}</p>
          <ul className="space-y-0.5">{g.items.map((i) => (
            <li key={i.href}><Link href={i.href} aria-current={active(i.href) ? 'page' : undefined} className={cn('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition', active(i.href) ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900')}><i.icon className="h-4 w-4 shrink-0" />{i.label}</Link></li>
          ))}</ul>
        </div>
      ))}
    </nav>
  );
  void can;
  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-ink-200 bg-white lg:flex">
        <Brand name={me.company?.name} />
        {nav}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-pop">
            <div className="flex items-center justify-between pr-2"><Brand name={me.company?.name} /><button className="btn-ghost btn-icon" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-4 w-4" /></button></div>
            {nav}
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-ink-200 bg-white/90 px-4 backdrop-blur no-print">
        <button className="btn-ghost btn-icon lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
        <GlobalSearch />
        <div className="ml-auto flex items-center gap-1">
          <Notifications />
          <UserMenu name={me.user.name} email={me.user.email} role={me.user.role.name} signOut={signOut} />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

function Brand({ name }: { name?: string }) {
  return <Link href="/" className="flex h-14 items-center gap-2.5 border-b border-ink-100 px-4"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white"><Landmark className="h-4 w-4" /></span><span className="min-w-0 truncate text-sm font-semibold text-ink-900">{name ?? 'Finance Portal'}</span></Link>;
}

function useClickAway(ref: React.RefObject<HTMLElement | null>, on: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) on(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') on(); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [ref, on, active]);
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q.trim(), 250);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false), open);
  const { data, loading } = useApi<{ type: string; id: string; title: string; subtitle?: string; href: string }[]>(dq.length >= 2 ? `/api/search${qs({ q: dq })}` : null);
  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input className="input pl-8" placeholder="Search projects, clients, invoices…" aria-label="Global search" value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} maxLength={80} />
      {open && dq.length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-40 max-h-96 overflow-y-auto rounded-xl border border-ink-200 bg-white p-1 shadow-pop" role="listbox">
          {loading && !data ? <p className="p-3 text-sm text-ink-500">Searching…</p> : data && data.length === 0 ? <p className="p-3 text-sm text-ink-500">No results for “{dq}”.</p> : data?.map((r) => (
            <button key={r.type + r.id} role="option" aria-selected={false} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-ink-50" onClick={() => { setOpen(false); setQ(''); router.push(r.href); }}>
              <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-ink-400">{r.type}</span>
              <span className="min-w-0"><span className="block truncate text-sm text-ink-900">{r.title}</span>{r.subtitle && <span className="block truncate text-xs text-ink-500">{r.subtitle}</span>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface Notif { id: string; title: string; body: string | null; link: string | null; read: boolean; severity: string; createdAt: string }
function Notifications() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false), open);
  const { data, meta, reload } = useApi<Notif[]>('/api/notifications?pageSize=8');
  useEffect(() => { const t = setInterval(reload, 60_000); return () => clearInterval(t); }, [reload]);
  const unread = meta?.unread ?? 0;
  const readAll = async () => { await api.post('/api/notifications/read', { all: true }); reload(); };
  const go = async (n: Notif) => { setOpen(false); if (!n.read) { await api.post('/api/notifications/read', { ids: [n.id] }).catch(() => {}); reload(); } if (n.link) router.push(n.link); };
  return (
    <div ref={ref} className="relative">
      <button className="btn-ghost btn-icon relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => { setOpen(!open); if (!open) reload(); }}>
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-40 w-[min(92vw,22rem)] rounded-xl border border-ink-200 bg-white shadow-pop">
          <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2"><h3>Notifications</h3>{unread > 0 && <button className="link text-xs" onClick={readAll}>Mark all read</button>}</div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.length ? <p className="p-6 text-center text-sm text-ink-500">You’re all caught up.</p> : data.map((n) => (
              <button key={n.id} onClick={() => go(n)} className={cn('flex w-full gap-2.5 border-b border-ink-100 px-3 py-2.5 text-left last:border-0 hover:bg-ink-50', !n.read && 'bg-brand-50/40')}>
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.severity === 'critical' ? 'bg-red-500' : n.severity === 'warning' ? 'bg-amber-500' : 'bg-brand-500', n.read && 'opacity-30')} />
                <span className="min-w-0"><span className="block text-sm font-medium text-ink-900">{n.title}</span>{n.body && <span className="line-clamp-2 block text-xs text-ink-600">{n.body}</span>}<span className="text-[11px] text-ink-400">{ago(n.createdAt)}</span></span>
              </button>
            ))}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-ink-100 px-3 py-2 text-center text-xs link">View all</Link>
        </div>
      )}
    </div>
  );
}

function UserMenu({ name, email, role, signOut }: { name: string; email: string; role: string; signOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false), open);
  return (
    <div ref={ref} className="relative">
      <button className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-ink-100" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
        <span className="hidden text-left sm:block"><span className="block text-[13px] font-medium leading-4 text-ink-900">{name}</span><span className="block text-[11px] text-ink-500">{role}</span></span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-ink-400 sm:block" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-40 w-56 rounded-xl border border-ink-200 bg-white p-1 shadow-pop">
          <div className="border-b border-ink-100 px-3 py-2"><p className="truncate text-sm font-medium">{name}</p><p className="truncate text-xs text-ink-500">{email}</p></div>
          <Link role="menuitem" href="/change-password" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-ink-50"><KeyRound className="h-4 w-4 text-ink-400" />Change password</Link>
          <Link role="menuitem" href="/notifications" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-ink-50"><ShieldCheck className="h-4 w-4 text-ink-400" />Notifications</Link>
          <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50" onClick={signOut}><LogOut className="h-4 w-4" />Sign out</button>
        </div>
      )}
    </div>
  );
}
