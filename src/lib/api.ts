/**
 * API route wrapper: one place that enforces
 *   authentication -> CSRF/origin -> rate limit -> RBAC -> body/query validation -> idempotency -> error mapping.
 * Every route handler MUST be created through `route()` so no endpoint can forget a check.
 */
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { z, type ZodTypeAny, ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { env } from './env';
import { getAuthUser, safeEqual, type AuthUser } from './auth';
import { ApiError, badRequest, errorPayload, forbidden, mapDbError, tooMany, unauthorized, unprocessable } from './errors';
import { rateLimit } from './rate-limit';
import type { Perm } from './permissions';
import { audit, type Actor, type AuditEntry } from './audit';
import type { Executor } from './db';
import { idempotencyKeys } from '@/db/schema';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);
export const uuidSchema = z.string().regex(UUID_RE, 'Invalid id');

const MAX_JSON_BYTES = 1_000_000;

export class Reply {
  constructor(
    public data: unknown,
    public opts: { status?: number; meta?: unknown; headers?: Record<string, string> } = {},
  ) {}
}
export const reply = (data: unknown, opts: { status?: number; meta?: unknown; headers?: Record<string, string> } = {}) => new Reply(data, opts);
export const created = (data: unknown) => new Reply(data, { status: 201 });

export interface Ctx<B, Q> {
  req: NextRequest;
  user: AuthUser;
  body: B;
  query: Q;
  params: Record<string, string>;
  ip: string;
  requestId: string;
  actor: Actor;
  /** validated uuid route param */
  id: (name?: string) => string;
  audit: (exec: Executor, e: AuditEntry) => Promise<void>;
  can: (p: Perm) => boolean;
}

export interface RouteOpts<B extends ZodTypeAny | undefined, Q extends ZodTypeAny | undefined> {
  /** every listed permission is required */
  perm?: Perm | Perm[];
  /** at least one listed permission is required */
  anyPerm?: Perm[];
  public?: boolean;
  body?: B;
  query?: Q;
  rate?: { name: string; max: number; windowSec: number; by?: 'ip' | 'user' | 'ip+body:email' };
  /** skip JSON body parsing (multipart uploads) */
  raw?: boolean;
  /** allow users flagged mustChangePw */
  allowMustChangePw?: boolean;
  /** skip CSRF (only for login/setup bootstrap endpoints that have no session yet) */
  noCsrf?: boolean;
}

type Handler<B, Q> = (ctx: Ctx<B, Q>) => Promise<unknown | Reply | Response>;
type RouteContext = { params: Promise<Record<string, string>> };

export function clientIp(req: Request): string {
  if (env().TRUST_PROXY === 'true') {
    const xff = req.headers.get('x-forwarded-for');
    if (xff) return xff.split(',')[0].trim().slice(0, 64);
    const real = req.headers.get('x-real-ip');
    if (real) return real.trim().slice(0, 64);
  }
  return 'direct';
}

function formatZod(e: ZodError) {
  const fields: Record<string, string> = {};
  for (const i of e.issues) {
    const path = i.path.join('.') || '_';
    if (!(path in fields)) fields[path] = i.message;
  }
  const first = Object.entries(fields)[0];
  const label = first[0] === '_' ? '' : `${first[0]}: `;
  return { message: `Unable to save. ${label}${first[1]}`, fields };
}

function toResponse(e: unknown, requestId: string): Response {
  let err: ApiError | null = null;
  if (e instanceof ApiError) err = e;
  else if (e instanceof ZodError) {
    const z = formatZod(e);
    err = unprocessable(z.message, { fields: z.fields });
  } else err = mapDbError(e);

  if (!err) {
    // unknown: log securely (no stack to the client)
    console.error(JSON.stringify({ level: 'error', requestId, msg: (e as Error)?.message, stack: (e as Error)?.stack?.split('\n').slice(0, 6) }));
    err = new ApiError(500, 'INTERNAL', `Something unexpected happened on our side. Reference: ${requestId}`);
  } else if (err.status >= 500) {
    console.error(JSON.stringify({ level: 'error', requestId, code: err.code, msg: (e as Error)?.message }));
  }
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Request-Id': requestId };
  if (err.status === 429) headers['Retry-After'] = String((err.details as { retryAfterSec?: number })?.retryAfterSec ?? 60);
  return Response.json(errorPayload(err, requestId), { status: err.status, headers });
}

export function checkOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin) return; // non-browser client (curl/tests): CSRF token still required
  let allowed: string;
  try {
    allowed = new URL(env().APP_ORIGIN).origin;
  } catch {
    return;
  }
  const host = req.headers.get('host');
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    throw forbidden('Cross-site request blocked.', 'BAD_ORIGIN');
  }
  if (o.origin !== allowed && o.host !== host) throw forbidden('Cross-site request blocked.', 'BAD_ORIGIN');
}

export function route<B extends ZodTypeAny | undefined = undefined, Q extends ZodTypeAny | undefined = undefined>(
  opts: RouteOpts<B, Q>,
  handler: Handler<B extends ZodTypeAny ? z.infer<B> : undefined, Q extends ZodTypeAny ? z.infer<Q> : Record<string, never>>,
) {
  return async (req: NextRequest, rc?: RouteContext): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const method = req.method.toUpperCase();
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    let idemRowKey: string | null = null;
    try {
      const ip = clientIp(req);

      // 1. coarse per-IP throttle (protects unauthenticated endpoints too)
      const g = rateLimit(`ip:${ip}`, 1200, 60_000);
      if (!g.ok) throw tooMany(g.retryAfterSec);

      // 2. authentication
      let user: AuthUser | null = null;
      if (!opts.public) {
        user = await getAuthUser(req);
        if (!user) throw unauthorized();
      } else {
        user = await getAuthUser(req).catch(() => null);
      }

      // 3. CSRF (state-changing requests with a session)
      if (isWrite && !opts.noCsrf && user) {
        checkOrigin(req);
        const tok = req.headers.get('x-csrf-token') ?? '';
        if (!tok || !safeEqual(tok, user.csrfToken)) throw forbidden('Your session security token is missing or expired. Refresh the page and try again.', 'CSRF');
      }

      // 4. per-route rate limit
      if (opts.rate) {
        const by = opts.rate.by ?? 'ip';
        let who = ip;
        if (by === 'user') who = user?.id ?? ip;
        const rl = rateLimit(`${opts.rate.name}:${who}`, opts.rate.max, opts.rate.windowSec * 1000);
        if (!rl.ok) throw tooMany(rl.retryAfterSec);
      } else if (user && isWrite) {
        const rl = rateLimit(`w:${user.id}`, 300, 60_000);
        if (!rl.ok) throw tooMany(rl.retryAfterSec);
      }

      // 5. authorization
      if (!opts.public) {
        if (user!.mustChangePw && !opts.allowMustChangePw) throw forbidden('You must change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED');
        const need = opts.perm ? (Array.isArray(opts.perm) ? opts.perm : [opts.perm]) : [];
        for (const p of need) if (!user!.perms.has(p)) throw forbidden();
        if (opts.anyPerm && !opts.anyPerm.some((p) => user!.perms.has(p))) throw forbidden();
      }

      // 6. params, query, body
      const params = rc?.params ? await rc.params : {};
      let query: unknown = {};
      if (opts.query) {
        const sp = req.nextUrl?.searchParams ?? new URL(req.url).searchParams;
        query = opts.query.parse(Object.fromEntries(sp.entries()));
      }
      let body: unknown = undefined;
      if (opts.body && !opts.raw) {
        const len = Number(req.headers.get('content-length') ?? '0');
        if (len > MAX_JSON_BYTES) throw badRequest('Request body is too large.', undefined, 'BODY_TOO_LARGE');
        let text: string;
        try {
          text = await req.text();
        } catch {
          throw badRequest('Could not read the request body.');
        }
        if (text.length > MAX_JSON_BYTES) throw badRequest('Request body is too large.', undefined, 'BODY_TOO_LARGE');
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          throw badRequest('The request body is not valid JSON.', undefined, 'INVALID_JSON');
        }
        body = opts.body.parse(json);
      }

      // 7. idempotency (double-submit / refresh protection)
      const idemHeader = req.headers.get('idempotency-key');
      if (idemHeader && method === 'POST' && user) {
        if (idemHeader.length > 100 || !/^[A-Za-z0-9_.:-]+$/.test(idemHeader)) throw badRequest('Invalid Idempotency-Key.');
        const key = `${user.id}:${req.nextUrl?.pathname ?? new URL(req.url).pathname}:${idemHeader}`;
        const ins = await db.insert(idempotencyKeys).values({ key, userId: user.id, route: req.nextUrl?.pathname ?? '', statusCode: 0, response: {} }).onConflictDoNothing().returning({ key: idempotencyKeys.key });
        if (!ins.length) {
          const [row] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).limit(1);
          if (row && row.statusCode > 0) {
            return Response.json(row.response as object, { status: row.statusCode, headers: { 'Idempotent-Replay': 'true', 'Cache-Control': 'no-store', 'X-Request-Id': requestId } });
          }
          throw new ApiError(409, 'IN_PROGRESS', 'This request is already being processed.');
        }
        idemRowKey = key;
      }

      const actor: Actor = { userId: user?.id ?? null, email: user?.email ?? null, ip, userAgent: req.headers.get('user-agent') };
      const ctx = {
        req,
        user: user as AuthUser,
        body,
        query,
        params,
        ip,
        requestId,
        actor,
        id: (name = 'id') => {
          const v = params[name];
          if (!isUuid(v)) throw badRequest('That link or id is not valid.', undefined, 'INVALID_ID');
          return v;
        },
        audit: (exec: Executor, e: AuditEntry) => audit(exec, actor, e),
        can: (p: Perm) => !!user?.perms.has(p),
      } as Ctx<never, never>;

      const result = await handler(ctx as never);
      if (result instanceof Response) return result;

      const r = result instanceof Reply ? result : new Reply(result);
      const status = r.opts.status ?? 200;
      const payload = { data: r.data ?? null, ...(r.opts.meta ? { meta: r.opts.meta } : {}) };
      if (idemRowKey) {
        await db.update(idempotencyKeys).set({ statusCode: status, response: payload as never }).where(eq(idempotencyKeys.key, idemRowKey));
        idemRowKey = null;
      }
      return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId, ...(r.opts.headers ?? {}) } });
    } catch (e) {
      if (idemRowKey) await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, idemRowKey)).catch(() => {});
      return toResponse(e, requestId);
    }
  };
}

// ───────────────────────────── query helpers ─────────────────────────────

/** Standard pagination + sorting + search query fields shared by list endpoints. */
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(100).optional(),
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).default('desc'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const csvList = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 30) : []);

/** escape user text for use in ILIKE patterns */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
