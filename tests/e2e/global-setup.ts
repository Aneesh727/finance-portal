import { chromium, type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import { AUTH_DIR, ROLES, PASSWORD } from './helpers';

/** sign in once per role and save the session, so specs do not hit the login rate limit */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL ?? process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch(config.projects[0].use.launchOptions);
  for (const [role, email] of Object.entries(ROLES)) {
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
    await ctx.storageState({ path: `${AUTH_DIR}/${role}.json` });
    await ctx.close();
  }
  await browser.close();
}
