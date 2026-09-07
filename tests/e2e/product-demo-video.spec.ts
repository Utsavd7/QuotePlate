import { expect, test } from '@playwright/test';

test('demo loads on demand, plays with captions, and fits the viewport', async ({ page }, testInfo) => {
  const mediaRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.mp4')) mediaRequests.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Watch the demo' }).click();
  const section = page.locator('#watch-demo');
  const video = section.locator('video');
  await expect(video).toBeVisible();
  await expect(page.locator('#demo-title')).toBeHidden();
  await expect.poll(async () => {
    const box = await video.boundingBox();
    return !!box && box.y >= 0 && box.y + box.height <= page.viewportSize()!.height + 1;
  }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('demo-player.png'), animations: 'disabled' });
  await expect(video).toHaveAttribute('preload', 'none');
  expect(mediaRequests).toEqual([]);
  expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);

  await video.evaluate((el: HTMLVideoElement) => el.play());
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.duration)).toBeCloseTo(225, 0);
  await video.evaluate((el: HTMLVideoElement) => { el.textTracks[0].mode = 'showing'; });
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.textTracks[0].cues?.length ?? 0)).toBeGreaterThan(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(section).toContainText('our fictional restaurant in Pune');
  await expect(section.getByRole('link', { name: 'Read transcript' })).toHaveCount(0);
  await expect(section.getByRole('link', { name: 'Download video', exact: true })).toHaveCount(0);
});

test('failed video offers a direct link and a readable transcript', async ({ page }) => {
  await page.route('**/media/*.mp4', (route) => route.abort());
  await page.goto('/#watch-demo');
  await page.locator('#watch-demo video').evaluate((el: HTMLVideoElement) => { void el.play().catch(() => {}); });
  await expect(page.locator('#watch-demo').getByRole('alert')).toContainText('The video could not load');
  await expect(page.getByRole('link', { name: 'Open the video directly' })).toHaveAttribute('href', '/media/quoteplate-product-film.mp4');
  const transcript = await page.request.get('/media/quoteplate-product-film.txt');
  expect(transcript.ok()).toBe(true);
  const text = await transcript.text();
  expect(text).toContain('QuotePlate');
  expect(text).toContain('credit claimed');
  expect(text).toContain('Supplier performance');
  expect(text).toContain('seven point five kilo purchase');
});
