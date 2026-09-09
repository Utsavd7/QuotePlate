import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { DEMO_OWNER_EMAIL } from '../../src/lib/demo/identity';

// Never persist login traces, screenshots, cookies or passwords in performance artifacts.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const fixtureOrigin = process.env.AUTH_E2E_FIXTURE_ORIGIN ?? 'http://127.0.0.1:52562';
const isLocal = (url: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

async function collapseGuide(page: Page) {
  await expect(page.getByRole('complementary', { name: 'Setup guide', exact: true })).toBeVisible();
  const collapse = page.getByRole('button', { name: 'Collapse setup guide', exact: true });
  if (await collapse.isVisible()) await collapse.click();
}

async function navigationLink(page: Page, name: string) {
  const open = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await open.isVisible()) await open.click();
  return page.getByRole('navigation', { name: 'Workspace navigation', exact: true })
    .getByRole('link', { name, exact: true });
}

test('Today → Suppliers → Today renders cached attention without another overview request', async ({ page }, info) => {
  test.setTimeout(90_000);
  expect(isLocal(String(info.project.use.baseURL)), 'Only run against the local test harness').toBe(true);
  expect(isLocal(fixtureOrigin), 'Only use the local fixture gateway').toBe(true);
  // Create-only fixture; never reset the database or change existing restaurant records.
  const seeded = await page.request.post(`${fixtureOrigin}/__test/database/internal-demo`);
  expect(seeded.status(), await seeded.text()).toBe(201);

  // Test the fresh-cache contract deterministically even on slow CI. Real timers and
  // performance.now still run; TTL expiration and stale refresh have separate unit tests.
  await page.clock.setFixedTime(new Date());
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    Object.assign(window, { overviewTransportSignals: [] as boolean[] });
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (new URL(url, location.href).pathname === '/api/overview') {
        (window as unknown as { overviewTransportSignals: boolean[] }).overviewTransportSignals
          .push(Boolean(init?.signal ?? (input instanceof Request ? input.signal : undefined)));
      }
      return original(input, init);
    };
  });
  let overviewRequests = 0;
  await page.route('**/api/overview', async route => {
    overviewRequests += 1;
    // Any repeat fetch fails immediately. A successful return therefore cannot hide
    // a network wait behind a generous timing assertion or a mocked successful payload.
    if (overviewRequests > 1) await route.abort('failed');
    else await route.fallback();
  });
  await page.goto('/signin');
  await page.getByLabel('Work email').fill(DEMO_OWNER_EMAIL);
  await page.getByLabel('Password').fill('Local-only demo password 42!');
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const attention = page.getByRole('region', { name: 'Needs your attention', exact: true });
  await expect(attention).toBeVisible();
  const originalAttention = await attention.innerText();
  expect(originalAttention.trim().length).toBeGreaterThan('Needs your attention'.length);
  await collapseGuide(page);
  expect(overviewRequests).toBe(1);

  const writes: string[] = [];
  await page.route('**/api/**', async route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      writes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.abort('blockedbyclient');
    } else await route.fallback();
  });
  await (await navigationLink(page, 'Suppliers')).click();
  await expect(page).toHaveURL(/\/suppliers$/);
  await expect(page.getByRole('region', { name: 'Supplier directory', exact: true })).toBeVisible();
  await expect(attention).toHaveCount(0);
  await collapseGuide(page);
  const today = await navigationLink(page, 'Today');
  await today.evaluate(element => element.addEventListener('click', () => {
    performance.mark('cached-today-click');
  }, { once: true }));
  await today.click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(attention).toBeVisible();
  await expect(attention).toHaveText(originalAttention, { useInnerText: true });
  const sample = await page.evaluate(() => ({
    clickToAttentionObservedMs: performance.now() - performance.getEntriesByName('cached-today-click')[0].startTime,
    overviewTransportSignals: (window as unknown as { overviewTransportSignals: boolean[] }).overviewTransportSignals,
  }));
  expect(sample.overviewTransportSignals).toEqual([true]);
  expect(overviewRequests).toBe(1);
  expect(writes).toEqual([]);
  const path = info.outputPath('cached-today-navigation.json');
  await writeFile(path, JSON.stringify({ ...sample, overviewRequests, project: info.project.name,
    note: 'Observed after Playwright visibility assertion; fresh TTL held fixed, not a production latency benchmark.' }, null, 2));
  await info.attach('cached Today navigation', { path, contentType: 'application/json' });
});
