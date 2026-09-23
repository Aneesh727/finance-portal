import { test, expect } from '@playwright/test';
import { newPage, apiFor, uniq } from './helpers';

const firstOfMonth = () => new Date().toISOString().slice(0, 7) + '-01';
const plusMonths = (n: number) => { const d = new Date(`${firstOfMonth()}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); };

test('retainer: create, log hours over the allowance → overage billed, renew, cancel', async ({ browser }) => {
  const page = await newPage(browser, 'admin');
  const { call } = await apiFor(page);
  const client = (await call('POST', '/api/clients', { companyName: uniq('AAA Retainer Client'), status: 'ACTIVE' })).data;
  expect(client?.id).toBeTruthy();
  const name = uniq('Monthly SEO retainer');

  await page.goto('/retainers');
  await page.getByRole('button', { name: 'New retainer' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel(/^Name/).fill(name);
  await dlg.getByLabel(/^Client/).selectOption({ label: client.companyName });
  await dlg.getByLabel(/^Service/).selectOption({ index: 1 });
  await dlg.getByLabel(/^Monthly fee/).fill('50000');
  await dlg.getByLabel(/^Term starts/).fill(firstOfMonth());
  await dlg.getByLabel(/^Term ends/).fill(plusMonths(11));
  await dlg.getByLabel(/^Included hours/).fill('20');
  await dlg.getByLabel(/^Overage rate/).fill('2000');
  await dlg.getByLabel(/^Tax$/).selectOption('NONE');
  await dlg.getByRole('button', { name: 'Create retainer' }).click();
  await expect(dlg).toBeHidden();

  await page.waitForURL(/\/retainers\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
  const id = page.url().split('/').pop()!;

  // log 26 hours in the current month → 6 h over the 20 h allowance = ₹12,000 overage
  await page.getByRole('row').filter({ hasText: '0 / 20' }).first().getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('menuitem', { name: 'Log hours' }).click();
  await page.getByRole('dialog').getByLabel(/Hours used/).fill('26');
  await page.getByRole('dialog').getByRole('button', { name: /save|log/i }).click();
  await expect(page.getByText(/26 \/ 20/)).toBeVisible();
  const det = (await call('GET', `/api/retainers/${id}`)).data;
  const cur = det.months.find((m: any) => Number(m.hoursUsed) === 26);
  expect(cur.overageHours).toBe(6);
  expect(cur.overageRevenue).toBe(1200000);
  expect(cur.baseRevenue).toBe(5000000);

  // invalid hours are rejected, nothing changes
  const bad = await call('PUT', `/api/retainers/${id}/hours`, { month: cur.month, hoursUsed: '-3' });
  expect(bad.status).toBe(422);

  // renew with a higher fee: history is kept (two terms)
  await page.getByRole('button', { name: 'Renew', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/New monthly fee/).fill('60000');
  await page.getByRole('dialog').getByLabel(/New term ends/).fill(plusMonths(23));
  await page.getByRole('dialog').getByRole('button', { name: 'Renew', exact: true }).click();
  await expect(page.getByText('/mo').nth(1)).toBeVisible();
  expect(((await call('GET', `/api/retainers/${id}`)).data.terms as any[]).length).toBe(2);

  // cancel (reason required)
  await page.getByRole('button', { name: 'Cancel retainer' }).first().click();
  const c = page.getByRole('dialog');
  await c.getByRole('button', { name: 'Cancel retainer' }).click();
  await expect(c.getByText(/reason/i).first()).toBeVisible();
  await c.getByLabel(/^Reason/).fill('Client moved in-house');
  await c.getByRole('button', { name: 'Cancel retainer' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Cancel retainer' }).click(); // confirm
  await expect(page.getByText('CANCELLED', { exact: false }).first()).toBeVisible();
  await page.context().close();
});

test('deal: compare scenarios, best-profit flag, convert the chosen scenario into a project with estimated costs', async ({ browser }) => {
  const page = await newPage(browser, 'admin');
  const { call } = await apiFor(page);
  const client = (await call('POST', '/api/clients', { companyName: uniq('AAA Deal Client'), status: 'ACTIVE' })).data;
  const costCat = ((await call('GET', '/api/categories?kind=COST')).data as any[])[0];
  const name = uniq('Website rebuild deal');

  await page.goto('/deals');
  await page.getByRole('button', { name: 'New deal' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel(/^Deal name/).fill(name);
  await dlg.getByLabel(/^Existing client/).selectOption({ label: client.companyName });
  await dlg.getByLabel(/^Service/).selectOption({ index: 1 });
  await dlg.getByRole('button', { name: /create|save/i }).click();
  await page.waitForURL(/\/deals\/[0-9a-f-]{36}/);
  const id = page.url().split('/').pop()!;

  // scenario "Base": price 200000, cost 120000 → profit 80000 (40%)
  const price = page.getByLabel(/^Selling price/).first();
  await price.fill('200000');
  await page.getByRole('button', { name: 'Add cost' }).first().click();
  await page.getByLabel('Cost amount').first().fill('120000');
  await page.getByLabel('Cost line name').first().fill('Developers');
  await page.locator('select').filter({ hasText: /Select category/ }).first().selectOption({ label: costCat.name });
  await expect(page.getByText('₹80,000').first()).toBeVisible();
  await expect(page.getByText('40.0%', { exact: true }).first()).toBeVisible();

  // second scenario with lower margin
  await page.getByRole('button', { name: /Add scenario/ }).click();
  await page.getByLabel(/^Selling price/).nth(1).fill('150000');
  await page.getByRole('button', { name: 'Add cost' }).nth(1).click();
  await page.getByLabel('Cost amount').nth(1).fill('140000');
  await page.getByLabel('Cost line name').nth(1).fill('Agency');
  await page.locator('select').filter({ hasText: /Select category/ }).first().selectOption({ label: costCat.name });
  await expect(page.getByText('Best profit')).toBeVisible();
  await expect(page.getByText(/Below the .*% minimum margin/)).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();

  // pick the first scenario, then convert
  await expect(page.getByLabel('Use for conversion').first()).toBeChecked();
  await expect(page.getByRole('button', { name: 'Convert to project' })).toBeEnabled();
  await page.getByRole('button', { name: 'Convert to project' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/);
  const pid = page.url().split('/').pop()!;
  const fin = (await call('GET', `/api/projects/${pid}`)).data.financials;
  expect(fin.revenue.contractValue ?? fin.price?.exTax ?? fin.sellingPrice).toBeTruthy();
  const deal = (await call('GET', `/api/deals/${id}`)).data;
  expect(deal.status ?? deal.deal?.status).toBe('WON');
  // a converted deal cannot be converted twice
  const again = await call('POST', `/api/deals/${id}/convert`, { scenarioId: null, clientId: client.id });
  expect(again.status).toBeGreaterThanOrEqual(400);
  await page.context().close();
});
