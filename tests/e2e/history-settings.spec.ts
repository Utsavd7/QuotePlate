import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { expectNoSeriousAxeViolations } from './helpers/accessibility';

const password = 'Local-only settings password 42!';

function fixture(projectName: string) {
  const suffix = projectName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return {
    ownerEmail: `settings-owner-${suffix}@example.com`,
    memberEmail: `settings-member-${suffix}@example.com`,
    memberName: 'Ravi Settings Test',
    restaurantName: 'Monsoon Table Settings Kitchen',
  };
}

async function createOwner(page: Page, projectName: string) {
  const data = fixture(projectName);
  const response = await page.request.post('/api/auth/start', {
    data: {
      method: 'email',
      restaurantName: data.restaurantName,
      ownerName: 'Ananya Settings Test',
      email: data.ownerEmail,
      password,
      addressLine: '12 Hill Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pin: '400050',
      phone: '+91 98765 43210',
      timezone: 'Asia/Kolkata',
      gstin: '',
    },
  });
  expect(response.status()).toBe(201);
  return data;
}

async function signIn(page: Page, email: string, callback = '/settings') {
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(callback)}`);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page).toHaveURL(new RegExp(callback.replace('/', '\\/')));
}

async function openNavigationIfNeeded(page: Page) {
  if ((page.viewportSize()?.width ?? 1_440) < 1_024) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(
      page.getByRole('complementary').getByRole('button', { name: 'Close navigation' }),
    ).toBeVisible();
  }
}

async function signOut(page: Page) {
  await openNavigationIfNeeded(page);
  await page.locator('button:visible').filter({ hasText: /^Sign out$/ }).first().click();
  await expect(page).toHaveURL(/\/signin$/);
}

test.describe.serial('real restaurant settings and member access', () => {
  test('owner updates the restaurant, shares an invitation, and member access remains read-only', async ({
    page,
  }, testInfo: TestInfo) => {
    const data = await createOwner(page, testInfo.project.name);
    await signIn(page, data.ownerEmail);

    await expect(page.getByRole('heading', { name: 'Restaurant settings' })).toBeVisible();
    await expect(page.locator('main > header').getByText('Owner', { exact: true })).toBeVisible();
    await expect(page.getByText(/account email belongs to you/i)).toBeVisible();
    await expect(page.getByLabel('Contact email')).toHaveCount(0);

    await page.getByLabel('Restaurant or company name').fill('Monsoon Table Bandra');
    await page.getByLabel(/^GSTIN/).fill('27AAPFU0939F1ZV');
    await page.getByRole('button', { name: 'Save restaurant details' }).click();
    await expect(page.getByText('Restaurant details saved')).toBeVisible();

    const inviteButton = page.getByRole('button', { name: 'Invite someone' });
    await inviteButton.click();
    await page.getByLabel('Work email').fill(data.memberEmail);
    await page.getByRole('button', { name: 'Create invitation' }).click();

    const success = page.getByRole('status', { name: 'Invitation ready' });
    await expect(success).toBeVisible();
    await expect(success).toBeFocused();
    const visibleLink = page.getByLabel('Private join link');
    const joinLink = await visibleLink.inputValue();
    expect(joinLink).toMatch(/^http:\/\/127\.0\.0\.1:52560\/join#token=[A-Za-z0-9_-]{43}$/);

    await page.keyboard.press('Tab');
    await expect(visibleLink).toBeFocused();

    await page.context().grantPermissions(
      ['clipboard-read', 'clipboard-write'],
      { origin: 'http://127.0.0.1:52560' },
    );
    await page.getByRole('button', { name: 'Copy invite link' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(success).toHaveCount(0);
    await expect(inviteButton).toBeFocused();
    await expect(page.getByText(data.memberEmail)).toBeVisible();
    await expectNoSeriousAxeViolations(page);

    await page.goto(joinLink);
    await expect(page).toHaveURL(/\/join$/);
    await page.getByLabel('Full name').fill(data.memberName);
    await page.getByLabel('Invited email').fill(data.memberEmail);
    await page.getByLabel('Create password').fill(password);
    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto('/settings');
    await expect(page.getByText('View access only')).toBeVisible();
    await expect(page.locator('main > header').getByText('Team member', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Restaurant or company name')).toHaveValue('Monsoon Table Bandra');
    await expect(page.getByLabel('Restaurant or company name')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save restaurant details' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Invite someone' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);

    const forbiddenSettings = await page.request.patch('/api/settings', {
      data: {
        details: {
          name: 'Not allowed', addressLine: '1 Wrong Road', city: 'Mumbai',
          state: 'Maharashtra', pin: '400001', phone: '9876543210', gstin: null,
        },
      },
    });
    const forbiddenInvite = await page.request.post('/api/members/invitations', {
      data: { email: 'other-member@example.com', role: 'MEMBER' },
    });
    expect(forbiddenSettings.status()).toBe(403);
    expect(forbiddenInvite.status()).toBe(403);
    await expectNoSeriousAxeViolations(page);

    await signOut(page);
    await signIn(page, data.ownerEmail);
    const memberRow = page.locator('article').filter({ hasText: data.memberEmail });
    await memberRow.getByRole('button', { name: 'Deactivate' }).click();
    await page.getByRole('button', { name: 'Deactivate access' }).click();
    await expect(memberRow).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
