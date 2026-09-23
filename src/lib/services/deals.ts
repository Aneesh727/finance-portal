import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { db, type Executor } from '@/lib/db';
import { categories, clients, dealCostLines, dealScenarios, deals, users } from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { audit, type Actor } from '@/lib/audit';
import { conflict, notFound, unprocessable } from '@/lib/errors';
import { formatMoney, fromMinor, toMinor } from '@/lib/money';
import { calculateDealScenario } from '@/lib/finance/engine';
import { getSettings } from '@/lib/settings';
import type { dealBody } from '@/lib/validators';
import { createProject } from './projects';

type Ctx = { user: AuthUser; actor: Actor };
type DealInput = z.infer<typeof dealBody>;

async function checkRefs(tx: Executor, i: Partial<DealInput>) {
  if (i.clientId) {
    const [c] = await tx.select().from(clients).where(eq(clients.id, i.clientId)).limit(1);
    if (!c) throw unprocessable('The selected client does not exist.', { fields: { clientId: 'Not found' } });
  }
  if (i.serviceId) {
    const [s] = await tx.select().from(categories).where(and(eq(categories.id, i.serviceId), eq(categories.kind, 'SERVICE'))).limit(1);
    if (!s) throw unprocessable('The selected service does not exist.', { fields: { serviceId: 'Not found' } });
  }
  if (i.ownerId) {
    const [u] = await tx.select().from(users).where(and(eq(users.id, i.ownerId), eq(users.active, true))).limit(1);
    if (!u) throw unprocessable('The selected owner does not exist or is inactive.', { fields: { ownerId: 'Not found' } });
  }
  const cats = (i.scenarios ?? []).flatMap((s) => s.costLines.map((l) => l.categoryId));
  if (cats.length) {
    const found = await tx.select({ id: categories.id }).from(categories).where(and(inArray(categories.id, [...new Set(cats)]), eq(categories.kind, 'COST')));
    if (found.length !== new Set(cats).size) throw unprocessable('A cost line uses a category that does not exist.', { fields: { scenarios: 'Unknown category' } });
  }
}

async function writeScenarios(tx: Executor, dealId: string, scenarios: NonNullable<DealInput['scenarios']>) {
  const existing = await tx.select({ id: dealScenarios.id }).from(dealScenarios).where(eq(dealScenarios.dealId, dealId));
  const keep = new Set(scenarios.map((s) => s.id).filter(Boolean) as string[]);
  const drop = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (drop.length) await tx.delete(dealScenarios).where(inArray(dealScenarios.id, drop));
  let order = 0;
  const ids: string[] = [];
  for (const sc of scenarios) {
    let sid = sc.id && existing.some((e) => e.id === sc.id) ? sc.id : null;
    if (sid) await tx.update(dealScenarios).set({ name: sc.name, sellingPrice: sc.sellingPrice, sortOrder: order }).where(eq(dealScenarios.id, sid));
    else [{ id: sid }] = await tx.insert(dealScenarios).values({ dealId, name: sc.name, sellingPrice: sc.sellingPrice, sortOrder: order }).returning({ id: dealScenarios.id });
    order++;
    await tx.delete(dealCostLines).where(eq(dealCostLines.scenarioId, sid!));
    if (sc.costLines.length) await tx.insert(dealCostLines).values(sc.costLines.map((l) => ({ scenarioId: sid!, categoryId: l.categoryId, name: l.name, amount: l.amount })));
    ids.push(sid!);
  }
  return ids;
}

export async function createDeal(tx: Executor, ctx: Ctx, i: DealInput) {
  await checkRefs(tx, i);
  if (!i.clientId && !i.clientName) throw unprocessable('Choose an existing client or type the prospect\'s name.', { fields: { clientName: 'Required' } });
  const [d] = await tx.insert(deals).values({ name: i.name, clientId: i.clientId, clientName: i.clientId ? null : i.clientName, serviceId: i.serviceId, ownerId: i.ownerId ?? ctx.user.id, notes: i.notes }).returning();
  const ids = i.scenarios?.length ? await writeScenarios(tx, d.id, i.scenarios) : [];
  if (ids.length) await tx.update(deals).set({ selectedScenarioId: ids[0] }).where(eq(deals.id, d.id));
  await audit(tx, ctx.actor, { action: 'deal.create', entityType: 'deal', entityId: d.id, summary: `Created deal "${d.name}" with ${ids.length} scenario(s)`, new: d });
  return d;
}

export async function updateDeal(tx: Executor, ctx: Ctx, id: string, i: Partial<DealInput> & { selectedScenarioId?: string | null }) {
  const [old] = await tx.select().from(deals).where(eq(deals.id, id)).limit(1);
  if (!old || old.archivedAt) throw notFound('Deal');
  if (old.status !== 'OPEN') throw conflict(`A ${old.status.toLowerCase()} deal cannot be edited.`, 'INVALID_STATE');
  await checkRefs(tx, i);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ['name', 'clientId', 'clientName', 'serviceId', 'ownerId', 'notes'] as const) if (i[k] !== undefined) set[k] = i[k];
  if (i.clientId) set.clientName = null;
  if (i.scenarios) {
    const ids = await writeScenarios(tx, id, i.scenarios);
    set.selectedScenarioId = ids.includes(old.selectedScenarioId ?? '') ? old.selectedScenarioId : ids[0] ?? null;
  }
  if (i.selectedScenarioId !== undefined) {
    if (i.selectedScenarioId) {
      const [sc] = await tx.select().from(dealScenarios).where(and(eq(dealScenarios.id, i.selectedScenarioId), eq(dealScenarios.dealId, id))).limit(1);
      if (!sc) throw unprocessable('That scenario does not belong to this deal.');
    }
    set.selectedScenarioId = i.selectedScenarioId;
  }
  const [row] = await tx.update(deals).set(set).where(eq(deals.id, id)).returning();
  await audit(tx, ctx.actor, { action: 'deal.update', entityType: 'deal', entityId: id, summary: `Updated deal "${old.name}"`, old, new: row });
  return row;
}

export async function markLost(tx: Executor, ctx: Ctx, id: string, reason: string) {
  const [old] = await tx.select().from(deals).where(eq(deals.id, id)).limit(1);
  if (!old) throw notFound('Deal');
  if (old.status !== 'OPEN') throw conflict(`This deal is already ${old.status.toLowerCase()}.`, 'INVALID_STATE');
  const [row] = await tx.update(deals).set({ status: 'LOST', notes: [old.notes, `Lost: ${reason}`].filter(Boolean).join('\n'), updatedAt: new Date() }).where(eq(deals.id, id)).returning();
  await audit(tx, ctx.actor, { action: 'deal.lost', entityType: 'deal', entityId: id, summary: `Marked deal "${old.name}" lost: ${reason}` });
  return row;
}

/** Turn a deal scenario into a real project (estimated costs and category budgets carried over). Exactly once. */
export async function convertDeal(tx: Executor, ctx: Ctx, id: string, o: { scenarioId?: string; clientId?: string; type?: 'ONE_TIME'; startDate?: string | null; endDate?: string | null }) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'deal:' + id}))`);
  const [d] = await tx.select().from(deals).where(eq(deals.id, id)).limit(1);
  if (!d) throw notFound('Deal');
  if (d.projectId || d.status === 'WON') throw conflict('This deal was already converted to a project.', 'ALREADY_CONVERTED');
  if (d.status === 'LOST') throw conflict('A lost deal cannot be converted.', 'INVALID_STATE');
  const clientId = o.clientId ?? d.clientId;
  if (!clientId) throw unprocessable('Link an existing client (or create one) before converting this deal.', { fields: { clientId: 'Required' } }, 'CLIENT_REQUIRED');
  if (!d.serviceId) throw unprocessable('Choose a service for the deal before converting.', { fields: { serviceId: 'Required' } });
  const sid = o.scenarioId ?? d.selectedScenarioId;
  if (!sid) throw unprocessable('Add and select a pricing scenario first.', { fields: { scenarioId: 'Required' } });
  const [sc] = await tx.select().from(dealScenarios).where(and(eq(dealScenarios.id, sid), eq(dealScenarios.dealId, id))).limit(1);
  if (!sc) throw unprocessable('That scenario does not belong to this deal.');
  const lines = await tx.select().from(dealCostLines).where(eq(dealCostLines.scenarioId, sid));
  const calc = calculateDealScenario(toMinor(sc.sellingPrice), lines.map((l) => toMinor(l.amount)));
  const byCat = new Map<string, number>();
  for (const l of lines) byCat.set(l.categoryId, (byCat.get(l.categoryId) ?? 0) + toMinor(l.amount));
  const res = await createProject(tx, ctx, {
    name: d.name, clientId, serviceId: d.serviceId, type: 'ONE_TIME', status: 'WON', priority: 'MEDIUM', taxMode: 'EXCLUSIVE', sellingPrice: sc.sellingPrice, discount: '0', setupFee: '0', monthlyFee: '0', durationMonths: 0,
    budget: fromMinor(calc.estimatedCost), managerId: d.ownerId, startDate: o.startDate ?? null, endDate: o.endDate ?? null, notes: d.notes,
    categoryBudgets: [...byCat].map(([categoryId, amt]) => ({ categoryId, amount: fromMinor(amt) })),
    estimatedCosts: lines.filter((l) => toMinor(l.amount) > 0).map((l) => ({ categoryId: l.categoryId, name: l.name, amount: l.amount })),
  } as never);
  await tx.update(deals).set({ status: 'WON', projectId: res.project.id, clientId, selectedScenarioId: sid, updatedAt: new Date() }).where(eq(deals.id, id));
  await audit(tx, ctx.actor, { action: 'deal.convert', entityType: 'deal', entityId: id, projectId: res.project.id, summary: `Converted deal "${d.name}" (${sc.name}, ${formatMoney(calc.sellingPrice, 'INR')}, est. margin ${calc.marginPct}%) into project ${res.project.code}` });
  return res.project;
}

async function scenariosOf(dealIds: string[]) {
  if (!dealIds.length) return new Map<string, { id: string; name: string; sellingPrice: string; costLines: { id: string; categoryId: string; category: string; name: string; amount: string }[]; calc: ReturnType<typeof calculateDealScenario> }[]>();
  const scs = await db.select().from(dealScenarios).where(inArray(dealScenarios.dealId, dealIds)).orderBy(asc(dealScenarios.sortOrder));
  const lines = scs.length ? await db.select({ l: dealCostLines, cat: categories.name }).from(dealCostLines).innerJoin(categories, eq(categories.id, dealCostLines.categoryId)).where(inArray(dealCostLines.scenarioId, scs.map((s) => s.id))) : [];
  const res = new Map<string, { id: string; name: string; sellingPrice: string; costLines: { id: string; categoryId: string; category: string; name: string; amount: string }[]; calc: ReturnType<typeof calculateDealScenario> }[]>();
  for (const s of scs) {
    const ls = lines.filter((x) => x.l.scenarioId === s.id).map((x) => ({ id: x.l.id, categoryId: x.l.categoryId, category: x.cat, name: x.l.name, amount: x.l.amount }));
    const arr = res.get(s.dealId) ?? [];
    arr.push({ id: s.id, name: s.name, sellingPrice: s.sellingPrice, costLines: ls, calc: calculateDealScenario(toMinor(s.sellingPrice), ls.map((l) => toMinor(l.amount))) });
    res.set(s.dealId, arr);
  }
  return res;
}

export async function listDeals(o: { status?: string; q?: string; page: number; pageSize: number }) {
  const conds = [sql`d.archived_at IS NULL`, o.status ? sql`d.status = ${o.status}::deal_status` : sql`true`, o.q ? sql`(d.name ILIKE ${'%' + o.q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'} OR COALESCE(c.company_name, d.client_name) ILIKE ${'%' + o.q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'})` : sql`true`];
  const where = sql.join(conds, sql` AND `);
  const [t] = (await db.execute(sql`SELECT count(*)::int AS n FROM deals d LEFT JOIN clients c ON c.id = d.client_id WHERE ${where}`)).rows as { n: number }[];
  const rows = (await db.execute(sql`SELECT d.*, COALESCE(c.company_name, d.client_name) AS client, s.name AS service, u.name AS owner, p.code AS project_code FROM deals d LEFT JOIN clients c ON c.id = d.client_id LEFT JOIN categories s ON s.id = d.service_id LEFT JOIN users u ON u.id = d.owner_id LEFT JOIN projects p ON p.id = d.project_id WHERE ${where} ORDER BY d.created_at DESC LIMIT ${o.pageSize} OFFSET ${(o.page - 1) * o.pageSize}`)).rows as Record<string, unknown>[];
  const sc = await scenariosOf(rows.map((r) => r.id as string));
  return {
    total: t.n,
    rows: rows.map((r) => {
      const list = sc.get(r.id as string) ?? [];
      const sel = list.find((x) => x.id === r.selected_scenario_id) ?? list[0];
      return { id: r.id, name: r.name, client: r.client, clientId: r.client_id, service: r.service, owner: r.owner, status: r.status, projectId: r.project_id, projectCode: r.project_code, scenarioCount: list.length, selected: sel ? { id: sel.id, name: sel.name, ...sel.calc } : null, createdAt: r.created_at };
    }),
  };
}

export async function getDeal(id: string) {
  const [d] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  if (!d || d.archivedAt) throw notFound('Deal');
  const sc = (await scenariosOf([id])).get(id) ?? [];
  const best = sc.length ? sc.reduce((b, x) => (x.calc.estimatedProfit > b.calc.estimatedProfit ? x : b)) : null;
  return { deal: d, scenarios: sc, bestScenarioId: best?.id ?? null, thresholds: (await getSettings()).thresholds };
}
void desc;
