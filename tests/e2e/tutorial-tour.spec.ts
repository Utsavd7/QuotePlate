import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEMO_OWNER_EMAIL } from '../../src/lib/demo/identity';
import { projectTutorial } from '../../src/components/tutorial/tutorial-progress';
import type { TutorialAction, TutorialStateDto } from '../../src/lib/tutorial/tutorial-state';
import { expectNoSeriousAxeViolations } from './helpers/accessibility';

// Match the workspace-polish worker pattern: one normal login, fresh contexts,
// and cookies held only in memory. Seed the local account once per worker.
let demoCookies: Awaited<ReturnType<ReturnType<Page['context']>['cookies']>> | undefined;

async function signIn(page: Page) {
  const origin = String(test.info().project.use.baseURL ?? 'http://127.0.0.1:52560');
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(origin).hostname);
  if (demoCookies) {
    await page.context().addCookies(demoCookies);
    await page.goto('/dashboard');
  } else {
    const fixtureOrigin = process.env.AUTH_E2E_FIXTURE_ORIGIN ?? 'http://127.0.0.1:52562';
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(fixtureOrigin).hostname);
    const seeded = await page.request.post(`${fixtureOrigin}/__test/database/internal-demo`);
    expect(seeded.status()).toBe(201);
    await page.goto('/signin');
    await page.getByLabel('Work email').fill(DEMO_OWNER_EMAIL);
    await page.getByLabel('Password').fill('Local-only demo password 42!');
    await page.getByRole('button', { name: 'Sign in with email' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    demoCookies = await page.context().cookies();
  }
  await expect(page).toHaveURL(/\/dashboard$/);
}

// Exercise the real authenticated shell and data. Only tutorial progress is
// mocked; no signup, demo reseed, purchase or supplier mutation runs.
async function openTour(page: Page) {
  let tutorial: TutorialStateDto = { version: 1, step: 0, lastStep: 5, skippedAt: null, completedAt: null };
  const actions: TutorialAction[] = [];
  await page.route('**/api/account', async route => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const account = await response.json();
    await route.fulfill({ response, json: { ...account, tutorial } });
  });
  await page.route('**/api/tutorial', async route => {
    if (route.request().method() === 'PATCH') {
      const { action, expectedVersion } = route.request().postDataJSON() as { action: TutorialAction; expectedVersion: number };
      expect(expectedVersion).toBe(tutorial.version);
      actions.push(action);
      tutorial = { ...tutorial, version: tutorial.version + 1 };
      if (action === 'NEXT') tutorial.step = Math.min(5, tutorial.step + 1);
      if (action === 'BACK') tutorial.step = Math.max(0, tutorial.step - 1);
      if (action === 'SKIP') tutorial.skippedAt = '2026-09-08T00:00:00.000Z';
      if (action === 'RESUME') tutorial.skippedAt = null;
      if (action === 'COMPLETE') tutorial.completedAt = '2026-09-08T00:00:00.000Z';
      if (action === 'RESTART') tutorial = { ...tutorial, step: 0, skippedAt: null, completedAt: null };
    }
    await route.fulfill({ json: { tutorial } });
  });
  await signIn(page);
  await expect(page.locator('[data-tour-highlight]')).toBeVisible();
  return actions;
}

const guide = (page: Page) => page.locator('aside[data-tour-step]');
const highlighted = (page: Page) => page.locator('[aria-describedby*="-instruction"]');

async function ringFollowsTarget(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await expect(page.locator('[data-tour-highlight]')).toHaveCSS('pointer-events', 'none');
  await expect.poll(async () => {
    const a = await target.boundingBox();
    const ring = await page.locator('[data-tour-highlight]').boundingBox();
    const card = await guide(page).boundingBox();
    const viewport = page.viewportSize();
    if (!a || !ring || !card || !viewport) return false;
    const aligned = Math.abs(ring.x - (a.x - 5)) <= 1 && Math.abs(ring.y - (a.y - 5)) <= 1
      && Math.abs(ring.width - (a.width + 10)) <= 1 && Math.abs(ring.height - (a.height + 10)) <= 1;
    const separate = card.x >= a.x + a.width || card.x + card.width <= a.x
      || card.y >= a.y + a.height || card.y + card.height <= a.y;
    const fits = card.x >= 0 && card.y >= 0 && card.x + card.width <= viewport.width + 1 && card.y + card.height <= viewport.height + 1;
    return aligned && separate && fits;
  }).toBe(true);
  // A portaled guide must fit its content, even inside a full-height drawer.
  // Short viewports may constrain/scroll it; spare room must not stretch it.
  await expect.poll(() => guide(page).evaluate(element => {
    const first = element.firstElementChild;
    const last = element.lastElementChild;
    if (!first || !last) return false;
    const style = getComputedStyle(element);
    const contentHeight = last.getBoundingClientRect().bottom - first.getBoundingClientRect().top;
    const naturalHeight = contentHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const availableHeight = parseFloat(style.maxHeight);
    const expectedHeight = Math.min(naturalHeight, availableHeight);
    return Math.abs(element.getBoundingClientRect().height - expectedHeight) <= 2;
  })).toBe(true);
  // The decoration must not intercept the control it describes.
  expect(await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === element || (hit !== null && element.contains(hit));
  })).toBe(true);
}

async function openMobileNavigation(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) >= 1024) return;
  const opener = page.getByRole('button', { name: 'Open navigation', exact: true }).filter({ visible: true }).first();
  await ringFollowsTarget(page, opener);
  await guide(page).getByRole('button', { name: 'Show navigation', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Workspace navigation', exact: true }).locator('aside[data-tour-step]')).toBeVisible();
}

async function expectCompactLauncher(page: Page, label: string) {
  const launcher = page.locator('aside[data-tutorial-ui]:not([data-tour-step])');
  const button = launcher.getByRole('button', { name: label, exact: true });
  await expect(button).toBeVisible();
  const card = await launcher.boundingBox();
  const control = await button.boundingBox();
  expect(card).not.toBeNull();
  expect(control).not.toBeNull();
  expect(card!.width).toBeLessThanOrEqual(260);
  expect(card!.height).toBeLessThanOrEqual(64);
  expect(control!.height).toBeGreaterThanOrEqual(43.99);
  expect(control!.width).toBeGreaterThanOrEqual(43.99);
  await expect(launcher).toHaveCSS('position', 'static');
  return button;
}

test('six real controls stay highlighted through next, back, movement and resize', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const actions = await openTour(page);
  await openMobileNavigation(page);
  const routes = ['/dashboard', '/menus', '/suppliers', '/procurement/new', '/procurement', '/insights'];
  for (let index = 0; index < routes.length; index++) {
    await expect(guide(page)).toHaveAttribute('data-tour-step', String(index + 1));
    await expect(highlighted(page)).toHaveAttribute('href', routes[index]);
    await ringFollowsTarget(page, highlighted(page));
    if (index === 0) await expect(guide(page).getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
    if (index < 5) await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
  }
  await guide(page).getByRole('button', { name: 'Back', exact: true }).click();
  await expect(highlighted(page)).toHaveAttribute('href', '/procurement');
  await ringFollowsTarget(page, highlighted(page));

  // Simulate content appearing above navigation without dispatching a resize.
  await highlighted(page).evaluate(element => { element.style.marginTop = '18px'; });
  await ringFollowsTarget(page, highlighted(page));
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width - 30, height: size.height - 60 });
  await ringFollowsTarget(page, highlighted(page));
  await page.evaluate(() => window.scrollBy(0, 160));
  await ringFollowsTarget(page, highlighted(page));
  await expectNoSeriousAxeViolations(page, 'aside[data-tour-step]');
  await info.attach('anchored-tour', { body: await page.screenshot(), contentType: 'image/png' });
  await expect(page.locator('aside[data-tutorial-ui]')).toHaveAttribute('data-progress-sync', 'saved');
  expect(actions).toEqual(['NEXT', 'NEXT', 'NEXT', 'NEXT', 'NEXT', 'BACK']);
  expect(errors).toEqual([]);
});

test('real target clicks navigate, collapse, and resume at the same step', async ({ page }) => {
  const actions = await openTour(page);
  await openMobileNavigation(page);
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
  const menu = highlighted(page);
  await expect(menu).toHaveAttribute('href', '/menus');
  await ringFollowsTarget(page, menu);
  await menu.click();
  await expect(page).toHaveURL(/\/menus$/);
  await expect(page.locator('[data-tour-highlight]')).toHaveCount(0);
  await expect(page.locator('[aria-describedby*="-instruction"]')).toHaveCount(0);
  const resume = await expectCompactLauncher(page, 'Continue setup');
  await resume.click();
  await expect(guide(page)).toHaveAttribute('data-tour-step', '2');
  await openMobileNavigation(page);
  await expect(highlighted(page)).toHaveAttribute('href', '/menus');
  await ringFollowsTarget(page, highlighted(page));
  await expect(page.locator('aside[data-tutorial-ui]')).toHaveAttribute('data-progress-sync', 'saved');
  expect(actions).toEqual(['NEXT', 'RESUME']);
});

test('keyboard collapse, skip, completion and reopen retain accessible compact controls', async ({ page }, info) => {
  const actions = await openTour(page);
  await openMobileNavigation(page);
  const collapse = guide(page).getByRole('button', { name: 'Collapse setup guide', exact: true });
  await collapse.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-tour-highlight]')).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 1440) < 1024) {
    // Escape inside the guide collapses only the guide, keeping drawer focus valid.
    const dialog = page.getByRole('dialog', { name: 'Workspace navigation', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Today', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
  const resume = await expectCompactLauncher(page, 'Continue setup');
  await resume.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(resume).toBeFocused();
  await expect(resume).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(guide(page)).toHaveAttribute('data-tour-step', '1');
  await guide(page).getByRole('button', { name: 'Skip for now', exact: true }).click();
  await (await expectCompactLauncher(page, 'Continue setup')).click();
  for (let index = 0; index < 5; index++) {
    await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(guide(page)).toHaveAttribute('data-tour-step', String(index + 2));
  }
  await guide(page).getByRole('button', { name: 'Finish', exact: true }).click();
  const restart = await expectCompactLauncher(page, 'Show setup guide');
  await expect(page.getByText('Setup complete', { exact: true })).toBeVisible();
  await expectNoSeriousAxeViolations(page, 'aside[data-tutorial-ui]');
  await info.attach('completed-tour-launcher', { body: await page.screenshot(), contentType: 'image/png' });
  await restart.click();
  await expect(guide(page)).toHaveAttribute('data-tour-step', '1');
  await expect(page.locator('aside[data-tutorial-ui]')).toHaveAttribute('data-progress-sync', 'saved');
  expect(actions).toEqual(['RESUME', 'SKIP', 'RESUME', 'NEXT', 'NEXT', 'NEXT', 'NEXT', 'NEXT', 'COMPLETE', 'RESTART']);
});

test('pauses for supplier and native modals and restores the same tour step', async ({ page }) => {
  const actions = await openTour(page);
  await page.goto('/suppliers');
  await expect(page.locator('[data-tour-highlight]')).toBeVisible();
  await page.getByRole('button', { name: 'Add supplier', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: 'Add supplier', exact: true });
  await expect(editor).toBeVisible();
  await expect(guide(page)).toHaveCount(0);
  await expect(page.locator('[data-tour-highlight]')).toHaveCount(0);
  await expect(page.locator('[aria-describedby*="-instruction"]')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Close supplier form', exact: true }).click();
  await expect(guide(page)).toHaveAttribute('data-tour-step', '1');
  await ringFollowsTarget(page, highlighted(page));

  // Native showModal() does not need aria-modal to make the page inert.
  await page.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.id = 'native-tour-regression';
    dialog.setAttribute('aria-label', 'Native test dialog');
    const button = document.createElement('button');
    button.textContent = 'Close native dialog';
    button.addEventListener('click', () => dialog.close());
    dialog.append(button);
    document.body.append(dialog);
    dialog.showModal();
  });
  await expect(guide(page)).toHaveCount(0);
  await expect(page.locator('[data-tour-highlight]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close native dialog' }).click();
  await expect(guide(page)).toHaveAttribute('data-tour-step', '1');
  await ringFollowsTarget(page, highlighted(page));
  await expect(page.locator('aside[data-tutorial-ui]')).toHaveAttribute('data-progress-sync', 'saved');
  expect(actions).toEqual([]);
});

test('short mobile drawer keeps the fallback in its accessible scroll flow', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-chromium', 'Mobile drawer regression.');
  await openTour(page);
  await openMobileNavigation(page);
  // At 200px, a control near the bottom can still fit a valid callout above.
  // This extreme zoom/keyboard fixture leaves less than 128px on either side.
  await page.setViewportSize({ width: 320, height: 120 });
  const dialog = page.getByRole('dialog', { name: 'Workspace navigation', exact: true });
  const fallback = dialog.locator('aside[data-tour-fallback="true"]');
  await expect(fallback).toBeVisible();
  expect(await fallback.evaluate(element => element.closest('[inert]') === null)).toBe(true);
  await expect(fallback).toHaveCSS('position', 'static');
  await expect(page.locator('[data-tour-highlight]')).toHaveCount(0);
  const skip = fallback.getByRole('button', { name: 'Skip for now', exact: true });
  await skip.focus();
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(fallback).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expectCompactLauncher(page, 'Continue setup');
});

test('rapid clicks stay immediate while slow saves serialize and never reopen a collapsed guide', async ({ page }) => {
  await openTour(page);
  let release!: () => void;
  const slowResponse = new Promise<void>(resolve => { release = resolve; });
  let canonical: TutorialStateDto = { version: 1, step: 0, lastStep: 5, skippedAt: null, completedAt: null };
  const requests: Array<{ action: TutorialAction; expectedVersion: number }> = [];
  await page.route('**/api/tutorial', async route => {
    const command = route.request().postDataJSON() as { action: TutorialAction; expectedVersion: number };
    requests.push(command);
    if (requests.length === 1) await slowResponse;
    expect(command.expectedVersion).toBe(canonical.version);
    canonical = projectTutorial(canonical, { action: command.action, at: '2026-09-09T00:00:00.000Z' });
    await route.fulfill({ json: { tutorial: canonical } });
  });
  try {
    await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(guide(page)).toHaveAttribute('data-tour-step', '2', { timeout: 1000 });
    await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(guide(page)).toHaveAttribute('data-tour-step', '3', { timeout: 1000 });
    await guide(page).getByRole('button', { name: 'Back', exact: true }).click();
    await expect(guide(page)).toHaveAttribute('data-tour-step', '2', { timeout: 1000 });
    await expect(guide(page).getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
    await expect(guide(page).getByRole('button', { name: 'Back', exact: true })).toBeEnabled();
    await expect(guide(page)).toHaveAttribute('data-progress-sync', 'saving');
    expect(requests).toEqual([{ action: 'NEXT', expectedVersion: 1 }]);
    await guide(page).getByRole('button', { name: 'Collapse setup guide' }).click();
    const resume = page.getByRole('button', { name: 'Continue setup', exact: true });
    await expect(resume).toBeEnabled();
    release();
    await expect(page.locator('aside[data-tutorial-ui]')).toHaveAttribute('data-progress-sync', 'saved');
    await expect(guide(page)).toHaveCount(0);
    expect(requests).toEqual([
      { action: 'NEXT', expectedVersion: 1 }, { action: 'NEXT', expectedVersion: 2 }, { action: 'BACK', expectedVersion: 3 },
    ]);
    await resume.click();
    await expect(guide(page)).toHaveAttribute('data-tour-step', '2');
    await expect(guide(page)).toHaveAttribute('data-progress-sync', 'saved');
  } finally { release(); }
});

test('conflict rebase and failed saves keep navigation usable and retry only after reading canonical progress', async ({ page }) => {
  await openTour(page);
  let canonical: TutorialStateDto = { version: 1, step: 0, lastStep: 5, skippedAt: null, completedAt: null };
  const writes: Array<{ action: TutorialAction; expectedVersion: number }> = [];
  let reads = 0;
  await page.route('**/api/tutorial', async route => {
    if (route.request().method() === 'GET') {
      reads++;
      return route.fulfill({ json: { tutorial: canonical } });
    }
    const command = route.request().postDataJSON() as { action: TutorialAction; expectedVersion: number };
    writes.push(command);
    if (writes.length === 1) {
      canonical = { ...canonical, step: 2, version: 5 };
      return route.fulfill({ status: 409, json: {} });
    }
    if (writes.length === 2) return route.fulfill({ status: 503, json: {} });
    expect(command.expectedVersion).toBe(canonical.version);
    canonical = projectTutorial(canonical, { action: command.action, at: '2026-09-09T00:00:00.000Z' });
    return route.fulfill({ json: { tutorial: canonical } });
  });
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expect(guide(page)).toHaveAttribute('data-progress-sync', 'unsaved');
  await expect(guide(page)).toHaveAttribute('data-tour-step', '4');
  await expect(guide(page).getByRole('status')).toContainText('Progress not saved');
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expect(guide(page)).toHaveAttribute('data-tour-step', '5');
  expect(writes).toHaveLength(2);
  await guide(page).getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(guide(page)).toHaveAttribute('data-progress-sync', 'saved');
  expect(reads).toBe(2);
  expect(writes.map(write => write.expectedVersion)).toEqual([1, 5, 5, 6]);
  expect(canonical).toMatchObject({ step: 4, version: 7 });
});

test('keyboard and reduced-motion navigation is instant while the target ring never animates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTour(page);
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
  const instructions = guide(page).locator('h2').locator('..');
  // The app-wide reduced-motion rule uses 0.01ms to preserve transition events.
  expect(await instructions.evaluate(element => Math.max(...getComputedStyle(element).transitionDuration.split(',').map(parseFloat)))).toBeLessThanOrEqual(.00001);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await guide(page).getByRole('button', { name: 'Next', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(guide(page)).toHaveAttribute('data-motion', 'instant');
  await expect(instructions).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('[data-tour-highlight]')).toHaveCSS('transition-duration', '0s');
  await expect(guide(page)).toHaveAttribute('data-progress-sync', 'saved');
});

for (const field of ['skippedAt', 'completedAt'] as const) {
  test(`successful reconciliation adopts canonical ${field} without collapsing on a failed refresh`, async ({ page }) => {
    await openTour(page);
    const saved: TutorialStateDto = { version: 8, step: 5, lastStep: 5, skippedAt: null, completedAt: null, [field]: '2026-09-09T00:00:00.000Z' };
    let reads = 0;
    await page.route('**/api/tutorial', async route => {
      if (route.request().method() === 'PATCH') return route.abort('failed');
      if (++reads === 2) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: { tutorial: saved } });
    });
    await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
    await guide(page).getByRole('button', { name: 'Retry save', exact: true }).click();
    await guide(page).getByRole('button', { name: 'Use saved progress', exact: true }).click();
    await expect(guide(page).getByRole('status')).toContainText('Could not load saved progress');
    await expect(guide(page)).toHaveAttribute('data-tour-step', '2');
    await guide(page).getByRole('button', { name: 'Use saved progress', exact: true }).click();
    await expect(guide(page)).toHaveCount(0);
    await expectCompactLauncher(page, field === 'completedAt' ? 'Show setup guide' : 'Continue setup');
    await expect(page.locator('aside[data-tutorial-ui]')).toHaveAttribute('data-progress-sync', 'saved');
  });
}
