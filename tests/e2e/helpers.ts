import { expect, type Browser, type Page, type APIRequestContext } from '@playwright/test';

export const PASSWORD = 'Demo@Portal2026!';
export const uniq = (p: string) => `${p} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

export async function login(page: Page, email = 'admin@demo.portal', password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: /Super Admin|Project Manager|Finance|Team Member|Viewer|Admin/ }).last().click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL('**/login**');
}

/** authenticated request context (cookie + CSRF) for fast set-up and for reading back numbers */
export async function apiFor(page: Page) {
  const me = await (await page.request.get('/api/auth/me')).json();
  const csrf = me.data.csrfToken as string;
  const origin = new URL(page.url() === 'about:blank' ? 'http://localhost:3000' : page.url()).origin;
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => {
    const res = await page.request.fetch(path, { method, data: body, headers: { 'x-csrf-token': csrf, origin, 'content-type': 'application/json' } });
    const json = await res.json().catch(() => ({}));
    return { status: res.status(), json, data: json.data };
  };
  return { call, csrf };
}

/** money as shown in the UI (Indian grouping) */
export const rs = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible();
}
export type { APIRequestContext };

export const AUTH_DIR = 'qa/.auth';
export const ROLES = { admin: 'admin@demo.portal', finance: 'finance@demo.portal', pm: 'pm@demo.portal', member: 'member@demo.portal', viewer: 'viewer@demo.portal' } as const;
export type RoleName = keyof typeof ROLES;

/** a page in its own context, already signed in as `role` (session saved by global-setup, so logins stay under the rate limit) */
export async function newPage(browser: Browser, role: RoleName = 'admin') {
  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', viewport: { width: 1360, height: 900 }, acceptDownloads: true, storageState: `${AUTH_DIR}/${role}.json` });
  return ctx.newPage();
}
