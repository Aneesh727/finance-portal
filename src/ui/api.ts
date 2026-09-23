'use client';
/** Browser API client: CSRF token, JSON envelope, typed errors, 401 handling. */

export class ApiFail extends Error {
  constructor(public status: number, public code: string, message: string, public details?: { fields?: Record<string, string> } & Record<string, unknown>, public requestId?: string) {
    super(message);
  }
  get fields(): Record<string, string> { return (this.details?.fields as Record<string, string>) ?? {}; }
}

let csrf = '';
export const setCsrf = (t: string) => { csrf = t; };
export const getCsrf = () => csrf;

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (f: (() => void) | null) => { onUnauthorized = f; };

export interface Envelope<T> { data: T; meta?: Record<string, any> }

async function request<T>(method: string, path: string, body?: unknown, opts: { form?: FormData; raw?: boolean; signal?: AbortSignal } = {}): Promise<Envelope<T>> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (opts.form) payload = opts.form;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', signal: opts.signal, cache: 'no-store' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiFail(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  if (opts.raw) return res as unknown as Envelope<T>;
  let json: any = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized?.();
    const e = json?.error;
    throw new ApiFail(res.status, e?.code ?? 'ERROR', e?.message ?? `Request failed (${res.status})`, e?.details, e?.requestId);
  }
  return { data: json?.data as T, meta: json?.meta };
}

export const api = {
  get: <T = any>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, { signal }),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T = any>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T = any>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T = any>(path: string) => request<T>('DELETE', path),
  upload: <T = any>(path: string, form: FormData) => request<T>('POST', path, undefined, { form }),
  /** authenticated file download (export, attachment) */
  async download(path: string, fallbackName = 'download') {
    const res = (await request('GET', path, undefined, { raw: true })) as unknown as Response;
    if (!res.ok) {
      let msg = `Download failed (${res.status})`;
      try { msg = (await res.json())?.error?.message ?? msg; } catch { /* ignore */ }
      throw new ApiFail(res.status, 'DOWNLOAD', msg);
    }
    const cd = res.headers.get('content-disposition') ?? '';
    const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};

export const qs = (o: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
