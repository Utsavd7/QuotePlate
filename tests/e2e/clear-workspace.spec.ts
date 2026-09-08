import { expect, test } from '@playwright/test';
import { DEMO_OWNER_EMAIL } from '../../src/lib/demo/identity';
import { expectNoSeriousAxeViolations } from './helpers/accessibility';

// Exercise real seeded records and normal authentication; no live tenant changes.
test('five main choices keep planning, history, supplier replies and reports reachable', async ({ page }, info) => {
  if (info.project.name === 'desktop-chromium') await page.setViewportSize({ width: 1440, height: 900 });
  const seed = await page.request.post(`${process.env.AUTH_E2E_FIXTURE_ORIGIN ?? 'http://127.0.0.1:52562'}/__test/database/internal-demo`);
  expect(seed.status()).toBe(201);
  await page.goto('/signin');
  await page.getByLabel('Work email').fill(DEMO_OWNER_EMAIL);
  await page.getByLabel('Password').fill('Local-only demo password 42!');
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.screenshot({path: `/tmp/quoteplate-redesign-${info.project.name}-today.png`});
  await expectNoSeriousAxeViolations(page);
  // Seeded IDs contain a colon: client navigation must not double-encode it.
  await page.getByRole('link', { name: /DEMO · Midweek staples comparison/ }).click();
  await expect(page.getByRole('heading', { name: 'DEMO · Midweek staples comparison', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Supplier prices', exact: true })).toBeVisible();
  await page.goto('/dashboard');
  const mobile = (page.viewportSize()?.width ?? 1440) < 1024;
  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  const navigation = page.getByRole('navigation', { name: 'Workspace navigation', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(5);
  for (const name of ['Today', 'Purchases', 'Suppliers', 'Menu', 'Reports']) {
    await expect(navigation.getByRole('link', { name, exact: true })).toBeVisible();
  }
  if (mobile) await page.getByRole('dialog', { name: 'Workspace navigation' }).getByRole('button', { name: 'Close navigation' }).click();
  await page.getByRole('navigation', { name: 'Today sections' }).getByRole('link', { name: 'Plan meals' }).click();
  await expect(page).toHaveURL(/\/service-planning$/);
  await expect(page.locator('main h1')).toBeVisible();

  await page.goto('/procurement');
  await page.getByRole('navigation', { name: 'Purchases sections' }).getByRole('link', { name: 'Past purchases' }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.locator('main h1')).toBeVisible();

  await page.goto('/suppliers');
  await expect(page.getByRole('region', { name: 'Supplier directory' })).toBeVisible();
  await page.screenshot({path: `/tmp/quoteplate-redesign-${info.project.name}-suppliers.png`});
  const discovery = page.locator('main > details').filter({ has: page.locator('summary', { hasText: 'Find nearby suppliers' }) });
  await expect(discovery).not.toHaveAttribute('open', '');
  await discovery.locator(':scope > summary').click();
  await expect(discovery).toHaveAttribute('open', '');
  await expect(discovery.getByRole('heading').first()).toBeVisible();
  await discovery.locator(':scope > summary').click();
  await page.locator('summary').filter({ hasText: 'Import or export' }).click();
  await expect(page.getByRole('button', { name: 'Import CSV', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeVisible();

  const supplierSections = page.getByRole('navigation', { name: 'Suppliers sections' });
  await supplierSections.getByRole('link', { name: 'Orders & messages' }).click();
  await expect(page).toHaveURL(/\/supplier-collaboration$/);
  await expect(page.getByRole('combobox', { name: 'Supplier', exact: true })).toBeVisible();
  await supplierSections.getByRole('link', { name: 'Delivery record' }).click();
  await expect(page).toHaveURL(/\/supplier-performance$/);
  await expect(page.getByRole('heading', { name: 'Needs your attention', exact: true })).toBeVisible();
  const costs = page.locator('summary').filter({ hasText: 'Ingredient quantities & costs' }).first();
  await costs.click();
  await expect(page.getByRole('table').first()).toBeVisible();

  await page.goto('/menus');
  await page.getByRole('button', {name: /DEMO · Monsoon Table kitchen recipes/}).click();
  await expect(page.getByRole('textbox', {name: 'Menu name', exact: true})).toHaveValue('DEMO · Monsoon Table kitchen recipes');

  await page.goto('/insights');
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
  await page.screenshot({path: `/tmp/quoteplate-redesign-${info.project.name}-reports.png`});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (!mobile) {
    await page.setViewportSize({ width: 1366, height: 768 });
    for (const [route, heading] of [['/dashboard', 'Today'], ['/procurement', 'Purchases'], ['/suppliers', 'Suppliers'], ['/menus', 'Menu'], ['/insights', 'Reports'], ['/service-planning', 'Plan meals'], ['/settings', 'Restaurant settings']]) {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Workspace navigation', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({path: `/tmp/quoteplate-redesign-laptop-1366-${route.slice(1)}.png`});
    }
  }
});
