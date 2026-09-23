import { test, expect } from '@playwright/test';
import { login, logout, apiFor, uniq, PASSWORD } from './helpers';

test.describe('authentication', () => {
  test('protected pages redirect to sign-in and return to the page afterwards', async ({ page }) => {
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login\?next=%2Fprojects/);
    await page.getByLabel('Email').fill('admin@demo.portal');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  });

  test('a wrong password gives a generic error and no session', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@demo.portal');
    await page.getByLabel('Password').fill('definitely-wrong-1A!');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/incorrect|invalid/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    const me = await page.request.get('/api/auth/me');
    expect(me.status()).toBe(401);
  });

  test('sign out ends the session: back button cannot show data and the API answers 401', async ({ page }) => {
    await login(page);
    await page.goto('/projects');
    await logout(page);
    expect((await page.request.get('/api/projects')).status()).toBe(401);
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a new user must change the temporary password before using the portal', async ({ page }) => {
    await login(page);
    const { call } = await apiFor(page);
    const roles = (await call('GET', '/api/roles')).data as { id: string; key: string }[];
    const email = `${uniq('newuser').replace(/\s/g, '')}@example.test`.toLowerCase();
    const temp = 'Temp#Passw0rd!x';
    const created = await call('POST', '/api/users', { name: 'New User', email, roleId: roles.find((r) => r.key === 'VIEWER')!.id, password: temp, mustChangePw: true });
    expect(created.status).toBe(201);
    await logout(page);

    await login(page, email, temp);
    await expect(page).toHaveURL(/change-password/);
    // the rest of the app is unreachable until the password is changed
    await page.goto('/projects');
    await expect(page).toHaveURL(/change-password/);

    await page.getByLabel(/^Current password/).fill(temp);
    await page.getByLabel(/^New password/).fill('weak');
    await page.getByLabel(/^Confirm new password/).fill('weak');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByText(/at least 10 characters/i).first()).toBeVisible();

    const strong = 'Fresh#Passw0rd!2026';
    await page.getByLabel(/^New password/).fill(strong);
    await page.getByLabel(/^Confirm new password/).fill(strong);
    await page.getByRole('button', { name: 'Update password' }).click();
    await page.waitForURL((u) => !u.pathname.includes('change-password'));
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});
