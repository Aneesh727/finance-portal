import { sql } from 'drizzle-orm';
import { loadProjectFinancials, toBase } from '@/lib/finance/loaders';
import { RECOGNISED_STATUSES, OPEN_STATUSES } from '@/lib/finance/engine';
import { ratioPct, type Minor } from '@/lib/money';
import type { AuthUser } from '@/lib/auth';
import { projectScopeSql } from '@/lib/access';

export interface ClientStats {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  revenue?: Minor;
  outstanding?: Minor;
  cost?: Minor;
  profit?: Minor;
  avgMarginPct?: number | null;
  retainerRevenue?: Minor;
}

/** Aggregate stats (in BASE currency) for a set of clients, respecting the caller's project scope and permissions. */
export async function clientStats(clientIds: string[], user: AuthUser): Promise<Map<string, ClientStats>> {
  const out = new Map<string, ClientStats>();
  if (!clientIds.length) return out;
  const ids = sql.join(clientIds.map((c) => sql`${c}::uuid`), sql`, `);
  const rows = await loadProjectFinancials({ where: sql`p.archived_at IS NULL AND p.client_id IN (${ids}) AND ${projectScopeSql(user)}` });
  const seeProfit = user.perms.has('profit.view');
  const seeCost = user.perms.has('costs.view');
  const acc = new Map<string, { s: ClientStats; margins: number[]; rev: Minor; cost: Minor; profit: Minor }>();
  for (const id of clientIds) acc.set(id, { s: { totalProjects: 0, activeProjects: 0, completedProjects: 0 }, margins: [], rev: 0, cost: 0, profit: 0 });
  for (const r of rows) {
    const a = acc.get(r.clientId)!;
    a.s.totalProjects++;
    if (OPEN_STATUSES.includes(r.status)) a.s.activeProjects++;
    if (r.status === 'COMPLETED') a.s.completedProjects++;
    if (!RECOGNISED_STATUSES.includes(r.status)) continue;
    const rev = toBase(r.f.revenue.revenue, r.fxRateToBase);
    const cost = toBase(r.f.cost.actual, r.fxRateToBase);
    a.rev += rev;
    a.cost += cost;
    a.profit += rev - cost;
    if (seeProfit) {
      a.s.outstanding = (a.s.outstanding ?? 0) + toBase(r.f.receivables.outstanding, r.fxRateToBase);
      if (r.type === 'RETAINER') a.s.retainerRevenue = (a.s.retainerRevenue ?? 0) + rev;
    }
  }
  for (const [id, a] of acc) {
    if (seeProfit) {
      a.s.revenue = a.rev;
      a.s.profit = a.profit;
      a.s.avgMarginPct = ratioPct(a.profit, a.rev);
      a.s.outstanding ??= 0;
      a.s.retainerRevenue ??= 0;
    }
    if (seeCost) a.s.cost = a.cost;
    out.set(id, a.s);
  }
  return out;
}
