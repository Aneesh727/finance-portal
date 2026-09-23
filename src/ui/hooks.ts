'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiFail, type Envelope } from './api';

export interface QueryState<T> { data?: T; meta?: Record<string, any>; error: ApiFail | null; loading: boolean; reload: () => void; setData: (d: T) => void }

/** minimal fetch hook: refetches when `url` changes (null = skip), cancels stale requests */
export function useApi<T = any>(url: string | null): QueryState<T> {
  const [state, setState] = useState<{ data?: T; meta?: Record<string, any>; error: ApiFail | null; loading: boolean }>({ error: null, loading: !!url });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) { setState({ error: null, loading: false }); return; }
    const ac = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get<T>(url, ac.signal).then(
      (r: Envelope<T>) => !ac.signal.aborted && setState({ data: r.data, meta: r.meta, error: null, loading: false }),
      (e) => { if (!ac.signal.aborted && (e as Error).name !== 'AbortError') setState((s) => ({ ...s, error: e as ApiFail, loading: false })); },
    );
    return () => ac.abort();
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((d: T) => setState((s) => ({ ...s, data: d })), []);
  return { ...state, reload, setData };
}

/** wraps an async action: prevents double-submit, exposes busy + error */
export function useAction<A extends any[], R>(fn: (...a: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);
  const lock = useRef(false);
  const run = useCallback(async (...a: A): Promise<R | undefined> => {
    if (lock.current) return undefined;
    lock.current = true; setBusy(true); setError(null);
    try { return await fn(...a); }
    catch (e) { setError(e as ApiFail); return undefined; }
    finally { lock.current = false; setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn]);
  return { run, busy, error, setError };
}

export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** keeps a piece of UI state in the URL query string (shareable/bookmarkable filters) */
export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => { try { const s = sessionStorage.getItem(`ui:${key}`); if (s) setV(JSON.parse(s)); } catch { /* ignore */ } }, [key]);
  const set = useCallback((n: T) => { setV(n); try { sessionStorage.setItem(`ui:${key}`, JSON.stringify(n)); } catch { /* ignore */ } }, [key]);
  return [v, set];
}
