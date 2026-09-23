import { test, expect } from '@playwright/test';
import { newPage, apiFor, uniq } from './helpers';

test.describe('role-based access in the UI', () => {
  test('viewer: read-only — no create buttons, no admin pages, profit visible', async ({ browser }) => {
    const page = await newPage(browser, 'viewer');
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('link', { name: /new project/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /new project/i })).toHaveCount(0);
    for (const path of ['/users', '/settings', '/import', '/audit']) {
      await page.goto(path);
      await expect(page.getByText(/don.t have access to this page/i)).toBeVisible();
    }
    // API level: the same restriction holds even if the UI is bypassed
    const { call } = await apiFor(page);
    expect((await call('POST', '/api/clients', { companyName: 'Hacker Inc' })).status).toBe(403);
    expect((await call('GET', '/api/users')).status).toBe(403);
    await page.context().close();
  });

  test('project manager: sees only assigned projects and no revenue / profit figures', async ({ browser }) => {
    const admin = await newPage(browser, 'admin');
    const a = await apiFor(admin);
    const all = (await a.call('GET', '/api/projects?pageSize=200')).data as any[];
    await admin.context().close();

    const page = await newPage(browser, 'pm');
    const { call } = await apiFor(page);
    const mine = (await call('GET', '/api/projects?pageSize=200')).data as any[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length); // row-level scope
    const notMine = all.find((p) => !mine.some((m) => m.id === p.id))!;
    expect((await call('GET', `/api/projects/${notMine.id}`)).status).toBe(404); // existence not leaked

    await page.goto(`/projects/${mine[0].id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Actual profit')).toHaveCount(0);
    await expect(page.getByText('Contract value')).toHaveCount(0);
    await expect(page.getByText(/Margin \d/)).toHaveCount(0);
    // dashboard hides profit widgets and does not leak margin in the "why" column
    await page.goto('/');
    await expect(page.getByText('Most profitable')).toHaveCount(0);
    await expect(page.getByText('Lowest margin')).toHaveCount(0);
    await expect(page.getByText(/Margin below target|Low margin|Overdue payments/)).toHaveCount(0);
    await page.context().close();
  });

  test('team member: sees assigned projects only and has no access to company expenses', async ({ browser }) => {
    const page = await newPage(browser, 'member');
    const { call } = await apiFor(page);
    const mine = (await call('GET', '/api/projects?pageSize=200')).data as any[];
    expect(mine.length).toBeGreaterThan(0);
    await page.goto('/expenses');
    await expect(page.getByText(/don.t have access to this page/i)).toBeVisible();
    expect((await call('GET', '/api/expenses')).status).toBe(403);
    await page.context().close();
  });
});

test.describe('approval workflow', () => {
  test('a cost above the approval threshold is held for approval and cannot be self-approved; an approver releases it', async ({ browser }) => {
    const finance = await newPage(browser, 'finance'); // has costs.create + approvals.decide
    const admin = await newPage(browser, 'admin');
    const fa = await apiFor(finance); const aa = await apiFor(admin);

    // a project the PM manages, with a big budget so only the *amount* threshold triggers approval
    const roles = (await aa.call('GET', '/api/users?pageSize=100')).data as any[];
    const pm = roles.find((u) => u.email === 'pm@demo.portal');
    const clients = (await aa.call('GET', '/api/clients?pageSize=1')).data as any[];
    const svc = ((await aa.call('GET', '/api/categories?kind=SERVICE')).data as any[])[0];
    const cat = ((await aa.call('GET', '/api/categories?kind=COST')).data as any[])[0];
    const proj = await aa.call('POST', '/api/projects', { name: uniq('Approval Flow'), clientId: clients[0].id, serviceId: svc.id, type: 'ONE_TIME', status: 'ACTIVE', taxMode: 'NONE', sellingPrice: '900000', budget: '800000', managerId: pm.id });
    expect(proj.status).toBe(201);

    // PM submits a ₹60,000 cost (threshold is ₹25,000) through the UI
    const pmPage = await newPage(browser, 'pm');
    await pmPage.goto(`/projects/${proj.data.id}?tab=costs`);
    await pmPage.getByRole('button', { name: 'Add cost' }).first().click();
    const dlg = pmPage.getByRole('dialog');
    await dlg.getByLabel(/^Name/).fill('Freelance sprint');
    await dlg.getByLabel(/^Category/).selectOption({ label: cat.name });
    await dlg.getByLabel(/^Amount/).fill('60000');
    await dlg.getByRole('button', { name: 'Add cost' }).click();
    await expect(pmPage.getByText(/Sent for approval/)).toBeVisible();
    let f = (await aa.call('GET', `/api/projects/${proj.data.id}`)).data.financials;
    expect(f.cost.actual).toBe(0);            // not counted yet
    expect(f.cost.pendingApproval).toBe(6000000);

    // the requester can never approve their own request
    const mine = (await (await pmPage.request.get('/api/approvals?mine=1')).json()).data as any[];
    const req = mine.find((r) => r.projectId === proj.data.id);
    expect(req.canDecide).toBe(false);
    const pmApi = await apiFor(pmPage);
    expect((await pmApi.call('POST', `/api/approvals/${req.id}/decide`, { decision: 'APPROVED' })).status).toBe(403);

    // approver rejects without a reason in the UI → blocked; approves → cost counts
    await admin.goto('/approvals');
    const row = admin.getByRole('row').filter({ hasText: 'Freelance sprint' });
    await row.getByRole('button', { name: 'Reject' }).click();
    await expect(admin.getByRole('button', { name: 'Reject' }).last()).toBeDisabled(); // reason required
    await admin.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await row.getByRole('button', { name: 'Approve' }).click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(admin.getByText(/Approved — the change has been applied/)).toBeVisible();
    f = (await aa.call('GET', `/api/projects/${proj.data.id}`)).data.financials;
    expect(f.cost.actual).toBe(6000000);
    expect(f.cost.pendingApproval).toBe(0);
    // deciding twice is refused
    expect((await aa.call('POST', `/api/approvals/${req.id}/decide`, { decision: 'APPROVED' })).status).toBeGreaterThanOrEqual(400);
    // the requester was notified
    const notes = (await (await pmPage.request.get('/api/notifications?pageSize=20')).json()).data as any[];
    expect(notes.some((n) => /approved/i.test(n.title))).toBe(true);
    for (const p of [finance, admin, pmPage]) await p.context().close();
    void fa;
  });
});
