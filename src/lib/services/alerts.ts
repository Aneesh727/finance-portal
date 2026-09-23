import { sql } from 'drizzle-orm';
import type { Executor } from '@/lib/db';
import { loadOne, loadProjectFinancials } from '@/lib/finance/loaders';
import { getSettings } from '@/lib/settings';
import { notify } from './notifications';
import { formatMoney } from '@/lib/money';
import { OPEN_STATUSES } from '@/lib/finance/engine';
import { addDays, todayStr } from '@/lib/dates';

/** Event-driven: call after anything that changes a project's cost. De-duplicated per project + state. */
export async function evaluateProjectAlerts(exec: Executor, projectId: string): Promise<void> {
  const s = await getSettings(exec);
  const fin = await loadOne(projectId, { exec, thresholds: s.thresholds });
  if (!fin || !OPEN_STATUSES.includes(fin.status)) return;
  const link = `/projects/${projectId}`;
  const audience = { userIds: fin.managerId ? [fin.managerId] : [], permission: 'costs.approve' as const };
  const b = fin.f.budget;
  if (b.state === 'EXCEEDED') {
    await notify(exec, { type: 'BUDGET_EXCEEDED', requirePerm: 'costs.view', severity: 'critical', title: `${fin.code} is over budget`, body: `${fin.name}: spent ${formatMoney(b.used, fin.currency)} against a budget of ${formatMoney(b.budget, fin.currency)} (over by ${formatMoney(b.overBy, fin.currency)}).`, link, dedupeKey: `budget:${projectId}:EXCEEDED`, ...audience });
  } else if (b.state === 'ALERT' || b.state === 'WARNING') {
    await notify(exec, { type: 'BUDGET_WARNING', requirePerm: 'costs.view', severity: 'warning', title: `${fin.code} has used ${b.utilizationPct?.toFixed(0)}% of its budget`, body: `${fin.name}: ${formatMoney(b.remaining, fin.currency)} remaining.`, link, dedupeKey: `budget:${projectId}:${b.state}`, ...audience });
  }
  if (fin.f.health.reasons.some((r) => r.startsWith('Low margin') || r === 'Projected loss')) {
    await notify(exec, { type: 'LOW_MARGIN', requirePerm: 'profit.view', severity: 'critical', title: `${fin.code} margin is low`, body: `${fin.name}: ${fin.f.health.reasons.join('; ')}`, link, dedupeKey: `margin:${projectId}:${(fin.f.projectedMarginPct ?? -100) < 0 ? 'LOSS' : 'LOW'}`, ...audience });
  }
}

/** Scheduled scan (daily job / on-demand): overdue payments, retainer renewals, projects ending soon, budgets, margins. */
export async function runNotificationScan(exec: Executor): Promise<{ created: number }> {
  const s = await getSettings(exec, { fresh: true });
  const today = todayStr();
  let created = 0;

  const rows = await loadProjectFinancials({ exec, thresholds: s.thresholds, where: sql`p.archived_at IS NULL AND p.status IN ('WON','ONBOARDING','ACTIVE','ON_HOLD')`, limit: 5000 });
  for (const r of rows) {
    const link = `/projects/${r.id}`;
    const audience = { userIds: r.managerId ? [r.managerId] : [], permission: 'costs.approve' as const };
    const b = r.f.budget;
    if (b.state === 'EXCEEDED') created += await notify(exec, { type: 'BUDGET_EXCEEDED', requirePerm: 'costs.view', severity: 'critical', title: `${r.code} is over budget`, body: r.name, link, dedupeKey: `budget:${r.id}:EXCEEDED`, ...audience });
    else if (b.state === 'ALERT' || b.state === 'WARNING') created += await notify(exec, { type: 'BUDGET_WARNING', requirePerm: 'costs.view', severity: 'warning', title: `${r.code} has used ${b.utilizationPct?.toFixed(0)}% of its budget`, body: r.name, link, dedupeKey: `budget:${r.id}:${b.state}`, ...audience });
    if (r.f.receivables.overdue > 0) {
      created += await notify(exec, { type: 'PAYMENT_OVERDUE', requirePerm: 'profit.view', severity: r.f.health.reasons.some((x) => x.startsWith('Overdue payments')) ? 'critical' : 'warning', title: `${formatMoney(r.f.receivables.overdue, r.currency)} overdue on ${r.code}`, body: `${r.clientName} - ${r.name}`, link: '/billing?status=OVERDUE', dedupeKey: `overdue:${r.id}:${today.slice(0, 7)}`, permission: 'payments.manage', userIds: r.managerId ? [r.managerId] : [] });
    }
    if (r.endDate && r.endDate >= today && r.endDate <= addDays(today, s.notifications.endingSoonDays)) {
      created += await notify(exec, { type: 'PROJECT_ENDING', severity: 'info', title: `${r.code} ends on ${r.endDate}`, body: r.name, link, dedupeKey: `ending:${r.id}:${r.endDate}`, ...audience });
    }
    if (r.f.health.reasons.some((x) => x.startsWith('Low margin') || x === 'Projected loss')) {
      created += await notify(exec, { type: 'LOW_MARGIN', requirePerm: 'profit.view', severity: 'critical', title: `${r.code} margin is low`, body: `${r.name}: ${r.f.health.reasons.join('; ')}`, link, dedupeKey: `margin:${r.id}:${(r.f.projectedMarginPct ?? -100) < 0 ? 'LOSS' : 'LOW'}`, ...audience });
    }
  }
  // retainer renewals
  const horizon = addDays(today, s.notifications.renewalDays);
  const ren = await exec.execute(sql`
    SELECT r.id, r.project_id, p.code, p.name, t.end_date, r.account_manager_id
    FROM retainers r JOIN projects p ON p.id = r.project_id
    JOIN LATERAL (SELECT end_date FROM retainer_terms WHERE retainer_id = r.id ORDER BY end_date DESC LIMIT 1) t ON true
    WHERE r.status = 'ACTIVE' AND t.end_date >= ${today}::date AND t.end_date <= ${horizon}::date`);
  for (const x of ren.rows as { id: string; code: string; name: string; end_date: string; account_manager_id: string | null }[]) {
    created += await notify(exec, { type: 'RETAINER_RENEWAL', severity: 'warning', title: `Retainer ${x.code} renews by ${x.end_date}`, body: x.name, link: `/retainers/${x.id}`, dedupeKey: `renewal:${x.id}:${x.end_date}`, permission: 'retainers.manage', userIds: x.account_manager_id ? [x.account_manager_id] : [] });
  }
  return { created };
}
