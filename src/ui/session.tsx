'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api, setCsrf, setUnauthorizedHandler } from './api';

export interface Me {
  user: { id: string; email: string; name: string; role: { key: string; name: string }; mustChangePw: boolean };
  permissions: string[];
  csrfToken: string;
  company: { name: string; baseCurrency: string; fyStartMonth: number; dateFormat: string; stateCode: string | null; setupComplete: boolean } | null;
}
export interface Meta {
  company: { name: string; baseCurrency: string; fyStartMonth: number; dateFormat: string; stateCode: string | null } | null;
  categories: { service: Cat[]; cost: Cat[]; expense: Cat[] };
  taxRates: { id: string; name: string; ratePct: string; isDefault: boolean }[];
  paymentTerms: { id: string; name: string; days: number }[];
  currencies: string[];
  thresholds: Record<string, number>;
  approvals: Record<string, any>;
}
export interface Cat { id: string; kind: string; name: string; slug: string; active: boolean }

interface Ctx { me: Me; meta: Meta | null; can: (p: string) => boolean; canAny: (...p: string[]) => boolean; reloadMeta: () => void; signOut: () => Promise<void>; refreshMe: () => Promise<void> }
const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => { const c = useContext(SessionCtx); if (!c) throw new Error('useSession outside provider'); return c; };

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [failed, setFailed] = useState(false);
  const [metaDone, setMetaDone] = useState(false);

  const toLogin = useCallback(() => router.replace(`/login?next=${encodeURIComponent(path || '/')}`), [router, path]);
  useEffect(() => { setUnauthorizedHandler(toLogin); return () => setUnauthorizedHandler(null); }, [toLogin]);

  const loadMe = useCallback(async () => {
    try {
      const r = await api.get<Me>('/api/auth/me');
      setCsrf(r.data.csrfToken);
      setMe(r.data);
      if (r.data.user.mustChangePw && path !== '/change-password') router.replace('/change-password');
      return r.data;
    } catch (e: any) {
      if (e.status === 401) toLogin(); else setFailed(true);
      return null;
    }
  }, [router, toLogin, path]);
  const loadMeta = useCallback(() => { api.get<Meta>('/api/meta').then((r) => setMeta(r.data)).catch(() => {}).finally(() => setMetaDone(true)); }, []);

  useEffect(() => { loadMe().then((m) => { if (m && !m.user.mustChangePw) loadMeta(); else setMetaDone(true); }); /* eslint-disable-next-line */ }, []);

  const perms = useMemo(() => new Set(me?.permissions ?? []), [me]);
  const value = useMemo<Ctx | null>(() => me && {
    me, meta, can: (p) => perms.has(p), canAny: (...p) => p.some((x) => perms.has(x)), reloadMeta: loadMeta,
    signOut: async () => { try { await api.post('/api/auth/logout'); } finally { setCsrf(''); router.replace('/login'); } },
    refreshMe: async () => { await loadMe(); },
  }, [me, meta, perms, loadMeta, router, loadMe]);

  if (failed) return <div className="p-10 text-center text-sm text-ink-600">The server is not reachable right now. <button className="link" onClick={() => location.reload()}>Retry</button></div>;
  if (!value || !metaDone) return <div className="grid h-screen place-items-center text-sm text-ink-500">Loading…</div>;
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
