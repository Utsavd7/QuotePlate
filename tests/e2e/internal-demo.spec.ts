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
  const menuId = contents[3].body.menus[0].id;
  const purchaseIds = ['DRAFT', 'OPEN', 'AWARDED'].map(status => contents[2].body.requests.find((item: { status: string }) => item.status === status)?.id).filter(Boolean);
  expect(purchaseIds).toHaveLength(3);
  let contentLeft: number | undefined;
  for (const path of ['/dashboard', '/menus', `/menus/${menuId}`, '/suppliers', '/procurement', '/procurement/new', ...purchaseIds.map(id => `/procurement/${id}`), '/history', '/insights', '/supplier-performance', '/supplier-collaboration', '/service-planning', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('complementary', { name: 'Demo workspace notice' })).toBeVisible();
    const main = page.getByRole('main').first();
    await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
    const geometry = await main.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const heading = element.querySelector('h1')!.getBoundingClientRect();
      const footer = Array.from(document.querySelectorAll('footer')).at(-1)!.querySelector('span')!.getBoundingClientRect();
      const typography = getComputedStyle(element.querySelector('h1')!);
      return { left: rect.left, right: rect.right, headingLeft: heading.left, footerLeft: footer.left, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, titleFont: typography.fontFamily, titleWeight: typography.fontWeight, titleSize: parseFloat(typography.fontSize) };
    });
    contentLeft ??= geometry.left;
    expect(Math.abs(geometry.left - contentLeft), `${path}: page alignment`).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.headingLeft - geometry.footerLeft), `${path}: header/footer alignment`).toBeLessThanOrEqual(1);
    expect(geometry.overflow, `${path}: horizontal page overflow`).toBeLessThanOrEqual(1);
    expect(geometry.titleFont, `${path}: title font`).toContain('Manrope');
    expect(geometry.titleWeight, `${path}: title weight`).toBe('750');
    expect(geometry.titleSize, `${path}: title size`).toBe(page.viewportSize()!.width <= 700 ? 24 : 28);
    if (path === '/history') {
      const repeat = main.getByRole('button', { name: 'Repeat order', exact: true }).first();
      await expect(repeat).toBeVisible();
      const box = (await repeat.boundingBox())!;
      expect(box.x, 'Repeat action left edge').toBeGreaterThanOrEqual(geometry.headingLeft);
      expect(box.x + box.width, 'Repeat action stays inside the page without sideways scrolling').toBeLessThanOrEqual(geometry.right - (geometry.headingLeft - geometry.left));
    }
    await page.screenshot({ path: info.outputPath(`layout-${path.replaceAll('/', '-').replace(/[^a-z0-9-]/gi, '')}.png`) });
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    if (page.viewportSize()!.width >= 1024) {
      const sidebar = page.getByRole('complementary').filter({ has: page.getByRole('navigation', { name: 'Workspace navigation' }) });
      await expect(sidebar).toBeVisible();
      expect((await sidebar.boundingBox())!.y, `${path}: pinned sidebar`).toBe(0);
    }
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
