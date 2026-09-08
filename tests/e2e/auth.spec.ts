import { expect, test, type Page } from '@playwright/test';

const password = 'Local-only test password 42!';
const localAuthOrigin = 'http://127.0.0.1:52562';

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflow).toBeLessThanOrEqual(1);
}

function accountEmail(projectName: string) {
  return `owner-${projectName.replace(/[^a-z0-9]+/gi, '-')}@example.com`;
}

async function createEmailAccount(page: Page, email: string) {
  const response = await page.request.post('/api/auth/start', {
    data: {
      method: 'email',
      restaurantName: 'Tamarind Table Test Kitchen',
      ownerName: 'Asha Rao',
      email,
      password,
      addressLine: '12 Residency Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pin: '560001',
      phone: '+91 98765 43210',
      timezone: 'Asia/Kolkata',
      gstin: '',
    },
  });
  expect(response.status()).toBe(201);
}

async function fillEmailWorkspace(page: Page, email: string) {
  await page.getByLabel('Restaurant name').fill('Tamarind Table Test Kitchen');
  await page.getByLabel('Street address').fill('12 Residency Road');
  await page.getByLabel('City').fill('Bengaluru');
  await page.getByLabel('State').fill('Karnataka');
  await page.getByLabel('PIN code').fill('560001');
  await page.getByLabel('Restaurant phone').fill('+91 98765 43210');
  await page.getByLabel('Your name').fill('Asha Rao');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
}

async function openAccountNavigation(page: Page) {
  if ((page.viewportSize()?.width ?? 1_440) < 1_024) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(
      page
        .getByRole('complementary')
        .getByRole('button', { name: 'Close navigation' }),
    ).toBeVisible();
  }
}

function visibleSignOut(page: Page) {
  return page.locator('button:visible').filter({ hasText: /^Sign out$/ }).first();
}

async function signInWithEmail(page: Page, email: string) {
  await page.goto('/signin?callbackUrl=%2Fsettings%3Fsection%3Dmembers');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page).toHaveURL(/\/settings\?section=members$/);
}

test.describe('workspace creation layout', () => {
  test('pins the start header above phone width only', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Responsive layout contract');

    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto('/start');
    await page.evaluate(() => window.scrollTo(0, 700));
    const header = page.locator('.public-header');
    await expect.poll(() => header.evaluate((element) => (
      element.getBoundingClientRect().top
    ))).toBeGreaterThanOrEqual(-1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/start');
    await page.evaluate(() => window.scrollTo(0, 700));
    expect(await page.locator('.public-header').evaluate((element) => (
      element.getBoundingClientRect().bottom
    ))).toBeLessThan(0);
  });

  test('keeps the account form anchor below the sticky header', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Keyboard layout contract');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/start#account-form');

    const header = page.locator('.public-header');
    const sheet = page.locator('#account-form');
    await expect.poll(async () => {
      const [headerBox, sheetBox] = await Promise.all([
        header.boundingBox(),
        sheet.boundingBox(),
      ]);
      expect(headerBox).not.toBeNull();
      expect(sheetBox).not.toBeNull();
      return sheetBox!.y - (headerBox!.y + headerBox!.height);
    }).toBeGreaterThanOrEqual(0);
  });

  test('keeps the start form spacious and every control reachable on a laptop', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Responsive layout contract');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/start');

    const sheet = page.locator('#account-form');
    const terms = sheet.getByText('By creating a workspace', { exact: false });
    const emailButton = sheet.getByRole('button', { name: 'Create workspace with email' });
    const googleButton = sheet.getByRole('button', { name: 'Continue with Google' });
    await expect(terms).toBeVisible();
    await expect(emailButton).toBeVisible();
    await expect(googleButton).toBeVisible();

    const sheetBox = await sheet.boundingBox();
    const termsBox = await terms.boundingBox();
    expect(sheetBox).not.toBeNull();
    expect(termsBox).not.toBeNull();
    expect(termsBox!.y + termsBox!.height).toBeLessThanOrEqual(sheetBox!.y + sheetBox!.height);
    await terms.scrollIntoViewIfNeeded();
    await expect(terms).toBeInViewport();

    const fieldHeights = await sheet.locator('input').evaluateAll((inputs) => (
      inputs.map((input) => input.getBoundingClientRect().height)
    ));
    for (const height of fieldHeights) expect(height).toBeGreaterThanOrEqual(44);

    const rowTop = async (label: string) => {
      const box = await page.getByLabel(label).boundingBox();
      expect(box).not.toBeNull();
      return box!.y;
    };
    expect(await rowTop('Restaurant name')).toBeCloseTo(await rowTop('Restaurant phone'), 0);
    expect(await rowTop('City')).toBeCloseTo(await rowTop('State'), 0);
    expect(await rowTop('PIN code')).toBeCloseTo(await rowTop('GSTIN optional'), 0);
    expect(await rowTop('Your name')).toBeCloseTo(await rowTop('Work email'), 0);

    const emailBox = await emailButton.boundingBox();
    const googleBox = await googleButton.boundingBox();
    expect(emailBox).not.toBeNull();
    expect(googleBox).not.toBeNull();
    expect(googleBox!.y).toBeGreaterThan(emailBox!.y + emailBox!.height);
    await expectNoPageOverflow(page);
  });

  test('keeps short laptops and phones naturally stacked', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Responsive layout contract');

    await page.setViewportSize({ width: 1024, height: 650 });
    await page.goto('/start');
    const shortEmail = await page.getByRole('button', { name: 'Create workspace with email' }).boundingBox();
    const shortGoogle = await page.getByRole('button', { name: 'Continue with Google' }).boundingBox();
    expect(shortEmail).not.toBeNull();
    expect(shortGoogle).not.toBeNull();
    expect(shortGoogle!.y).toBeGreaterThan(shortEmail!.y + 44);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/start');
    const restaurant = await page.getByLabel('Restaurant name').boundingBox();
    const phone = await page.getByLabel('Restaurant phone').boundingBox();
    const phoneEmail = await page.getByRole('button', { name: 'Create workspace with email' }).boundingBox();
    const phoneGoogle = await page.getByRole('button', { name: 'Continue with Google' }).boundingBox();
    expect(restaurant).not.toBeNull();
    expect(phone).not.toBeNull();
    expect(phoneEmail).not.toBeNull();
    expect(phoneGoogle).not.toBeNull();
    expect(phone!.y).toBeGreaterThan(restaurant!.y + 44);
    expect(phoneGoogle!.y).toBeGreaterThan(phoneEmail!.y + 44);
    await expectNoPageOverflow(page);
  });
});

test.describe.serial('local credentials account journey', () => {
  test('creates a workspace, retains the callback, reports logout failure, and signs out', async ({
    page,
  }, testInfo) => {
    const email = accountEmail(testInfo.project.name);
    await page.goto('/start?callbackUrl=%2Fsettings%3Fsection%3Dmembers');

    await fillEmailWorkspace(page, email);
    await page.getByRole('button', { name: 'Create workspace with email' }).click();

    await expect(page).toHaveURL(/\/settings\?section=members$/);
    await expect(page.getByRole('heading', { name: 'Restaurant settings' })).toBeVisible();

    const signOutError =
      'Sign out could not be completed. Your session is still active. Try again.';
    const expectSignOutFailure = async () => {
      await visibleSignOut(page).click();
      await expect(
        page.getByRole('alert').filter({ hasText: signOutError }),
      ).toHaveText(signOutError);
      await expect(page).toHaveURL(/\/settings\?section=members$/);
    };

    await page.route('**/api/auth/signout', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'unavailable' }),
        });
      } else {
        await route.continue();
      }
    });
    await openAccountNavigation(page);
    await expectSignOutFailure();
    await page.unroute('**/api/auth/signout');

    await page.route('**/api/auth/signout', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ url: '/signin' }),
        });
      } else {
        await route.continue();
      }
    });
    await expectSignOutFailure();
    await page.unroute('**/api/auth/signout');

    await page.route('**/api/auth/signout', async (route) => {
      if (route.request().method() === 'POST') {
        await route.abort('connectionfailed');
      } else {
        await route.continue();
      }
    });
    await expectSignOutFailure();

    await page.unroute('**/api/auth/signout');
    await visibleSignOut(page).click();
    await expect(page).toHaveURL(/\/signin$/);

    await page.goto('/settings?section=members#pending-invitations');
    await expect(page).toHaveURL((url) =>
      url.pathname === '/signin' &&
      url.searchParams.get('callbackUrl') ===
        '/settings?section=members#pending-invitations',
    );
  });

  test('shows safe wrong-credential and exact Google outage errors', async ({
    page,
  }, testInfo) => {
    await page.goto('/signin');
    await page.getByLabel('Work email').fill(accountEmail(testInfo.project.name));
    await page.getByLabel('Password').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in with email' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: /incorrect|inactive/i }),
    ).toContainText(/incorrect|inactive/i);

    const googleUnavailable =
      'Google sign-in is temporarily unavailable. Try again shortly.';
    await page.goto(`/signin?error=${encodeURIComponent(googleUnavailable)}`);
    await expect(
      page.getByRole('alert').filter({ hasText: googleUnavailable }),
    ).toHaveText(googleUnavailable);
  });

  test('signs a returning email user in without recreating their workspace', async ({
    page,
  }, testInfo) => {
    const email = `returning-${accountEmail(testInfo.project.name)}`;
    await createEmailAccount(page, email);
    await signInWithEmail(page, email);
    await expect(page.getByRole('heading', { name: 'Restaurant settings' })).toBeVisible();
    await openAccountNavigation(page);
    await visibleSignOut(page).click();
    await expect(page).toHaveURL(/\/signin$/);
  });

  test('does not reveal duplicate email registration through the real signup form', async ({
    page,
  }, testInfo) => {
    const email = `duplicate-${accountEmail(testInfo.project.name)}`;
    await createEmailAccount(page, email);

    await page.goto('/start');
    await fillEmailWorkspace(page, email);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/auth/start',
    );
    await page
      .getByRole('button', { name: 'Create workspace with email' })
      .click();
    const response = await responsePromise;

    expect(response.status()).toBe(201);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole('heading', { name: 'Today', exact: true }),
    ).toBeVisible();
  });

  test('does not authenticate an inactive email account', async ({
    page,
  }, testInfo) => {
    const email = `inactive-${accountEmail(testInfo.project.name)}`;
    await createEmailAccount(page, email);
    const disabled = await page.request.post(
      `${localAuthOrigin}/__test/database/user-active`,
      { data: { email, active: false } },
    );
    expect(disabled.status()).toBe(204);

    try {
      await page.goto('/signin');
      await page.getByLabel('Work email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Sign in with email' }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: /incorrect|inactive/i }),
      ).toHaveText('Email or password is incorrect, or this workspace is inactive.');
      await expect(page).toHaveURL(/\/signin$/);
    } finally {
      const restored = await page.request.post(
        `${localAuthOrigin}/__test/database/user-active`,
        { data: { email, active: true } },
      );
      expect(restored.status()).toBe(204);
    }
  });

  test('keeps a valid session on database HTTP, network, and parse failures and recovers on retry', async ({
    page,
  }, testInfo) => {
    const email = `layout-${accountEmail(testInfo.project.name)}`;
    await createEmailAccount(page, email);
    await signInWithEmail(page, email);

    const failures = [
      async () => {
        await page.route('**/api/account', (route) =>
          route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
        );
      },
      async () => {
        await page.route('**/api/account', (route) =>
          route.abort('connectionfailed'),
        );
      },
      async () => {
        await page.route('**/api/account', (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: 'not-json' }),
        );
      },
    ];

    for (const simulateFailure of failures) {
      await simulateFailure();
      await page.reload();
      await expect(
        page.getByRole('alert').filter({ hasText: /workspace is temporarily unavailable/i }),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/settings\?section=members$/);

      await page.unroute('**/api/account');
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(page.getByRole('heading', { name: 'Restaurant settings' })).toBeVisible();
    }
  });
});
