import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db, type Executor } from './db';
import { env } from './env';
import { permissions, rolePermissions, roles, sessions, users } from '@/db/schema';
import type { Perm } from './permissions';

export const SESSION_COOKIE = 'fp_session';
const ABSOLUTE_SESSION_DAYS = 30;
const LOCK_AFTER_FAILS = 5;
const LOCK_MINUTES = 15;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  perms: Set<string>;
  sessionId: string;
  csrfToken: string;
  mustChangePw: boolean;
}

// ───────────────────────────── passwords ─────────────────────────────

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters.';
  if (pw.length > 200) return 'Password is too long.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) return 'Password must include upper and lower case letters.';
  if (!/\d/.test(pw)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include a symbol.';
  if (/^(password|admin|welcome|letmein)/i.test(pw)) return 'Password is too easy to guess.';
  return null;
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, env().BCRYPT_COST);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

// used to burn equal CPU time when the email does not exist (prevents user enumeration by timing)
let dummyHash: string | null = null;
async function burn(pw: string) {
  dummyHash ??= await bcrypt.hash('dummy-password-for-timing', env().BCRYPT_COST);
  await bcrypt.compare(pw, dummyHash);
}

// ───────────────────────────── tokens ─────────────────────────────

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}

export function sessionCookie(token: string, maxAgeSec: number): string {
  const e = env();
  return [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`, e.cookieSecure ? 'Secure' : ''].filter(Boolean).join('; ');
}
export function clearSessionCookie(): string {
  return sessionCookie('', 0).replace(/Max-Age=0/, 'Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
}

// ───────────────────────────── permissions cache ─────────────────────────────

const roleCache = new Map<string, { perms: Set<string>; exp: number }>();
export const invalidateRoleCache = () => roleCache.clear();

async function permsForRole(roleId: string): Promise<Set<string>> {
  const hit = roleCache.get(roleId);
  if (hit && hit.exp > Date.now()) return hit.perms;
  const rows = await db.select({ key: permissions.key }).from(rolePermissions).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)).where(eq(rolePermissions.roleId, roleId));
  const set = new Set(rows.map((r) => r.key));
  roleCache.set(roleId, { perms: set, exp: Date.now() + 15_000 });
  return set;
}

// ───────────────────────────── sessions ─────────────────────────────

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }, exec: Executor = db) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const ttlMs = env().SESSION_TTL_HOURS * 3600_000;
  await exec.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    csrfToken: csrf,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return { token, csrf, maxAgeSec: Math.floor(ttlMs / 1000) };
}

export async function revokeSessionByToken(token: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
}
export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), exceptSessionId ? sql`${sessions.id} <> ${exceptSessionId}` : undefined));
}

/** Resolve the signed-in user from the request cookie (or null). Slides the expiry window. */
export async function getAuthUser(req: Request): Promise<AuthUser | null> {
  const token = parseCookies(req.headers.get('cookie'))[SESSION_COOKIE];
  if (!token || token.length < 20 || token.length > 200) return null;
  const now = new Date();
  const rows = await db
    .select({ s: sessions, u: users, r: roles })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (!row.u.active) return null;
  if (now.getTime() - row.s.createdAt.getTime() > ABSOLUTE_SESSION_DAYS * 86400_000) return null;

  // sliding expiry (write at most once every 5 minutes)
  if (now.getTime() - row.s.lastSeenAt.getTime() > 5 * 60_000) {
    const ttlMs = env().SESSION_TTL_HOURS * 3600_000;
    db.update(sessions).set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + ttlMs) }).where(eq(sessions.id, row.s.id)).catch(() => {});
  }
  return {
    id: row.u.id,
    email: row.u.email,
    name: row.u.name,
    roleId: row.r.id,
    roleKey: row.r.key,
    roleName: row.r.name,
    perms: await permsForRole(row.r.id),
    sessionId: row.s.id,
    csrfToken: row.s.csrfToken,
    mustChangePw: row.u.mustChangePw,
  };
}

// ───────────────────────────── login ─────────────────────────────

export type LoginResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid' | 'locked' | 'inactive'; retryAfterMin?: number };

export async function attemptLogin(email: string, password: string): Promise<LoginResult> {
  const e = email.trim().toLowerCase();
  const [u] = await db.select().from(users).where(eq(users.email, e)).limit(1);
  if (!u) {
    await burn(password);
    return { ok: false, reason: 'invalid' };
  }
  if (u.lockedUntil && u.lockedUntil > new Date()) {
    await burn(password);
    return { ok: false, reason: 'locked', retryAfterMin: Math.ceil((u.lockedUntil.getTime() - Date.now()) / 60000) };
  }
  const ok = await verifyPassword(password, u.passwordHash);
  if (!ok) {
    const fails = u.failedLogins + 1;
    await db
      .update(users)
      .set({ failedLogins: fails, lockedUntil: fails >= LOCK_AFTER_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : u.lockedUntil })
      .where(eq(users.id, u.id));
    if (fails >= LOCK_AFTER_FAILS) return { ok: false, reason: 'locked', retryAfterMin: LOCK_MINUTES };
    return { ok: false, reason: 'invalid' };
  }
  if (!u.active) return { ok: false, reason: 'inactive' };
  await db.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
  return { ok: true, userId: u.id };
}

export const can = (u: AuthUser | null | undefined, p: Perm) => !!u && u.perms.has(p);
