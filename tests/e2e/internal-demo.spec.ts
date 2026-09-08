import { expect, test } from '@playwright/test';
import { DEMO_OWNER_EMAIL, DEMO_TENANT_ID } from '../../src/lib/demo/identity';

test('internal demo signs in normally, shows populated workspaces and saves owner edits', async ({ page }, info) => {
  const seeded = await page.request.post(`${process.env.AUTH_E2E_FIXTURE_ORIGIN ?? 'http://127.0.0.1:52562'}/__test/database/internal-demo`);
  expect(seeded.status(), await seeded.text()).toBe(201);
  await page.goto('/signin');
  await page.getByLabel('Work email').fill(DEMO_OWNER_EMAIL);
  await page.getByLabel('Password').fill('Local-only demo password 42!');
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('complementary', { name: 'Demo workspace notice' })).toContainText('fictional restaurant records');
  const contents = await page.evaluate(async () => {
    const urls = ['/api/account', '/api/suppliers?active=all', '/api/requests', '/api/menus', '/api/service-planning', '/api/supplier-performance'];
    return Promise.all(urls.map(async url => { const response = await fetch(url); return { url, status: response.status, body: await response.json() }; }));
  });
  for (const result of contents) expect(result.status, result.url).toBe(200);
  expect(contents[0].body.workspaceId).toBe(DEMO_TENANT_ID);
  expect(contents[1].body.suppliers).toHaveLength(8);
  expect(contents[2].body.requests).toHaveLength(10);
  expect(contents[3].body.menus).toHaveLength(1);
  expect(contents[4].body.plans).toHaveLength(2);
  expect(contents[4].body.menus[0].document.dishes).toHaveLength(12);
  expect(contents[5].body.awardSampleSize).toBe(7);
  for (const path of ['/menus', '/suppliers', '/procurement', '/supplier-performance', '/service-planning']) {
    await page.goto(path);
    await expect(page.getByRole('complementary', { name: 'Demo workspace notice' })).toBeVisible();
    await expect(page.getByRole('main').first()).toBeVisible();
  }
  await page.goto('/settings');
  const name = page.getByLabel('Restaurant or company name');
  const changed = `DEMO · Monsoon Table ${info.project.name}`;
  await name.fill(changed);
  await page.getByRole('button', { name: 'Save restaurant details' }).click();
  await expect(page.getByText('Restaurant details saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(name).toHaveValue(changed);
  await expect(page.getByRole('complementary', { name: 'Demo workspace notice' })).toBeVisible();
});
