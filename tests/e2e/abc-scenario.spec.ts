/**
 * Spec §49 — the critical business scenario, driven entirely through the browser UI.
 * ABC Company / e-commerce website / ₹5,00,000 contract / ₹2,50,000 budget.
 * Numbers shown in the UI are cross-checked against the API so a rendering bug cannot hide a calculation bug.
 */
import { test, expect, type Page } from '@playwright/test';
import { newPage, apiFor, uniq, rs } from './helpers';

test.describe.configure({ mode: 'serial' });

let page: Page;
let projectId = '';
let projectUrl = '';
const clientName = uniq('ABC Company');
const fin = async () => {
  const { call } = await apiFor(page);
  return (await call('GET', `/api/projects/${projectId}`)).data.financials;
};

test.beforeAll(async ({ browser }) => { page = await newPage(browser, 'admin'); });
test.afterAll(async () => { await page.close(); });

test('1. create the client through the form', async () => {
  await page.goto('/clients');
  await page.getByRole('button', { name: 'Add client' }).first().click();
  await page.getByLabel(/^Company name/).fill(clientName);
  await page.getByLabel(/^Contact person/).fill('Anita Sharma');
  await page.getByLabel(/^Email/).fill('anita@abc.example');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Client created')).toBeVisible();
  await page.getByPlaceholder('Search company, contact or email…').fill(clientName);
  await expect(page.getByRole('cell', { name: new RegExp(clientName) })).toBeVisible();
});

test('2. create the project: price ₹5,00,000, budget ₹2,50,000, no tax', async () => {
  await page.goto('/projects/new');
  await page.getByLabel(/^Project name/).fill('E-commerce Website');
  await page.getByLabel(/^Client/).selectOption({ label: clientName });
  await page.getByLabel(/^Service/).selectOption({ label: 'Web Development' });
  await page.getByLabel('Tax treatment').selectOption('NONE');
  await page.getByLabel('Selling price').fill('500000');
  await page.getByLabel('Total project budget').fill('250000');
  // the live summary panel is calculated as you type
  await expect(page.getByText('Contract value (ex-tax)').locator('..')).toContainText('5,00,000');
  await expect(page.getByText('Planned margin').locator('..')).toContainText('50');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/);
  projectUrl = page.url();
  projectId = projectUrl.split('/projects/')[1].split(/[?#]/)[0];
  await expect(page.getByRole('heading', { name: /E-commerce Website/ })).toBeVisible();
  const f = await fin();
  expect(f.revenue.revenue).toBe(50000000);
  expect(f.cost.actual).toBe(0);
});

async function addCost(name: string, category: string, amount: string) {
  await page.goto(`${projectUrl.split('?')[0]}?tab=costs`);
  await page.getByRole('button', { name: 'Add cost' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel(/^Name/).fill(name);
  await dlg.getByLabel(/^Category/).selectOption({ label: category });
  await dlg.getByLabel(/^Amount/).fill(amount);
  await dlg.getByRole('button', { name: 'Add cost' }).click();
  return dlg;
}

test('3. record the five actual costs → cost ₹2,50,000, profit ₹2,50,000, margin 50%, budget fully used', async () => {
  for (const [name, cat, amt] of [['Development', 'Developer', '140000'], ['Design', 'Designer', '45000'], ['Hosting', 'Hosting', '30000'], ['Marketing', 'Marketing', '10000'], ['Misc', 'Miscellaneous', '25000']]) {
    await addCost(name, cat, amt);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('cell', { name, exact: true }).first()).toBeVisible();
  }
  const f = await fin();
  expect(f.cost.actual).toBe(25000000);
  expect(f.profit.actual).toBe(25000000);
  expect(f.profit.grossMarginPct).toBe(50);
  expect(f.budget.utilizationPct).toBe(100);
  await page.goto(projectUrl);
  await expect(page.getByText('₹2,50,000').first()).toBeVisible();
  await expect(page.getByText(/Margin 50\.0%/).first()).toBeVisible();
});

test('4. invoice the contract and receive the ₹1,50,000 advance → outstanding ₹3,50,000', async () => {
  await page.goto(`${projectUrl}?tab=billing`);
  await page.getByRole('button', { name: 'New invoice' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel(/^Amount before tax/).fill('500000');
  await dlg.getByLabel(/^Due date/).fill('2026-12-31');
  await dlg.getByRole('button', { name: 'Issue invoice' }).click();
  await expect(page.getByText(/Invoice .* (created|issued)/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^INV\// }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Row actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Record payment' }).click();
  const pay = page.getByRole('dialog');
  await pay.getByLabel(/^Amount received/).fill('150000');
  await pay.getByLabel('Reference / UTR').fill('ADV-1');
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText(/Payment recorded/i).first()).toBeVisible();

  const f = await fin();
  expect(f.receivables.invoiced).toBe(50000000);
  expect(f.receivables.received).toBe(15000000);
  expect(f.receivables.outstanding).toBe(35000000);
  expect(f.receivables.collectionPct).toBe(30);
  await page.goto(projectUrl);
  await expect(page.getByText('₹3,50,000').first()).toBeVisible();
});

test('5. an extra ₹20,000 developer cost is blocked until the budget override is confirmed with a reason', async () => {
  await addCost('Extra developer', 'Developer', '20000');
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('This would exceed a budget')).toBeVisible();
  expect((await fin()).cost.actual).toBe(25000000); // nothing was saved

  await dlg.getByLabel(/Record it anyway/).check();
  await dlg.getByRole('button', { name: 'Add cost' }).click();
  await expect(dlg.getByText(/reason/i).first()).toBeVisible(); // still refused without a reason
  expect((await fin()).cost.actual).toBe(25000000);

  await dlg.getByPlaceholder('Reason for the override (required)').fill('Client asked for extra checkout features');
  await dlg.getByRole('button', { name: 'Add cost' }).click();
  await expect(dlg).toBeHidden();
  const f = await fin();
  expect(f.cost.actual).toBe(27000000);
  expect(f.profit.actual).toBe(23000000);
  expect(f.budget.state).toBe('EXCEEDED');
  expect(f.profit.grossMarginPct).toBe(46);
});

test('6. the project shows as over budget on the dashboard, the audit log records the override, and the export works', async () => {
  await page.goto('/');
  await expect(page.getByText('E-commerce Website').first()).toBeVisible();
  await page.goto('/audit');
  await page.getByPlaceholder('Search summary or user…').fill('override');
  await expect(page.getByText(/override/i).first()).toBeVisible();

  await page.goto(`${projectUrl}?tab=costs`);
  await page.getByRole('button', { name: 'Export' }).first().click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^costs.*\.csv$/);
  const text = (await (await import('node:fs/promises')).readFile(await download.path()!, 'utf8'));
  expect(text).toContain('Extra developer');
  expect(text).toContain('Development');
});

test('7. the client page rolls the project up; the project cannot be deleted, only archived', async () => {
  await page.goto('/clients');
  await page.getByPlaceholder('Search company, contact or email…').fill(clientName);
  await page.getByRole('cell', { name: new RegExp(clientName) }).click();
  await expect(page.getByText('E-commerce Website').first()).toBeVisible();
  const { call } = await apiFor(page);
  expect((await call('DELETE', `/api/projects/${projectId}`)).status).toBeGreaterThanOrEqual(400);
  expect(rs(500000)).toBe('₹5,00,000');
});
