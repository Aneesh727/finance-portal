import { route, reply } from '@/lib/api';
import { clearSessionCookie, parseCookies, revokeSessionByToken, SESSION_COOKIE } from '@/lib/auth';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const POST = route({}, async ({ req, user, actor }) => {
  const token = parseCookies(req.headers.get('cookie'))[SESSION_COOKIE];
  if (token) await revokeSessionByToken(token);
  await audit(db, actor, { action: 'auth.logout', entityType: 'user', entityId: user.id, summary: `${user.email} signed out` });
  return reply({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } });
});
