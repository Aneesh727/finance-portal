import { z } from 'zod';
import { route, reply, checkOrigin } from '@/lib/api';
import { attemptLogin, createSession, sessionCookie } from '@/lib/auth';
import { ApiError, forbidden, tooMany } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { db } from '@/lib/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const body = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) });

export const POST = route(
  { public: true, noCsrf: true, body, rate: { name: 'login', max: 30, windowSec: 900, by: 'ip' } },
  async ({ req, body, ip, actor }) => {
    checkOrigin(req);
    const rl = rateLimit(`login:${ip}:${body.email}`, 8, 15 * 60_000);
    if (!rl.ok) throw tooMany(rl.retryAfterSec);

    const r = await attemptLogin(body.email, body.password);
    if (!r.ok) {
      await audit(db, { ...actor, email: body.email }, { action: 'auth.login_failed', entityType: 'user', summary: `Failed sign-in for ${body.email} (${r.reason})` });
      if (r.reason === 'locked') throw new ApiError(423, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${r.retryAfterMin ?? 15} minutes.`);
      if (r.reason === 'inactive') throw forbidden('This account has been deactivated. Contact an administrator.', 'ACCOUNT_INACTIVE');
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    }
    const s = await createSession(r.userId, { ip, userAgent: req.headers.get('user-agent') });
    await audit(db, { ...actor, userId: r.userId, email: body.email }, { action: 'auth.login', entityType: 'user', entityId: r.userId, summary: `${body.email} signed in` });
    const [u] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, r.userId)).limit(1);
    return reply({ user: u, csrfToken: s.csrf }, { headers: { 'Set-Cookie': sessionCookie(s.token, s.maxAgeSec) } });
  },
);
