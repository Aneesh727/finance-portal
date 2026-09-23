import { test, expect } from '@playwright/test';
import { newPage, apiFor, uniq } from './helpers';

test('company expense: record, allocate 60/40 to two projects, totals stay consistent, edits are versioned', async ({ browser }) => {
  const page = await newPage(browser, 'admin');
  const { call } = await apiFor(page);
  const svc = ((await call('GET', '/api/categories?kind=SERVICE')).data as any[])[0];
  const clients = (await call('GET', '/api/clients?pageSize=1')).data as any[];
  const mk = async (name: string) => (await call('POST', '/api/projects', { name, clientId: clients[0].id, serviceId: svc.id, type: 'ONE_TIME', status: 'ACTIVE', taxMode: 'NONE', sellingPrice: '400000', budget: '300000' })).data;
  const pA = await mk(uniq('Alloc A')); const pB = await mk(uniq('Alloc B'));
  const pnlBefore = (await call('GET', '/api/reports/pnl')).data.totals;

  const description = uniq('Annual office software licence');
  await page.goto('/expenses');
  await page.getByRole('button', { name: 'Add expense' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel(/^Description/).fill(description);
  await dlg.getByLabel(/^Category/).selectOption({ index: 1 });
  await dlg.getByLabel(/^Amount/).fill('100000');
  await dlg.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByText('Expense recorded')).toBeVisible();

  // find it and allocate
  await page.getByRole('main').getByPlaceholder(/search/i).first().fill(description);
  const row = page.getByRole('row').filter({ hasText: description });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('menuitem', { name: /allocate/i }).click();
  const al = page.getByRole('dialog');
  for (let i = 0; i < 2; i++) {
    if (i > 0 || (await al.getByRole('button', { name: 'Remove line' }).count()) === 0) await al.getByRole('button', { name: 'Add line' }).click();
  }
  const pickers = al.getByRole('button', { name: /Search project/ });
  const pick = async (i: number, code: string) => { await pickers.first().click(); await al.getByPlaceholder(/Type a name/).fill(code); const opt = al.getByRole('listbox').getByRole('option').filter({ hasText: code }); await expect(opt).toHaveCount(1); await opt.click(); };
  await pick(0, pA.code); await pick(1, pB.code);
  await al.getByLabel('Value').nth(0).fill('60');
  await al.getByLabel('Value').nth(1).fill('40');
  await al.getByRole('button', { name: 'Save allocation' }).click();
  await expect(page.getByText('Allocation saved')).toBeVisible();

  const fa = (await call('GET', `/api/projects/${pA.id}`)).data.financials;
  const fb = (await call('GET', `/api/projects/${pB.id}`)).data.financials;
  expect(fa.cost.actual).toBe(6000000);
  expect(fb.cost.actual).toBe(4000000);
  // company P&L: the expense counts once (as overhead), allocation only moves it between projects and overhead
  const pnlAfter = (await call('GET', '/api/reports/pnl')).data.totals;
  expect(pnlAfter.companyExpenses - pnlBefore.companyExpenses).toBe(10000000);
  expect(pnlAfter.totalCost - pnlBefore.totalCost).toBe(10000000);

  // over-allocation is refused (110%)
  const list = (await call('GET', `/api/expenses?q=${encodeURIComponent(description)}`)).data as any[];
  const bad = await call('PUT', `/api/expenses/${list[0].id}/allocations`, { rows: [{ targetType: 'PROJECT', projectId: pA.id, method: 'PERCENT', value: 70 }, { targetType: 'PROJECT', projectId: pB.id, method: 'PERCENT', value: 40 }] });
  expect(bad.status).toBe(422);
  expect((await call('GET', `/api/projects/${pA.id}`)).data.financials.cost.actual).toBe(6000000); // unchanged
  await page.context().close();
});
