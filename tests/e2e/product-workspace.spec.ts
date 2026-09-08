import { readFile } from 'node:fs/promises';

import {
  expect,
  test,
  type BrowserContextOptions,
  type Download,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { expectNoSeriousAxeViolations } from './helpers/accessibility';
import { resetSignupClientRateLimit } from './helpers/signup';

const account = {
  name: 'Monsoon Table Pune',
  addressLine: '18 Koregaon Park Road',
  city: 'Pune',
  state: 'Maharashtra',
  pin: '411001',
};

async function mockAccount(page: Page) {
  await page.route('**/api/account', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ account, workspaceId: 'tenant-a' }),
    });
  });
}

const localAuthOrigin = 'http://127.0.0.1:52562';
const exportPassword = 'Local-only export test password 42!';

async function createAndSignInExportOwner(page: Page, email: string) {
  await resetSignupClientRateLimit(page.request);
  const created = await page.request.post('/api/auth/start', {
    data: {
      method: 'email',
      restaurantName: 'Monsoon Table Export Kitchen',
      ownerName: 'Asha Rao',
      email,
      password: exportPassword,
      addressLine: '18 Koregaon Park Road',
      city: 'Pune',
      state: 'Maharashtra',
      pin: '411001',
      phone: '+91 98765 43210',
      timezone: 'Asia/Kolkata',
      gstin: '27ABCDE1234F1Z5',
    },
  });
  expect(created.status()).toBe(201);
  await page.goto('/signin');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(exportPassword);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function downloadedBytes(page: Page, buttonName: string | RegExp) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: buttonName }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error(`No file path was returned for ${download.suggestedFilename()}.`);
  const bytes = await readFile(path);
  await expect(page.getByRole('button', { name: buttonName })).toBeEnabled();
  return { download, bytes } satisfies { download: Download; bytes: Buffer };
}

async function expectMatchingDeviceContext(ownerPage: Page, supplierPage: Page) {
  expect(supplierPage.viewportSize()).toEqual(ownerPage.viewportSize());
  await expect.poll(async () => supplierPage.evaluate(() => ({
    mobileUserAgent: /Mobile/i.test(navigator.userAgent),
    touchPoints: navigator.maxTouchPoints,
  }))).toEqual(await ownerPage.evaluate(() => ({
    mobileUserAgent: /Mobile/i.test(navigator.userAgent),
    touchPoints: navigator.maxTouchPoints,
  })));
}

function projectDeviceContext(testInfo: TestInfo): BrowserContextOptions {
  const {
    deviceScaleFactor,
    hasTouch,
    isMobile,
    locale,
    userAgent,
    viewport,
  } = testInfo.project.use;
  return {
    deviceScaleFactor,
    hasTouch,
    isMobile,
    locale,
    userAgent,
    viewport,
  };
}

test('sends a menu photo from the public mobile capture page without sign-in', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const token = 'network-mocked-phone-token';
  const encodedKey = Buffer.alloc(32, 7).toString('base64url');
  const uploadRequests: Array<{ method: string; authorization: string | undefined; url: string }> = [];
  await page.route('**/api/menu-photo-transfer/upload', async (route) => {
    const request = route.request();
    uploadRequests.push({
      method: request.method(),
      authorization: request.headers().authorization,
      url: request.url(),
    });
    await route.fulfill({
      status: request.method() === 'PUT' ? 201 : 200,
      contentType: 'application/json',
      body: JSON.stringify(request.method() === 'PUT'
        ? { uploaded: true, index: 0 }
        : { status: 'complete', expiresAt: Date.now() + 60_000, files: [] }),
    });
  });

  await page.goto(`/menu-capture#token=${token}&key=${encodedKey}`);
  await expect(page).toHaveURL(/\/menu-capture$/);
  await expect(page.getByRole('heading', { name: 'Take or choose up to 10 photos' })).toBeVisible();
  await expect(page.getByText(/sign in/i)).toHaveCount(0);

  await page.getByLabel('Take photos or choose images').setInputFiles({
    name: 'menu.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.getByAltText('Menu photo 1')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Photos sent' })).toBeVisible();
  await expect(page.getByText('You can close this page.')).toBeVisible();

  expect(uploadRequests).toEqual([
    expect.objectContaining({
      method: 'PUT',
      authorization: `Bearer ${token}`,
    }),
    expect.objectContaining({
      method: 'POST',
      authorization: `Bearer ${token}`,
    }),
  ]);
  expect(uploadRequests.every(({ url }) => !url.includes(token))).toBe(true);

  await page.evaluate(({ key }) => {
    window.location.hash = `token=fresh-network-mocked-token&key=${key}`;
  }, { key: encodedKey });
  await expect(page).toHaveURL(/\/menu-capture$/);
  await expect(page.getByRole('heading', { name: 'Take or choose up to 10 photos' })).toBeVisible();
  await expect(page.getByAltText('Menu photo 1')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled();

  await page.evaluate(() => {
    window.location.hash = 'token=invalid&key=invalid';
  });
  await expect(page).toHaveURL(/\/menu-capture$/);
  await expect(page.getByRole('heading', { name: 'This code is no longer ready' })).toBeVisible();
});

test('keeps a rescanned phone send isolated from stale aborted cleanup', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const staleToken = 'stale-network-mocked-token';
  const freshToken = 'fresh-network-mocked-token';
  const encodedKey = Buffer.alloc(32, 7).toString('base64url');
  let markFreshUploadStarted!: () => void;
  let finishFreshUpload!: () => void;
  const freshUploadStarted = new Promise<void>((resolve) => { markFreshUploadStarted = resolve; });
  const freshUploadMayFinish = new Promise<void>((resolve) => { finishFreshUpload = resolve; });

  await page.route('**/api/menu-photo-transfer/upload', async (route) => {
    const request = route.request();
    if (
      request.method() === 'PUT'
      && request.headers().authorization === `Bearer ${freshToken}`
    ) {
      markFreshUploadStarted();
      await freshUploadMayFinish;
    }
    await route.fulfill({
      status: request.method() === 'PUT' ? 201 : 200,
      contentType: 'application/json',
      body: JSON.stringify(request.method() === 'PUT'
        ? { uploaded: true, index: 0 }
        : { status: 'complete', expiresAt: Date.now() + 60_000, files: [] }),
    });
  });

  await page.goto(`/menu-capture#token=${staleToken}&key=${encodedKey}`);
  await expect(page.getByRole('heading', { name: 'Take or choose up to 10 photos' })).toBeVisible();
  await page.evaluate((token) => {
    const originalFetch = window.fetch.bind(window);
    const raceWindow = window as typeof window & {
      stalePhoneSendStarted?: boolean;
      releaseStalePhoneSend?: () => void;
    };
    window.fetch = (input, init) => {
      if (new Headers(init?.headers).get('Authorization') !== `Bearer ${token}`) {
        return originalFetch(input, init);
      }
      raceWindow.stalePhoneSendStarted = true;
      return new Promise<Response>((_resolve, reject) => {
        raceWindow.releaseStalePhoneSend = () => {
          reject(new DOMException('The stale send was aborted.', 'AbortError'));
        };
      });
    };
  }, staleToken);

  const photo = {
    name: 'menu.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  };
  await page.getByLabel('Take photos or choose images').setInputFiles(photo);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { stalePhoneSendStarted?: boolean }
  ).stalePhoneSendStarted)).toBe(true);

  await page.evaluate(({ key, token }) => {
    window.location.hash = `token=${token}&key=${key}`;
  }, { key: encodedKey, token: freshToken });
  await expect(page).toHaveURL(/\/menu-capture$/);
  await expect(page.getByRole('heading', { name: 'Take or choose up to 10 photos' })).toBeVisible();
  await page.getByLabel('Take photos or choose images').setInputFiles(photo);
  await page.getByRole('button', { name: 'Done' }).click();
  await freshUploadStarted;

  await page.evaluate(() => {
    (window as typeof window & { releaseStalePhoneSend?: () => void })
      .releaseStalePhoneSend?.();
  });
  await page.waitForTimeout(100);
  await expect(page.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  await expect(page.getByLabel('Sending photo progress')).toBeVisible();

  finishFreshUpload();
  await expect(page.getByRole('heading', { name: 'Photos sent' })).toBeVisible();
});

test('uses the approved QuotePlate product shell and exposes every core workspace', async ({
  page,
}) => {
  await mockAccount(page);
  await page.goto('/dashboard');

  if ((page.viewportSize()?.width ?? 1_440) < 1_024) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
  }
  const workspaceNavigation = page.getByRole('navigation', {
    name: 'Workspace navigation',
  });
  await expect(workspaceNavigation).toBeVisible();
  await expect(page.getByRole('link', { name: 'QuotePlate home' }).first()).toBeVisible();
  for (const label of ['Today', 'Purchases', 'Suppliers', 'Menu', 'Reports']) {
    await expect(workspaceNavigation.getByRole('link', { name: label })).toBeVisible();
  }
  await expect(page.getByRole('complementary').getByRole('link', { name: 'New purchase', exact: true })).toHaveAttribute(
    'href',
    '/procurement/new',
  );
  await expect(page.getByText('AutoRFP')).toHaveCount(0);
  await expect(page.getByText(/launch workflow in progress/i)).toHaveCount(0);
});

test('loads later menu, supplier, and procurement pages without inventing totals', async ({ page }) => {
  await mockAccount(page);
  await page.route('**/api/menus?*', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    const menus = cursor
      ? [{ id: 'menu-2', name: 'Breakfast menu', status: 'APPROVED', version: 3, approvedAt: '2026-08-27T08:00:00.000Z', updatedAt: '2026-08-28T08:00:00.000Z', _count: { recipes: 8, requests: 1 } }]
      : [{ id: 'menu-1', name: 'Dinner menu', status: 'DRAFT', version: 2, approvedAt: null, updatedAt: '2026-08-28T08:00:00.000Z', _count: { recipes: 12, requests: 0 } }];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ menus, nextCursor: cursor ? null : 'menu-page-2' }),
    });
  });
  await page.route('**/api/suppliers?*', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    const supplier = (id: string, businessName: string) => ({
      id,
      businessName,
      contactName: 'Meera Shah',
      phone: '+919876543210',
      whatsappNumber: '+919876543210',
      email: 'orders@example.com',
      addressLine: 'APMC Market',
      city: 'Pune',
      state: 'Maharashtra',
      pin: '411001',
      gstin: null,
      notes: null,
      isActive: true,
      createdAt: '2026-08-28T08:00:00.000Z',
      updatedAt: '2026-08-28T08:00:00.000Z',
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        suppliers: [cursor ? supplier('supplier-2', 'Coastal Dairy') : supplier('supplier-1', 'GreenLeaf Fresh Foods')],
        nextCursor: cursor ? null : 'supplier-page-2',
      }),
    });
  });
  await page.route('**/api/requests?*', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    const request = (id: string, title: string) => ({
      id,
      title,
      status: 'DRAFT',
      version: 1,
      deliveryDate: '2099-09-05T00:00:00.000Z',
      quoteDeadline: '2099-09-03T10:00:00.000Z',
      openedAt: null,
      awardedAt: null,
      createdAt: '2026-08-28T08:00:00.000Z',
      updatedAt: '2026-08-28T08:00:00.000Z',
      _count: { items: 14, supplierRequests: 4 },
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        requests: [cursor ? request('request-2', 'Dairy · Week 36') : request('request-1', 'Fresh produce · Week 36')],
        nextCursor: cursor ? null : 'request-page-2',
      }),
    });
  });

  await page.goto('/menus');
  await page.getByRole('button', { name: 'Load more menus' }).click();
  await expect(page.getByText('Breakfast menu')).toBeVisible();

  await page.goto('/suppliers');
  await page.getByRole('button', { name: 'Load more suppliers' }).click();
  await expect(page.getByText('Coastal Dairy')).toBeVisible();

  await page.goto('/procurement');
  await page.getByRole('button', { name: 'Load more requests' }).click();
  await expect(page.getByText('Dairy · Week 36')).toBeVisible();
  await expect(page.getByText(/total requests/i)).toHaveCount(0);
});

test('runs the real launch workflow from reviewed menu to recorded award', async ({
  browser,
  page,
}, testInfo) => {
  const project = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-');
  const email = `launch-${project}@example.com`;
  await createAndSignInExportOwner(page, email);

  await page.goto('/menus');
  const skipSetup = page.getByRole('button', { name: 'Skip for now' });
  if (await skipSetup.isVisible()) await skipSetup.click();
  await page.getByRole('button', { name: 'Add menu' }).first().click();
  await page.getByRole('dialog', { name: 'How would you like to add it?' }).getByRole('button', { name: /Type or paste/ }).click();
  const menuDialog = page.getByRole('dialog', { name: 'Type or paste dish names' });
  await menuDialog.getByLabel('One dish per line').fill('Tomato curry');
  await menuDialog.getByRole('button', { name: 'Save and review' }).click();
  await expect(page).toHaveURL(/\/menus\/[^/]+$/);

  await page.getByLabel('Menu name').fill('Launch dinner menu');
  await page.getByRole('button', { name: 'Add ingredient' }).click();
  await page.getByLabel('Tomato curry ingredient 1').fill('Tomato');
  await page.getByLabel('Tomato quantity').fill('100');
  await page.getByLabel('Tomato unit').selectOption('KILOGRAM');
  await page.getByLabel('Tomato category').selectOption('VEGETABLES');
  await page.locator('summary').filter({hasText: 'Food photo or product link, optional'}).click();
  await page.getByLabel('Tomato food reference link').fill('https://example.com/tomato');
  await page.getByLabel('Tomato food reference link').fill('');
  await expect(page.getByLabel('Tomato food reference link')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Approve menu' }).first().click();
  await expect(page.getByText(/Approved · v\d+/).first()).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.goto('/suppliers');
  await page.getByRole('button', { name: 'Add supplier' }).first().click();
  const supplierDialog = page.getByRole('dialog', { name: 'Add supplier' });
  await supplierDialog.getByLabel(/Business name/).fill('GreenLeaf Launch Foods');
  await supplierDialog.getByLabel('Contact person').fill('Meera Shah');
  await supplierDialog.getByLabel('Phone').fill('+91 98765 43210');
  await supplierDialog.getByLabel('Email').fill('orders@greenleaf.example');
  await supplierDialog.getByLabel('City').fill('Pune');
  await supplierDialog.getByLabel('State').fill('Maharashtra');
  await supplierDialog.getByRole('button', { name: 'Add supplier' }).click();
  await expect(page.getByText('Supplier added.')).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.goto('/procurement/new');
  await page.getByLabel(/Request title/).fill('Fresh produce · Launch week');
  await page.getByLabel(/Approved menu/).selectOption({ label: 'Launch dinner menu' });
  await expect(page.getByText('All ingredients')).toBeVisible();
  const supplierChoice = page.locator('label').filter({ hasText: 'GreenLeaf Launch Foods' });
  const supplierCheckbox = supplierChoice.getByRole('checkbox');
  await supplierCheckbox.focus();
  await supplierCheckbox.press('Space');
  await expect(supplierCheckbox).toBeChecked();
  await page.getByLabel(/Delivery date/).fill('2099-09-10');
  await page.getByLabel(/Quote deadline/).fill('2099-09-09T10:00');
  await page.getByLabel('Delivery instructions').fill('Use the service entrance before 8:00 AM.');
  await page.locator('summary').filter({hasText:'Payment and order terms (optional)'}).click();
  await page.getByLabel('Terms or notes').fill('Temporary terms');
  await page.getByLabel('Terms or notes').fill('');
  await expect(page.getByLabel('Terms or notes')).toBeVisible();
  await page.getByLabel('Terms or notes').fill('Payment within 15 days of accepted delivery.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/procurement\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Fresh produce · Launch week' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit draft' }).click();
  const tomatoPreference = page.getByRole('region', { name: 'Tomato supplier preference' });
  await tomatoPreference.getByRole('button', { name: 'Choose differently' }).click();
  await tomatoPreference.getByRole('checkbox', { name: /Open to verified new suppliers/ }).check();
  await tomatoPreference.getByRole('checkbox', { name: /GreenLeaf Launch Foods/ }).check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Edit draft' })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Create supplier links' }).click();
  await expect(page.getByText('Waiting for supplier quotes')).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  const supplierLink = await page.locator('code').filter({ hasText: '/quote#token=' }).textContent();
  expect(supplierLink).toMatch(/\/quote#token=[A-Za-z0-9_-]{43}$/);

  const supplierContext = await browser.newContext(projectDeviceContext(testInfo));
  try {
    const supplierPage = await supplierContext.newPage();
    await expectMatchingDeviceContext(page, supplierPage);
    await supplierPage.goto(supplierLink!);
    await expect(supplierPage.getByRole('heading', { name: 'Fresh produce · Launch week' })).toBeVisible();
    await expectNoSeriousAxeViolations(supplierPage);
    await supplierPage.locator('input[name^="rate:"]').fill('79.68');
    await supplierPage.locator('input[name^="gst:"]').fill('5');
    await supplierPage.locator('input[name="freightInr"]').fill('500');
    await supplierPage.locator('textarea[name="commercialTerms"]').fill('Payment in 15 days.');
    await supplierPage.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
    await supplierPage.getByRole('button', { name: /^Send (updated )?quote$/, exact: true }).click();
    await expect(supplierPage.getByText('Quote sent. Version 1 is saved with the restaurant.')).toBeVisible();
  } finally {
    await supplierContext.close();
  }

  await page.getByRole('button', { name: 'Refresh quotes' }).click();
  await expect(page.getByText('GreenLeaf Launch Foods').first()).toBeVisible();
  await page.getByRole('radio', { name: /GreenLeaf Launch Foods/ }).check();
  await page.getByLabel(/Reason for this decision/).fill(
    'Complete order at the best checked landed total with delivery on the requested date.',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Confirm supplier choice' }).click();
  await expect(page.getByText('Award recorded. The request and winning prices are now locked.')).toBeVisible();
  await page.locator('summary').filter({hasText:'Download records & purchase orders'}).click();
  await expect(page.getByText('Award decision CSV')).toBeVisible();
});

test('runs the real owner-to-supplier journey and downloads every private record responsively', async ({
  browser,
  page,
}, testInfo) => {
  const project = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-');
  const email = `exports-${project}@example.com`;
  await createAndSignInExportOwner(page, email);
  const seeded = await page.request.post(
    `${localAuthOrigin}/__test/database/procurement-export-journey`,
    { data: { email } },
  );
  expect(seeded.status()).toBe(201);
  const fixture = await seeded.json() as {
    requestId: string;
    itemId: string;
    itemName: string;
    supplierName: string;
  };

  await page.goto(`/procurement/${fixture.requestId}`);
  await expect(page.getByRole('heading', { name: 'Fresh produce · Export journey' })).toBeVisible();
  await page.getByRole('button', { name: 'New link' }).click();
  const supplierLink = await page.locator('code').textContent();
  expect(supplierLink).toMatch(/\/quote#token=[A-Za-z0-9_-]{43}$/);

  const qrButtonName = `Download QR for ${fixture.supplierName}`;
  const qrResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && /\/api\/requests\/[^/]+\/qr$/.test(response.url()),
  );
  const qrDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: qrButtonName }).click();
  const qrResponse = await qrResponsePromise;
  const qrFailure = qrResponse.ok() ? '' : await qrResponse.text();
  const qrRequestHeaders = await qrResponse.request().allHeaders();
  expect(
    qrResponse.status(),
    JSON.stringify({
      requestUrl: qrResponse.url(),
      requestOrigin: qrRequestHeaders.origin,
      requestHost: qrRequestHeaders.host,
      fetchSite: qrRequestHeaders['sec-fetch-site'],
      responseBody: qrFailure,
    }, null, 2),
  ).toBe(200);
  const qrDownload = await qrDownloadPromise;
  const qrPath = await qrDownload.path();
  if (!qrPath) throw new Error(`No file path was returned for ${qrDownload.suggestedFilename()}.`);
  const qr = { download: qrDownload, bytes: await readFile(qrPath) };
  await expect(page.getByRole('button', { name: qrButtonName })).toBeEnabled();
  expect(qr.download.suggestedFilename()).toMatch(/quote-link.*\.png$/);
  expect(qr.bytes.subarray(0, 8)).toEqual(Buffer.from('\u0089PNG\r\n\u001a\n', 'latin1'));

  const supplierContext = await browser.newContext(projectDeviceContext(testInfo));
  try {
    const supplierPage = await supplierContext.newPage();
    await expectMatchingDeviceContext(page, supplierPage);
    await supplierPage.goto(supplierLink!);
    await expect(supplierPage.getByRole('heading', { name: 'Fresh produce · Export journey' })).toBeVisible();
    await supplierPage.locator(`input[name="rate:${fixture.itemId}"]`).fill('79.68');
    await supplierPage.locator(`input[name="gst:${fixture.itemId}"]`).fill('5');
    await supplierPage.locator('input[name="freightInr"]').fill('500');
    await supplierPage.locator('textarea[name="commercialTerms"]').fill('Payment in 15 days.');
    await supplierPage.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
    await supplierPage.getByRole('button', { name: /^Send (updated )?quote$/, exact: true }).click();
    await expect(supplierPage.getByText('Quote sent. Version 1 is saved with the restaurant.')).toBeVisible();
  } finally {
    await supplierContext.close();
  }

  await page.getByRole('button', { name: 'Refresh quotes' }).click();
  await expect(page.getByText(fixture.supplierName).first()).toBeVisible();

  await page.locator('summary').filter({hasText:'Download records & purchase orders'}).click();
  const requestCsv = await downloadedBytes(page, /Request CSV/);
  expect(requestCsv.download.suggestedFilename()).toMatch(/-request\.csv$/);
  expect(requestCsv.bytes.toString('utf8')).toContain(fixture.itemName);
  const quoteCsv = await downloadedBytes(page, /Quote comparison CSV/);
  expect(quoteCsv.download.suggestedFilename()).toMatch(/-quotes\.csv$/);
  expect(quoteCsv.bytes.toString('utf8')).toContain(fixture.supplierName);
  await page.locator('summary').filter({hasText:'Download records & purchase orders'}).click();

  await page.getByRole('radio', { name: new RegExp(fixture.supplierName) }).check();
  await page.getByLabel(/Reason for this decision/).fill(
    'Complete order, on-time delivery, and the best verified landed total.',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Confirm supplier choice' }).click();
  await page.locator('summary').filter({hasText:'Download records & purchase orders'}).click();
  await expect(page.getByText('Award decision CSV')).toBeVisible();

  const awardCsv = await downloadedBytes(page, /Award decision CSV/);
  expect(awardCsv.bytes.toString('utf8')).toContain(fixture.supplierName);
  const accountingCsv = await downloadedBytes(page, /Accounting CSV/);
  expect(accountingCsv.bytes.toString('utf8')).toContain('GST INR');
  const purchaseOrder = await downloadedBytes(
    page,
    new RegExp(`Purchase order · ${fixture.supplierName}`),
  );
  expect(purchaseOrder.download.suggestedFilename()).toMatch(/-po-.*\.pdf$/);
  expect(purchaseOrder.bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(purchaseOrder.bytes.byteLength).toBeGreaterThan(1_000);

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  const viewportWidth = page.viewportSize()?.width ?? 1_440;
  for (const button of await page.locator('[aria-labelledby="request-downloads-heading"] button').all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 1);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
