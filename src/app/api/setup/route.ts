import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { route, reply, checkOrigin } from '@/lib/api';
import { db } from '@/lib/db';
import { categories, company, taxRates, users } from '@/db/schema';
import { ensureBaseData, findRoleId, slugify } from '@/lib/base-data';
import { createSession, hashPassword, sessionCookie, validatePasswordStrength } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { conflict, unprocessable } from '@/lib/errors';
import { currency, email, gstin, optText, reqText, stateFromGstin } from '@/lib/schemas';
import { setSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const body = z.object({
  companyName: reqText(150),
  gstin,
  address: optText(500),
  baseCurrency: currency.default('INR'),
  fyStartMonth: z.coerce.number().int().min(1).max(12).default(4),
  defaultTaxRatePct: z.coerce.number().min(0).max(100).default(18),
  adminName: reqText(100),
  adminEmail: z.string().trim().toLowerCase().email().max(200),
  adminPassword: z.string().min(1).max(200),
  serviceCategories: z.array(reqText(80)).max(60).optional(),
  costCategories: z.array(reqText(80)).max(80).optional(),
  marginTargetPct: z.coerce.number().min(0).max(100).optional(),
});
void email;

export const POST = route({ public: true, noCsrf: true, body, rate: { name: 'setup', max: 10, windowSec: 3600 } }, async ({ req, body, ip, actor }) => {
  checkOrigin(req);
  const weak = validatePasswordStrength(body.adminPassword);
  if (weak) throw unprocessable(weak, { fields: { adminPassword: weak } });
  const hash = await hashPassword(body.adminPassword);

  const userId = await db.transaction(async (tx) => {
    // serialize concurrent setup attempts
    await tx.execute(sql`select pg_advisory_xact_lock(834721)`);
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(users)) as { n: number }[];
    if (n > 0) throw conflict('Setup has already been completed. Sign in instead.', 'ALREADY_SETUP');
    await ensureBaseData(tx);

    await tx.insert(company).values({
      id: 'singleton', name: body.companyName, gstin: body.gstin, stateCode: stateFromGstin(body.gstin), address: body.address,
      baseCurrency: body.baseCurrency, fyStartMonth: body.fyStartMonth, setupComplete: true,
    }).onConflictDoUpdate({
      target: company.id,
      set: { name: body.companyName, gstin: body.gstin, stateCode: stateFromGstin(body.gstin), address: body.address, baseCurrency: body.baseCurrency, fyStartMonth: body.fyStartMonth, setupComplete: true },
    });

    // default GST slab
    await tx.update(taxRates).set({ isDefault: false });
    const [slab] = await tx.select().from(taxRates).where(eq(taxRates.ratePct, String(body.defaultTaxRatePct))).limit(1);
    if (slab) await tx.update(taxRates).set({ isDefault: true }).where(eq(taxRates.id, slab.id));
    else await tx.insert(taxRates).values({ name: `Tax ${body.defaultTaxRatePct}%`, ratePct: String(body.defaultTaxRatePct), isDefault: true });

    const applyCats = async (kind: 'SERVICE' | 'COST', wanted?: string[]) => {
      if (!wanted) return;
      const keep = new Set(wanted.map((w) => slugify(w)));
      const existing = await tx.select().from(categories).where(eq(categories.kind, kind));
      for (const c of existing) await tx.update(categories).set({ active: keep.has(c.slug) }).where(eq(categories.id, c.id));
      let order = existing.length;
      for (const name of wanted) {
        if (!existing.some((c) => c.slug === slugify(name))) await tx.insert(categories).values({ kind, name, slug: slugify(name), sortOrder: order++ });
      }
    };
    await applyCats('SERVICE', body.serviceCategories);
    await applyCats('COST', body.costCategories);
    if (body.marginTargetPct !== undefined) await setSetting(tx, 'thresholds', { targetMarginPct: body.marginTargetPct });

    const roleId = await findRoleId(tx, 'SUPER_ADMIN');
    const [u] = await tx.insert(users).values({ email: body.adminEmail, name: body.adminName, passwordHash: hash, roleId }).returning({ id: users.id });
    await audit(tx, { ...actor, userId: u.id, email: body.adminEmail }, { action: 'setup.complete', entityType: 'company', entityId: 'singleton', summary: `Initial setup completed for ${body.companyName}` });
    return u.id;
  });

  const s = await createSession(userId, { ip, userAgent: req.headers.get('user-agent') });
  return reply({ ok: true, csrfToken: s.csrf }, { status: 201, headers: { 'Set-Cookie': sessionCookie(s.token, s.maxAgeSec) } });
});
void and;
