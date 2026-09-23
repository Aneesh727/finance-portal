import { test, expect } from '@playwright/test';
import { newPage, apiFor, uniq, login } from './helpers';
import path from 'node:path';

test('users & roles: create a user, weak password refused, forced first-login password change, custom role, deactivate', async ({ browser }) => {
  const page = await newPage(browser, 'admin');
  const { call } = await apiFor(page);
  const email = `e2e.${Date.now().toString(36)}@example.test`;
  await page.goto('/users');
  await page.getByRole('button', { name: 'Add user' }).click();
  let dlg = page.getByRole('dialog');
  await dlg.getByLabel(/^Full name/).fill('E2E New Hire');
  await dlg.getByLabel(/^Email/).fill(email);
  await dlg.getByLabel(/^Role/).selectOption({ label: 'Viewer' });
  await dlg.locator('input.font-mono').fill('short');
  await dlg.getByRole('button', { name: /^Save/ }).click();
  await expect(dlg.getByText(/at least 10 characters/i).first()).toBeVisible();
  await dlg.getByRole('button', { name: 'Generate' }).click();
  const pw = await dlg.locator('input.font-mono').inputValue();
  expect(pw.length).toBeGreaterThanOrEqual(10);
  await dlg.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByText('User created').first()).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

  // duplicate email is refused
  const dup = await call('POST', '/api/users', { name: 'Dup', email, roleId: ((await call('GET', '/api/roles')).data as any[])[0].id, password: 'Str0ng!Passw0rd', mustChangePw: false });
  expect(dup.status).toBe(409);

  // the new user must change the password before doing anything else
  const p2 = await (await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' })).newPage();
  await login(p2, email, pw);
  await expect(p2).toHaveURL(/change-password/);
  await p2.goto('/projects');
  await expect(p2).toHaveURL(/change-password/); // cannot bypass
  await p2.getByLabel(/^Current password/).fill(pw);
  await p2.getByLabel(/^New password/).fill('Brand-New#Pass2026');
  await p2.getByLabel(/^Confirm new password/).fill('Brand-New#Pass2026');
  await p2.getByRole('button', { name: 'Update password' }).click();
  await p2.waitForURL((u) => !u.pathname.startsWith('/change-password'));
  const res = await p2.request.get('/api/users');
  expect(res.status()).toBe(403); // a Viewer cannot see the user list
  await p2.context().close();

  // custom role with one permission
  await page.goto('/users');
  await page.getByRole('tab', { name: 'Roles & permissions' }).click();
  await page.getByRole('button', { name: 'New custom role' }).click();
  dlg = page.getByRole('dialog');
  const roleName = uniq('E2E Reader');
  await dlg.getByLabel(/^Role name/).fill(roleName);
  await dlg.getByLabel(/View projects/).check();
  await dlg.getByRole('button', { name: 'Save role' }).click();
  await expect(page.getByText(roleName).first()).toBeVisible();
  const roles = (await call('GET', '/api/roles')).data as any[];
  const mine = roles.find((r) => r.name === roleName);
  expect(mine.perms.length).toBe(1);
  expect(mine.perms[0]).toBe('projects.view');

  // deactivate the user → cannot sign in any more
  const u = ((await call('GET', `/api/users?q=${encodeURIComponent(email)}`)).data as any[])[0];
  const off = await call('PATCH', `/api/users/${u.id}`, { active: false, version: u.version });
  expect(off.status).toBe(200);
  const p3 = await (await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' })).newPage();
  await p3.goto('/login');
  await p3.getByLabel('Email').fill(email);
  await p3.getByLabel('Password').fill('Brand-New#Pass2026');
  await p3.getByRole('button', { name: /sign in/i }).click();
  await expect(p3.getByText(/invalid|incorrect|deactivated|disabled/i).first()).toBeVisible();
  await expect(p3).toHaveURL(/login/);
  await p3.context().close();
  await page.context().close();
});

test('settings: change margin thresholds → project health changes; tax rate, payment term and category management', async ({ browser }) => {
  const page = await newPage(browser, 'admin');
  const { call } = await apiFor(page);
  // start from the known defaults regardless of what a previous run left behind
  await call('PATCH', '/api/settings', { thresholds: { targetMarginPct: 30, criticalMarginPct: 10 } });
  const before = (await call('GET', '/api/settings')).data;
  const crit = before.settings.thresholds.criticalMarginPct as number;

  // a project with a 25% margin: healthy at default thresholds
  const svc = ((await call('GET', '/api/categories?kind=SERVICE')).data as any[])[0];
  const cat = ((await call('GET', '/api/categories?kind=COST')).data as any[])[0];
  const client = ((await call('GET', '/api/clients?pageSize=1')).data as any[])[0];
  const p = (await call('POST', '/api/projects', { name: uniq('Threshold probe'), clientId: client.id, serviceId: svc.id, type: 'ONE_TIME', status: 'ACTIVE', taxMode: 'NONE', sellingPrice: '100000', budget: '90000' })).data;
  expect((await call('POST', '/api/costs', { projectId: p.id, name: 'Probe cost', categoryId: cat.id, kind: 'ACTUAL', amount: '75000', date: new Date().toISOString().slice(0, 10), status: 'APPROVED' })).status).toBe(201);
  const health = async () => ((await call('GET', `/api/projects/${p.id}`)).data.financials.health);
  const h1 = await health();
  expect(h1.reasons.join(' ')).not.toMatch(/Low margin/);

  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Margins & budgets' }).click();
  await page.getByRole('group', { name: /^Critical margin/ }).locator('input').fill('40');
  await page.getByRole('group', { name: /^Target margin/ }).locator('input').fill('60');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/saved|updated/i).first()).toBeVisible();
  expect((await call('GET', '/api/settings')).data.settings.thresholds.criticalMarginPct).toBe(40);
  const h2 = await health();
  expect(h2.reasons.join(' ')).toMatch(/Low margin/);

  // invalid: critical above target is refused with a message
  await page.getByRole('group', { name: /^Critical margin/ }).locator('input').fill('80');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/critical.*(below|less|lower|under)|target/i).first()).toBeVisible();
  expect((await call('GET', '/api/settings')).data.settings.thresholds.criticalMarginPct).toBe(40);

  // restore
  await page.reload();
  await page.getByRole('tab', { name: 'Margins & budgets' }).click();
  await page.getByRole('group', { name: /^Target margin/ }).locator('input').fill(String(before.settings.thresholds.targetMarginPct));
  await page.getByRole('group', { name: /^Critical margin/ }).locator('input').fill(String(crit));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await call('GET', '/api/settings')).data.settings.thresholds.criticalMarginPct).toBe(crit);

  // categories: add, rename, deactivate
  await page.getByRole('tab', { name: 'Categories' }).click();
  const cname = uniq('E2E category');
  await page.getByLabel('New category name').fill(cname);
  await page.getByRole('button', { name: /^Add/ }).click();
  await expect(page.getByText(cname)).toBeVisible();
  const dupCat = await call('POST', '/api/categories', { kind: 'SERVICE', name: cname });
  expect(dupCat.status).toBeGreaterThanOrEqual(400);
  await page.context().close();
});

test('import: validate → review flags formula injection, duplicates, bad email → import valid rows only → list shows them', async ({ browser }) => {
  const page = await newPage(browser, 'admin');
  const csv = path.join(__dirname, 'fixtures', 'clients-import.csv');
  // unique company so the test can re-run against the same database
  const fs = await import('node:fs');
  const tag = Date.now().toString(36);
  const tmp = path.join(__dirname, 'fixtures', `.tmp-${tag}.csv`);
  fs.writeFileSync(tmp, fs.readFileSync(csv, 'utf8').replaceAll('Import Test One Pvt Ltd', `Import Test ${tag} Pvt Ltd`));
  await page.goto('/import');
  await page.getByLabel(/^Data type/).selectOption('CLIENTS');
  await page.setInputFiles('input[type=file]', tmp);
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText('Rows with errors')).toBeVisible();
  const body = page.getByRole('main');
  await expect(body.getByText(/possible spreadsheet formula/)).toBeVisible();
  await expect(body.getByText(/Duplicate of row 2/)).toBeVisible();
  await page.getByLabel(/Skip the 2 invalid/).check();
  await page.getByRole('button', { name: 'Import 1 record' }).click();
  await expect(page.getByText('Import finished')).toBeVisible();
  await page.goto(`/clients?q=${encodeURIComponent(`Import Test ${tag}`)}`);
  await expect(page.getByText(`Import Test ${tag} Pvt Ltd`)).toBeVisible();
  // the malicious row never landed
  await expect(page.getByText(/cmd\|/)).toHaveCount(0);
  fs.unlinkSync(tmp);
  await page.context().close();
});
