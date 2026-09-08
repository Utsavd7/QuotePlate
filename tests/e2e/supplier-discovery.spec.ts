import { expect, test } from '@playwright/test';

import { expectNoSeriousAxeViolations } from './helpers/accessibility';

test('finds external suppliers only on request and returns to the private supplier workflow', async ({ page, context }) => {
  const externalRequests: string[] = [];
  let supplierRequests = 0;
  await page.route('**/api/account', (route) => route.fulfill({
    json: {
      account: {
        name: 'Monsoon Table Pune', addressLine: '18 Koregaon Park Road',
        city: 'Pune', state: 'Maharashtra', pin: '411001',
      },
      workspaceId: 'tenant-a',
    },
  }));
  await page.route('**/api/suppliers?*', async (route) => {
    supplierRequests += 1;
    expect(route.request().method()).toBe('GET');
    await route.fulfill({ json: { suppliers: [], nextCursor: null } });
  });
  await context.route('https://www.google.com/**', async (route) => {
    externalRequests.push(route.request().url());
    expect(route.request().headers().referer).toBeUndefined();
    await route.fulfill({ contentType: 'text/html', body: '<title>External search test destination</title>' });
  });

  await page.goto('/suppliers');
  await expect(page.getByRole('heading', { name: 'Suppliers', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add your first supplier' })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Find nearby suppliers' }).click();
  const panel = page.locator('details').filter({ has: page.locator(':scope > summary', { hasText: 'Search other websites' }) });
  await expect(panel).not.toHaveAttribute('open', '');
  const summary = panel.locator('summary');
  await summary.focus();
  await summary.press('Enter');
  await expect(panel).toHaveAttribute('open', '');

  const form = panel.getByRole('form', { name: 'Find nearby suppliers' });
  await form.getByLabel('Ingredient or category').fill('पनीर & dairy');
  await form.getByLabel('Locality').fill('Andheri East');
  await form.getByLabel('City', { exact: true }).fill('Mumbai');
  await form.getByLabel('State').fill('Maharashtra');
  await form.getByLabel('PIN code').fill('400069');
  const initialSupplierRequests = supplierRequests;
  await form.getByRole('button', { name: 'Choose a search website' }).click();

  const websites = panel.getByRole('region', { name: 'Supplier search websites' });
  const links = websites.getByRole('link');
  await expect(links).toHaveCount(8);
  const query = 'पनीर & dairy supplier in Andheri East, Mumbai, Maharashtra, 400069, India';
  const expectedDomains = [null, null, 'justdial.com', 'indiamart.com', 'tradeindia.com', 'exportersindia.com', 'in.kompass.com', 'go4worldbusiness.com'];
  const names = ['Google Maps', 'Google Search', 'Justdial', 'IndiaMART', 'TradeIndia', 'ExportersIndia', 'Kompass India', 'go4WorldBusiness'];
  for (let index = 0; index < names.length; index += 1) {
    const link = websites.getByRole('link', { name: new RegExp(`^${names[index]}`) });
    const href = new URL((await link.getAttribute('href'))!);
    expect(href.origin).toBe('https://www.google.com');
    expect(href.searchParams.get(index === 0 ? 'query' : 'q')).toBe(
      expectedDomains[index] ? `site:${expectedDomains[index]} ${query}` : query,
    );
    if (index === 0) expect(href.searchParams.get('api')).toBe('1');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    if (index > 1) await expect(link).toContainText('Search this website via Google');
  }
  expect(externalRequests).toEqual([]);
  expect(supplierRequests).toBe(initialSupplierRequests);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectNoSeriousAxeViolations(page, 'details[open]');

  const mapsLink = websites.getByRole('link', { name: /^Google Maps/ });
  const mapsHref = await mapsLink.getAttribute('href');
  const [externalPage] = await Promise.all([context.waitForEvent('page'), mapsLink.click()]);
  await expect(externalPage).toHaveTitle('External search test destination');
  expect(externalRequests).toEqual([mapsHref]);
  await externalPage.close();

  await form.getByLabel('City', { exact: true }).fill('Pune');
  await expect(websites).toHaveCount(0);
  expect(externalRequests).toHaveLength(1);

  await panel.getByRole('button', { name: 'Add reviewed supplier' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add supplier', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/Business name/)).toHaveValue('');
  await expect(dialog.getByLabel('City', { exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Add reviewed supplier' })).toBeFocused();
});
