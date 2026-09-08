import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { DEMO_OWNER_EMAIL } from '../../src/lib/demo/identity';
import { expectNoSeriousAxeViolations } from './helpers/accessibility';

test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

// Local seeded data only. These tests never dispatch invitations, awards or supplier messages.
const fixtureOrigin = process.env.AUTH_E2E_FIXTURE_ORIGIN ?? 'http://127.0.0.1:52562';
const demoPassword = 'Local-only demo password 42!';
const local = (url: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
// Reuse only an in-memory, normally authenticated local session within this worker.
// Every test still gets a fresh page/context; cookies are never written to an artifact.
let demoCookies: Awaited<ReturnType<ReturnType<Page['context']>['cookies']>> | undefined;

async function signIn(page: Page, info: TestInfo) {
  expect(local(String(info.project.use.baseURL ?? 'http://127.0.0.1:52560')), 'This suite must not run against a live deployment').toBe(true);
  expect(local(fixtureOrigin), 'Use the local fixture gateway').toBe(true);
  const seeded = await page.request.post(`${fixtureOrigin}/__test/database/internal-demo`);
  expect(seeded.status(), await seeded.text()).toBe(201);
  if (demoCookies) {
    await page.context().addCookies(demoCookies);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('complementary', { name: 'Demo workspace notice' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await collapseGuide(page);
    return;
  }
  await page.goto('/signin');
  await page.getByLabel('Work email').fill(DEMO_OWNER_EMAIL);
  await page.getByLabel('Password').fill(demoPassword);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('complementary', { name: 'Demo workspace notice' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await collapseGuide(page);
  demoCookies = await page.context().cookies();
}

async function forbidWrites(page: Page) {
  const attempts: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      attempts.push(`${request.method()} ${new URL(request.url()).pathname}`);
      await route.abort('blockedbyclient');
    } else await route.fallback();
  });
  return attempts;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), page.url()).toBeLessThanOrEqual(1);
}

async function collapseGuide(page: Page) {
  // Wait for tutorial hydration: checking only the close button can race its GET.
  await expect(page.getByRole('complementary', { name: 'Setup guide', exact: true })).toBeVisible();
  const collapse = page.getByRole('button', { name: 'Collapse setup guide', exact: true });
  if (await collapse.isVisible()) {
    await collapse.click();
    await expect(collapse).toHaveCount(0);
  }
}

async function routeReady(page: Page, route: string) {
  if (route.startsWith('/menus/')) {
    // The editable name is the stable editor signal even if its heading changes.
    await expect(page.getByRole('textbox', { name: 'Menu name', exact: true })).toHaveValue(/\S/);
  } else {
    await expect(page.locator('main h1').first()).toBeVisible();
  }
  if (route === '/procurement') await expect(page.getByRole('region', { name: 'Procurement requests', exact: true })).toBeVisible();
  if (route === '/suppliers') await expect(page.getByRole('region', { name: 'Supplier directory', exact: true })).toBeVisible();
  if (route === '/settings') await expect(page.getByLabel('Restaurant or company name')).toHaveValue(/\S/);
  if (route === '/history') await expect(page.getByRole('button', { name: 'Repeat order', exact: true }).first()).toBeVisible();
  if (route === '/service-planning' || route === '/supplier-collaboration') {
    const select = page.getByRole('combobox', { name: route === '/service-planning' ? 'Saved plan' : 'Supplier', exact: true });
    await expect(select).toBeVisible();
    await expect.poll(() => select.locator('option').count()).toBeGreaterThan(1);
  }
  if (route === '/supplier-performance') await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  if (route === '/insights' || route === '/intelligence') await expect(page.getByRole('region', { name: 'Procurement summary', exact: true })).toBeVisible();
  await collapseGuide(page);
}

async function visibleFocus(page: Page, target: Locator) {
  await page.keyboard.press('Tab');
  await target.focus();
  await expect(target).toBeFocused();
  await expect(target).toHaveCSS('outline-style', 'solid');
  await expect(target).toHaveCSS('outline-color', 'rgb(40, 94, 77)');
  expect(await target.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
}

async function trapCycles(page: Page, dialog: Locator) {
  const controls = dialog.locator('button:enabled, input:enabled, select:enabled, textarea:enabled, a[href]').filter({ visible: true });
  await controls.last().focus();
  await page.keyboard.press('Tab');
  await expect(controls.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(controls.last()).toBeFocused();
}

async function records(page: Page) {
  const menusResponse = await page.request.get('/api/menus');
  const requestsResponse = await page.request.get('/api/requests');
  expect(menusResponse.ok()).toBe(true);
  expect(requestsResponse.ok()).toBe(true);
  const menus = (await menusResponse.json()).menus as Array<{ id: string }>;
  const requests = (await requestsResponse.json()).requests as Array<{ id: string; status: string }>;
  expect(menus.length).toBeGreaterThan(0);
  expect(requests.some(request => request.status === 'AWARDED')).toBe(true);
  return { menuId: menus[0].id, awardedId: requests.find(request => request.status === 'AWARDED')!.id };
}

for (const size of ['1440', '1366', 'mobile'] as const) {
  test(`all 14 workspace route patterns share the theme and fit ${size}`, async ({ page }, info) => {
    test.skip(size === 'mobile' ? info.project.name !== 'mobile-chromium' : info.project.name !== 'desktop-chromium', 'One viewport matrix per matching device project.');
    test.setTimeout(240_000);
    if (size !== 'mobile') await page.setViewportSize({ width: Number(size), height: size === '1440' ? 900 : 768 });
    await signIn(page, info);
    const writes = await forbidWrites(page);
    const { menuId, awardedId } = await records(page);
    const routes = ['/dashboard', '/procurement', '/procurement/new', `/procurement/${encodeURIComponent(awardedId)}`,
      '/menus', `/menus/${encodeURIComponent(menuId)}`, '/suppliers', '/supplier-collaboration', '/supplier-performance',
      '/service-planning', '/history', '/settings', '/insights', '/intelligence'];
    const audit: unknown[] = [];
    for (const route of routes) {
      await test.step(route, async () => {
        await page.goto(route);
        if (route === '/intelligence') await expect(page).toHaveURL(/\/insights$/);
        await routeReady(page, route);
        const titleControl = route.startsWith('/menus/') ? page.getByRole('textbox', { name: 'Menu name', exact: true }) : page.locator('main h1').first();
        await expect(titleControl).toHaveCSS('font-family', /Manrope/);
        await expect(page.getByRole('complementary', { name: 'Demo workspace notice' })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const screenshotName = `workspace-${size}-${route.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '')}.png`;
        const screenshotPath = info.outputPath(screenshotName);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await info.attach(screenshotName, { path: screenshotPath, contentType: 'image/png' });
        await noOverflow(page);
        const theme = await page.evaluate(() => {
          const body = getComputedStyle(document.body);
          const probe = document.createElement('span');
          document.body.append(probe);
          const resolvedColor = (token: string) => {
            probe.style.color = `var(${token})`;
            return getComputedStyle(probe).color;
          };
          const accent = resolvedColor('--workspace-accent');
          const surface = resolvedColor('--workspace-surface');
          probe.remove();
          return { background: body.backgroundColor, font: body.fontFamily,
            accent, surface };
        });
        expect(theme).toMatchObject({ background: 'rgb(246, 247, 245)', accent: 'rgb(40, 94, 77)', surface: 'rgb(255, 255, 255)' });
        const main = page.getByRole('main').first();
        await expect(main).toHaveCSS('background-color', 'rgb(246, 247, 245)');
        await expect(main).toHaveCSS('font-family', /Manrope/);
        const routeTheme = await main.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, font: getComputedStyle(element).fontFamily, color: getComputedStyle(element).color }));
        const firstControl = page.locator('main button:enabled, main a[href], main input:enabled, main select:enabled, main summary').filter({ visible: true }).first();
        await expect(firstControl).toBeVisible();
        await visibleFocus(page, firstControl);
        await expectNoSeriousAxeViolations(page);
        audit.push({ route, finalPath: new URL(page.url()).pathname, viewport: page.viewportSize(), theme, routeTheme,
          controls: await page.locator('main button, main a[href], main input, main select, main summary').filter({ visible: true }).evaluateAll(elements => elements.map(element => ({
            tag: element.tagName.toLowerCase(), label: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 120),
            disabled: element.matches(':disabled'), color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor,
          }))) });
      });
    }
    expect(writes).toEqual([]);
    await info.attach(`workspace-theme-and-control-inventory-${size}`, { body: JSON.stringify(audit, null, 2), contentType: 'application/json' });
  });
}

test('invite dialog validates locally, traps focus and dismisses through every non-submitting control', async ({ page }, info) => {
  await signIn(page, info);
  const writes = await forbidWrites(page);
  await page.goto('/settings');
  await collapseGuide(page);
  const opener = page.getByRole('button', { name: 'Invite someone', exact: true });
  for (const dismissal of ['Cancel', 'Close invite dialog', 'Escape']) {
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Invite a teammate' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Create invitation' })).toBeDisabled();
    await dialog.getByLabel('Work email').fill('not-an-email');
    await dialog.getByRole('radio', { name: /^Owner/ }).check();
    await expect(dialog.getByRole('radio', { name: /^Owner/ })).toBeChecked();
    await dialog.getByRole('radio', { name: /^Member/ }).check();
    await dialog.getByRole('button', { name: 'Create invitation' }).click();
    expect(await dialog.getByLabel('Work email').evaluate((element: HTMLInputElement) => element.validity.typeMismatch)).toBe(true);
    await expect(dialog).toBeVisible();
    await trapCycles(page, dialog);
    await noOverflow(page);
    await expectNoSeriousAxeViolations(page);
    if (dismissal === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: dismissal, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
  // The full-screen scrim is a separate accessible dismissal button.
  await opener.click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click({ position: { x: 2, y: 2 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(writes).toEqual([]);
});

test('access confirmations cancel without mutation and restore focus (mocked extra rows)', async ({ page }, info) => {
  await signIn(page, info);
  const writes = await forbidWrites(page);
  // Real settings/owner permissions; only two extra UI rows are mocked. No invitations are created.
  await page.route('**/api/settings', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    body.members.push({ id: 'polish-mocked-member', name: 'Fictional audit member', email: 'audit-member@fixture.example', role: 'MEMBER', joinedAt: '2026-09-01T00:00:00.000Z', lastLoginAt: null, isCurrentUser: false });
    body.pendingInvitations.push({ id: 'polish-mocked-invitation', email: 'audit-invite@fixture.example', role: 'MEMBER', expiresAt: '2099-09-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z', invitedByName: 'Fictional audit owner' });
    await route.fulfill({ response, json: body });
  });
  await page.goto('/settings');
  await collapseGuide(page);
  for (const [label, title] of [['Deactivate', 'Deactivate Fictional audit member?'], ['Revoke', 'Revoke this invitation?']]) {
    const opener = page.getByRole('button', { name: label, exact: true });
    for (const dismissal of ['Keep access', 'Close confirmation', 'Escape']) {
      await opener.click();
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await expect(dialog).toBeVisible();
      await trapCycles(page, dialog);
      await noOverflow(page);
      if (dismissal === 'Escape') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: dismissal, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    }
  }
  expect(writes).toEqual([]);
});

test('purchase filters and repeat-order dialog explore and cancel without creating records', async ({ page }, info) => {
  await signIn(page, info);
  const writes = await forbidWrites(page);
  const listed = await page.request.get('/api/requests');
  expect(listed.ok()).toBe(true);
  const requests = (await listed.json()).requests as Array<{ status: string; title: string }>;
  await page.goto('/procurement');
  await collapseGuide(page);
  const filters = page.getByRole('navigation', { name: 'Filter requests' }).getByRole('button');
  await expect(filters).toHaveCount(5);
  for (let index = 0; index < 5; index++) {
    await filters.nth(index).click();
    await expect(filters.nth(index)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('navigation', { name: 'Filter requests' }).locator('[aria-pressed="true"]')).toHaveCount(1);
    const status = ['ALL', 'DRAFT', 'OPEN', 'AWARDED', 'CANCELLED'][index];
    const expected = requests.filter(request => status === 'ALL' || request.status === status);
    const rows = page.getByRole('region', { name: 'Procurement requests', exact: true }).getByRole('button');
    await expect(rows).toHaveCount(expected.length);
    for (const request of expected) await expect(rows.filter({ hasText: request.title })).toHaveCount(1);
    if (!expected.length) await expect(page.getByText('No requests match this filter.', { exact: true })).toBeVisible();
    await noOverflow(page);
  }
  await filters.first().click();
  await page.goto('/history');
  await collapseGuide(page);
  const opener = page.getByRole('button', { name: 'Repeat order', exact: true }).first();
  for (const dismissal of ['Cancel', 'Close repeat request', 'Escape']) {
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Create a new draft' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Request title').fill('');
    await expect(dialog.getByRole('button', { name: 'Create draft', exact: true })).toBeDisabled();
    await dialog.getByLabel('Request title').fill('Unsubmitted local audit');
    await trapCycles(page, dialog);
    await noOverflow(page);
    if (dismissal === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: dismissal, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
  expect(writes).toEqual([]);
});

test('saved plans and supplier delivery disclosures expose their supporting details', async ({ page }, info) => {
  await signIn(page, info);
  const writes = await forbidWrites(page);
  await page.goto('/service-planning');
  await collapseGuide(page);
  const savedPlan = page.getByRole('combobox', { name: 'Saved plan', exact: true });
  await expect(savedPlan.locator('option')).toHaveCount(3);
  const planIds = await savedPlan.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean));
  for (const id of planIds) {
    await savedPlan.selectOption(id);
    await expect(savedPlan).toHaveValue(id);
    await expect(page.getByRole('textbox', { name: 'Plan name', exact: true })).toHaveValue(/DEMO/);
    const explanation = page.locator('summary').filter({ hasText: 'How quantities are calculated' });
    await explanation.click();
    await expect(explanation.locator('..')).toHaveAttribute('open', '');
    await explanation.click();
    await noOverflow(page);
  }
  await page.goto('/supplier-performance');
  await collapseGuide(page);
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
  await refresh.click();
  await expect(refresh).toBeEnabled();
  for (const title of ['Ingredient quantities & costs', 'Recent deliveries', 'How these numbers are calculated']) {
    const summary = page.locator('summary').filter({ hasText: title }).first();
    await summary.click();
    await expect(summary.locator('..')).toHaveAttribute('open', '');
    await noOverflow(page);
    await summary.click();
    await expect(summary.locator('..')).not.toHaveAttribute('open', '');
  }
  expect(writes).toEqual([]);
});
