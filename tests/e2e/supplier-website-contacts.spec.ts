import { expect, test } from '@playwright/test';
import { resetSignupClientRateLimit } from './helpers/signup';
import { expectNoSeriousAxeViolations } from './helpers/accessibility';

// Only website discovery is mocked. The parent runs these against the local E2E
// app: authentication, existing supplier reads, review and save remain real.
for (const emptyField of ['phone', 'email'] as const) {
  test(`website contact review fills empty ${emptyField} only after review and preserves saved fields`, async ({ page }, info) => {
    await resetSignupClientRateLimit(page.request);
    const email = `website-${emptyField}-${info.project.name}-${Date.now()}@example.com`;
    const password = 'Local-only website contact password 42!';
    const created = await page.request.post('/api/auth/start', { data: {
      method: 'email', restaurantName: 'Website Contact Test Kitchen', ownerName: 'Asha Rao', email, password,
      addressLine: '18 Market Road', city: 'Pune', state: 'Maharashtra', pin: '411001',
      phone: '+91 9876543210', timezone: 'Asia/Kolkata',
    } });
    expect(created.status(), await created.text()).toBe(201);
    await page.goto('/signin');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in with email' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const skip = page.getByRole('button', { name: 'Skip for now' });
    if (await skip.isVisible()) await skip.click();

    const original = {
      businessName: 'Existing Website Supplier', contactName: 'Existing Contact',
      phone: emptyField === 'phone' ? null : '+919123456789',
      email: emptyField === 'email' ? null : 'saved@supplier.com',
      whatsappNumber: '+919111111111', notes: 'Keep delivery and payment notes',
      addressLine: '22 Market Road', city: 'Pune', state: 'Maharashtra', pin: '411001', isActive: true,
    };
    const supplierResponse = await page.request.post('/api/suppliers', { data: original });
    expect(supplierResponse.status(), await supplierResponse.text()).toBe(201);
    const { supplier } = await supplierResponse.json();
    const supplierPath = `/api/suppliers/${supplier.id}`;
    const getSaved = async () => {
      const response = await page.request.get(supplierPath);
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()).supplier;
    };
    const before = await getSaved();
    const published = { phone: '98765 43210', email: 'published@supplier.com' };
    const checkedAt = '2026-09-11T00:00:00.000Z';
    let discoveries = 0;
    const writes: unknown[] = [];
    const external: string[] = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname === supplierPath && request.method() === 'PUT') writes.push(request.postDataJSON());
    });
    await page.route(/^https:\/\/(?:supplier\.com|wa\.me)\//, async route => {
      external.push(route.request().url());
      await route.abort();
    });
    await page.route('**/api/suppliers/website-contacts', async route => {
      discoveries += 1;
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({ url: 'https://supplier.com' });
      await route.fulfill({ json: {
        status: 'found', checkedAt,
        contacts: (['phone', 'email'] as const).map(kind => ({ kind, value: published[kind], sourceUrl: 'https://supplier.com/contact', checkedAt })),
      } });
    });
    await page.goto('/suppliers');
    await page.getByRole('button', { name: `Edit ${original.businessName}`, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Phone', { exact: true })).toBeEnabled();
    await dialog.locator('summary').filter({ hasText: 'Find contacts on the supplier’s website' }).click();
    await dialog.getByLabel('Supplier website', { exact: true }).fill('https://supplier.com');
    expect(discoveries).toBe(0);
    expect(writes).toEqual([]);
    await dialog.getByRole('button', { name: 'Check website', exact: true }).click();
    const review = dialog.getByRole('region', { name: 'Review published website contacts' });
    await expect(review).toBeVisible();
    expect(discoveries).toBe(1);
    await expect(review.getByRole('listitem')).toHaveCount(2);
    await expect(review.getByRole('link', { name: 'Published source' }).first()).toHaveAttribute('href', 'https://supplier.com/contact');
    await expect(review.locator('time').first()).toHaveAttribute('datetime', checkedAt);
    await expect(dialog.getByLabel('Phone', { exact: true })).toHaveValue(original.phone ?? '');
    await expect(dialog.getByLabel('Email', { exact: true })).toHaveValue(original.email ?? '');
    const preservedField = emptyField === 'phone' ? 'email' : 'phone';
    await expect(review.getByRole('button', { name: `Use this ${preservedField}`, exact: true })).toBeDisabled();
    expect(writes).toEqual([]);
    expect(await getSaved()).toEqual(before);

    await review.getByRole('button', { name: `Use this ${emptyField}`, exact: true }).click();
    await expect(dialog.getByLabel(emptyField === 'phone' ? 'Phone' : 'Email', { exact: true })).toHaveValue(published[emptyField]);
    await expect(dialog.getByLabel(preservedField === 'phone' ? 'Phone' : 'Email', { exact: true })).toHaveValue(original[preservedField]!);
    await expect(dialog.getByLabel('WhatsApp number', { exact: true })).toHaveValue(original.whatsappNumber);
    await expect(dialog.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue(original.notes);
    expect(writes).toEqual([]);
    expect(await getSaved()).toEqual(before);
    await expectNoSeriousAxeViolations(page, '[role="dialog"]');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`website-reviewed-${emptyField}.png`), fullPage: true });

    const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === supplierPath && response.request().method() === 'PUT');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    const saved = await savedResponse;
    expect(saved.status(), await saved.text()).toBe(200);
    await expect(dialog).not.toBeVisible();
    expect(writes).toHaveLength(1);
    const after = await getSaved();
    expect(after).toMatchObject({
      ...original,
      [emptyField]: emptyField === 'phone' ? '+919876543210' : published.email,
      capabilities: before.capabilities,
    });
    expect(external).toEqual([]);
    expect(discoveries).toBe(1);
  });
}
