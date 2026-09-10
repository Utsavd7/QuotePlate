import { expect, test, type Locator } from '@playwright/test';

async function expectCompactCenteredPlayer(section: Locator) {
  const geometry = await section.evaluate((element) => {
    const player = element.querySelector('video')!.parentElement!;
    const box = player.getBoundingClientRect();
    const options = element.querySelector('button[aria-pressed]')!.parentElement!.getBoundingClientRect();
    const sectionBox = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const leftInset = parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const rightInset = parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth);
    const availableWidth = sectionBox.width - leftInset - rightInset;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const headerHeight = innerWidth <= 760 ? 0 : (innerWidth <= 900 ? 6.45 : 4.75) * rem + 1;
    const expectedWidth = element.matches(':target')
      ? Math.min(availableWidth * .87, (innerHeight - headerHeight - 5.25 * rem) * 1.6 * .87)
      : availableWidth * .87;
    return {
      widthDifference: Math.abs(box.width - expectedWidth),
      centerDifference: Math.abs(box.x + box.width / 2 - (sectionBox.x + leftInset + availableWidth / 2)),
      optionsRightDifference: Math.abs(options.right - box.right),
    };
  });
  expect(geometry.widthDifference).toBeLessThanOrEqual(1);
  expect(geometry.centerDifference).toBeLessThanOrEqual(1);
  expect(geometry.optionsRightDifference).toBeLessThanOrEqual(1);
}

test('demo autoplays muted, keeps subtitles optional and fits the viewport', async ({ page }, testInfo) => {
  const mediaRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.mp4')) mediaRequests.push(request.url());
  });
  await page.goto('/');
  expect(mediaRequests).toEqual([]);
  await expect(page.getByRole('button', { name: 'Unmute video', exact: true })).toHaveCount(0);
  await expectCompactCenteredPlayer(page.locator('#watch-demo'));
  await page.getByRole('link', { name: 'Watch the demo' }).click();
  const section = page.locator('#watch-demo');
  const video = section.locator('video');
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('width', '3840');
  await expect(video).toHaveAttribute('height', '2400');
  await expectCompactCenteredPlayer(section);
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
  const framing = await video.evaluate((el: HTMLVideoElement) => ({
    naturalWidth: el.videoWidth,
    naturalHeight: el.videoHeight,
    naturalRatio: el.videoWidth / el.videoHeight,
    displayedRatio: el.getBoundingClientRect().width / el.getBoundingClientRect().height,
    border: getComputedStyle(el.parentElement!).borderWidth,
    radius: getComputedStyle(el.parentElement!).borderRadius,
  }));
  expect(framing.naturalWidth).toBe(3840);
  expect(framing.naturalHeight).toBe(2400);
  expect(framing.naturalRatio).toBe(1.6);
  expect(framing.displayedRatio).toBeCloseTo(framing.naturalRatio, 2);
  expect(framing.border).toBe('0px');
  expect(framing.radius).toBe('16px');
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
  await expect(section).toContainText(/fictional restaurant/i);
  await expect(section).toContainText(/approved pilot owner/i);
  await expect(section).toContainText(/Google/);
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
  expect(text).toMatch(/approved pilot/i);
  expect(text).toMatch(/Google/i);
  expect(text).toMatch(/restaurant(?:['’]s)? (?:details|name)/i);
  expect(text).toMatch(/menu/i);
  expect(text).toMatch(/suppliers/i);
  expect(text).toMatch(/new purchase|create a purchase/i);
  expect(text).toMatch(/price-list photo/i);
  expect(text).toMatch(/one item at a time/i);
  expect(text).toMatch(/compar(?:e|ing)/i);
  expect(text).toMatch(/choos(?:e|ing)/i);
  expect(text).toMatch(/delivery/i);
  expect(text).toMatch(/fictional|example restaurant/i);
  expect(text).toContain('Start your first purchase');
  expect(text).toContain('2:45');
  expect(text).toMatch(/WhatsApp/i);
  expect(text).toMatch(/email/i);
  expect(text).toMatch(/copy/i);
  expect(text).toMatch(/you send the message/i);
  expect(text).toMatch(/confirm contacts, categories and delivery terms/i);
  expect(text).toMatch(/public listings for nearby supplier leads/i);
  expect(text).toMatch(/plan portions, check stock/i);
  expect(text).toMatch(/delivery performance/i);
  expect(text).toMatch(/repeat orders as new drafts/i);
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

test('signup appears only after playback ends, stays below controls, and replay resets it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#watch-demo');
  const section = page.locator('#watch-demo');
  const video = section.locator('video');
  const nextStep = section.getByRole('region', { name: 'Ready for your first purchase?' });
  await expect(nextStep).toHaveCount(0);
  await video.evaluate((element: HTMLVideoElement) => { element.load(); });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.duration)).toBeGreaterThan(160);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = element.duration - 1; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false);
  expect(await video.evaluate((element: HTMLVideoElement) => element.ended)).toBe(false);
  await expect(nextStep).toHaveCount(0);
  await video.evaluate((element: HTMLVideoElement) => element.play());
  await expect(nextStep).toBeVisible();
  const signup = nextStep.getByRole('link', { name: 'Start your first purchase', exact: true });
  await expect(signup).toHaveAttribute('href', '/start');
  await expect(signup).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(nextStep).toContainText('For approved pilot owners. Sign in with Google to begin.');
  await expect(video).toHaveAttribute('controls', '');
  const playerBox = await video.boundingBox();
  const panelBox = await nextStep.boundingBox();
  expect(panelBox!.y).toBeGreaterThanOrEqual(playerBox!.y + playerBox!.height);
  expect(panelBox!.x).toBeCloseTo(playerBox!.x, 0);
  expect(panelBox!.width).toBeCloseTo(playerBox!.width, 0);
  await expect(section.getByRole('button', { name: 'Unmute video', exact: true })).toHaveCount(0);
  expect(await video.evaluate((element: HTMLVideoElement) => element.textTracks[0].mode)).not.toBe('showing');

  const replay = nextStep.getByRole('button', { name: 'Replay video', exact: true });
  // Verify the end-of-playback reveal itself; focus/click must not scroll it into view for us.
  await expect(nextStep).toBeInViewport({ ratio: 1 });
  await expect(signup).toBeInViewport({ ratio: 1 });
  await expect(replay).toBeInViewport({ ratio: 1 });
  await replay.focus();
  await expect(replay).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(nextStep).toHaveCount(0);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeLessThan(5);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);

  // A new manual pause remains respected after an explicit replay.
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await video.scrollIntoViewIfNeeded();
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = element.duration - .25; });
  await video.evaluate((element: HTMLVideoElement) => element.play());
  await expect(nextStep).toBeVisible();
  await expect(nextStep).toBeInViewport({ ratio: 1 });
  await expect(signup).toBeInViewport({ ratio: 1 });
  await signup.click();
  await expect(page).toHaveURL(/\/start$/);
});

test('seeking away from a finished video clears the end panel without changing caption preferences', async ({ page }) => {
  // Autoplay has separate coverage. Keep this seek/caption check in manual-play
  // mode so automatic playback cannot finish between seeking and calling play().
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#watch-demo');
  const section = page.locator('#watch-demo');
  const video = section.locator('video');
  await video.evaluate((element: HTMLVideoElement) => { element.load(); });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.duration)).toBeGreaterThan(160);
  await section.getByRole('button', { name: 'Subtitles off', exact: true }).click();
  // Centre instantly: caption controls may have scrolled the player down.
  await video.evaluate((element: HTMLVideoElement) => {
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    element.currentTime = element.duration - 1;
  });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false);
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  expect(await video.evaluate((element: HTMLVideoElement) => element.ended)).toBe(false);
  await video.evaluate((element: HTMLVideoElement) => element.play());
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.ended)).toBe(true);
  await expect(section.getByRole('button', { name: 'Replay video' })).toBeVisible();
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 20; });
  await expect(section.getByRole('button', { name: 'Replay video' })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Subtitles on', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
