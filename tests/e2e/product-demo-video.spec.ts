import { expect, test } from '@playwright/test';

test('demo autoplays muted, keeps subtitles optional and fits the viewport', async ({ page }, testInfo) => {
  const mediaRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.mp4')) mediaRequests.push(request.url());
  });
  await page.goto('/');
  expect(mediaRequests).toEqual([]);
  await expect(page.getByRole('button', { name: 'Unmute video', exact: true })).toHaveCount(0);
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
  await expect(section.getByRole('button', { name: 'Subtitles off', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await video.evaluate((el: HTMLVideoElement) => el.textTracks[0].mode)).not.toBe('showing');
  expect(await video.evaluate((el: HTMLVideoElement) => el.muted)).toBe(true);
  const unmute = section.getByRole('button', { name: 'Unmute video', exact: true });
  await expect(unmute).toBeVisible();
  await unmute.click();
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.muted)).toBe(false);
  await expect(unmute).toHaveCount(0);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
  await video.scrollIntoViewIfNeeded();
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
  expect(await video.evaluate((el: HTMLVideoElement) => el.muted)).toBe(false);
  await video.evaluate((el: HTMLVideoElement) => { el.muted = true; });
  await expect(unmute).toBeVisible();
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.duration)).toBeLessThanOrEqual(165);
  expect(await video.evaluate((el: HTMLVideoElement) => el.duration)).toBeGreaterThan(160);
  await section.getByRole('button', { name: 'Subtitles off', exact: true }).click();
  await expect(section.getByRole('button', { name: 'Subtitles on', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.textTracks[0].mode)).toBe('showing');
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.textTracks[0].cues?.length ?? 0)).toBeGreaterThan(0);
  await section.getByRole('button', { name: 'Subtitles on', exact: true }).click();
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.textTracks[0].mode)).toBe('disabled');
  // Native caption controls and the visible toggle share the same state.
  await video.evaluate((el: HTMLVideoElement) => { el.textTracks[0].mode = 'showing'; });
  await expect(section.getByRole('button', { name: 'Subtitles on', exact: true })).toHaveAttribute('aria-pressed', 'true');

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
  expect(text).toContain('credits claimed');
  expect(text).toContain('supplier’s performance record');
  expect(text).toContain('real public map listings');
  expect(text).toContain('separate private workspace');
  expect(text).toContain('estimates are not orders');
  expect(text).toContain('Today, Purchases, Suppliers, Menu, and Reports');
  expect(text).toContain('review delivery and total');
  expect(text).toContain('ingredient shortages and purchase quantities');
  expect(text).toContain('2:44 product film');
  expect(text).toContain('wholesale terms');
  expect(text).toContain('matching past prices');
  expect(text).toContain('billed cost per accepted unit');
  expect(text).not.toMatch(/working restaurant demo|internal demo|demo@quoteplate/i);
});


test('natural scrolling pauses and resumes the film but respects a manual pause', async ({ page }) => {
  await page.goto('/');
  const video = page.locator('#watch-demo video');
  await video.scrollIntoViewIfNeeded();
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
  await video.scrollIntoViewIfNeeded();
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
  await video.evaluate((el: HTMLVideoElement) => new Promise<void>(resolve => {
    el.addEventListener('pause', () => resolve(), { once: true });
    el.pause();
  }));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(200);
  await video.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
  // A user can still resume playback explicitly after choosing to pause.
  await video.evaluate((el: HTMLVideoElement) => el.play());
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
});

test('reduced motion leaves the film paused until the user plays it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#watch-demo');
  const video = page.locator('#watch-demo video');
  await video.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
  expect(await video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBe(0);
  await video.evaluate((el: HTMLVideoElement) => el.play());
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0);
});
