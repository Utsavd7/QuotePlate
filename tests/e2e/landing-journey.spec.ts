import { expect, test } from '@playwright/test';

const names = ['Menu', 'Suppliers', 'Request', 'Compare', 'Decision', 'Delivery'];

test('old product bookmarks lead to the homepage journey', async ({ page }) => {
  await page.goto('/product');
  await expect(page).toHaveURL(/\/#how-it-works$/);
  await expect(page.locator('a[href^="/product"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: "From today's menu to tomorrow's order." })).toBeVisible();
});

test('manual steps expose only their content and support keyboard navigation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const stage = page.locator('[data-enhanced="true"]');
  const buttons = page.getByRole('navigation', { name: 'Buying journey steps' }).getByRole('button');
  await expect(stage).toBeVisible();
  for (let index = 0; index < names.length; index += 1) {
    await buttons.nth(index).click();
    await expect(buttons.nth(index)).toHaveAttribute('aria-current', 'step');
    await expect(stage.getByText(`Step ${index + 1} of ${names.length}`, { exact: true })).toBeVisible();
    await expect(buttons.nth(index)).toHaveText(names[index]);
    await expect(page.locator(`#journey-step-${index + 1}`)).toBeVisible();
    await expect(page.locator('.story-scene:not([inert])')).toHaveCount(1);
    await expect(page.locator('.landing-story__track')).toHaveCSS('transform', 'none');
  }
  await buttons.nth(3).click();
  const comparison = page.getByRole('region', { name: 'Sample supplier quote comparison' });
  await comparison.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  const lastColumn = comparison.locator('thead th').last();
  expect(await lastColumn.evaluate((element) => {
    const viewport = element.closest('[role="region"]')!.getBoundingClientRect();
    const column = element.getBoundingClientRect();
    return column.left >= viewport.left - 1 && column.right <= viewport.right + 1;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await buttons.last().focus();
  await page.keyboard.press('Home');
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(buttons.nth(1)).toBeFocused();
  await expect(buttons.nth(1)).toHaveAttribute('aria-current', 'step');

});

test('scrolling never advances the manually selected stage', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Request', exact: true });
  await button.click();
  await page.locator('#benefits').scrollIntoViewIfNeeded();
  await expect(button).toHaveAttribute('aria-current', 'step');
  await page.locator('#how-it-works').scrollIntoViewIfNeeded();
  await expect(button).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('.story-scene__number, .restaurant-benefit__number')).toHaveCount(0);
  await expect(page.locator('[data-enhanced="true"]')).toHaveCSS('position', 'static');
});

test('the complete journey remains readable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  for (let index = 1; index <= names.length; index += 1) {
    await expect(page.locator(`#journey-step-${index}`)).toBeVisible();
  }
  await expect(page.getByRole('navigation', { name: 'Buying journey steps' })).toBeHidden();
  await context.close();
});
