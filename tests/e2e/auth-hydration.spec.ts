import { expect, test } from '@playwright/test';

test('account forms cannot submit credentials before JavaScript is ready', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    for (const path of ['/signin', '/start']) {
      await page.goto(path);
      const form = page.locator('form').filter({ has: page.getByLabel('Work email') });
      await expect(form).toHaveAttribute('method', 'post');
      await expect(form.getByLabel('Work email')).toBeDisabled();
      await expect(form.getByLabel('Password', { exact: true })).toBeDisabled();
      await expect(form.locator('button[type="submit"]')).toBeDisabled();
      await expect(page.getByText('Preparing secure sign-in… JavaScript is required.')).toBeVisible();
      expect(new URL(page.url()).search).toBe('');
    }
  } finally { await context.close(); }
});
