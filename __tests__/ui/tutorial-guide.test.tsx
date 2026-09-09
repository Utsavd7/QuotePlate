import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { parse } from 'node-html-parser';

import {
  TUTORIAL_STEPS,
  TutorialGuide,
} from '@/components/tutorial/TutorialGuide';
import {
  TUTORIAL_LAST_STEP,
  type TutorialStateDto,
} from '@/lib/tutorial/tutorial-state';

const freshTutorial: TutorialStateDto = {
  version: 1,
  step: 0,
  lastStep: 5,
  skippedAt: null,
  completedAt: null,
};

describe('visible setup guide', () => {
  it('gives six short, direct actions in the order a restaurant needs them', () => {
    expect(TUTORIAL_STEPS).toHaveLength(TUTORIAL_LAST_STEP + 1);
    expect(TUTORIAL_STEPS.map(({ action, href }) => ({ action, href }))).toEqual([
      { action: 'Open Today', href: '/dashboard' },
      { action: 'Open Menu', href: '/menus' },
      { action: 'Open Suppliers', href: '/suppliers' },
      { action: 'New purchase', href: '/procurement/new' },
      { action: 'Open Purchases', href: '/procurement' },
      { action: 'Open Reports', href: '/insights' },
    ]);

    for (const step of TUTORIAL_STEPS) {
      expect(`${step.title} ${step.instruction} ${step.action}`).not.toMatch(/[-\u2010-\u2015]/);
    }

    expect(TUTORIAL_STEPS.map(({ instruction }) => instruction)).toEqual([
      expect.stringContaining('Open Today'),
      expect.stringContaining('Open Menu'),
      expect.stringContaining('Open Suppliers'),
      expect.stringContaining('New purchase'),
      expect.stringContaining('Open Purchases'),
      expect.stringContaining('Open Reports'),
    ]);
  });

  it('shows a new user the first exact action with clear controls', () => {
    const html = renderToStaticMarkup(
      <TutorialGuide initialTutorial={freshTutorial} />,
    );

    expect(html).toContain('Setup guide');
    expect(html).toContain('Step 1 of 6');
    expect(html).toContain('Open Today');
    expect(html).toContain('Next');
    expect(html).toContain('Skip for now');
    expect(html).toContain('Collapse setup guide');
    expect(html).toContain('aria-live="polite"');
  });

  it('keeps skipped progress available to continue', () => {
    const html = renderToStaticMarkup(
      <TutorialGuide
        initialTutorial={{
          ...freshTutorial,
          step: 2,
          skippedAt: '2026-09-01T08:00:00.000Z',
        }}
      />,
    );

    expect(html).toContain('Continue setup');
    expect(html).toContain('Step 3 of 6');
    expect(html).not.toContain('Skip for now');
  });

  it('lets a finished user open the guide again', () => {
    const html = renderToStaticMarkup(
      <TutorialGuide
        initialTutorial={{
          ...freshTutorial,
          step: 5,
          completedAt: '2026-09-01T08:00:00.000Z',
        }}
      />,
    );

    expect(html).toContain('Show setup guide');
    expect(html).toContain('Setup complete');
  });

  it('offers Finish instead of Next on the final step', () => {
    const html = renderToStaticMarkup(
      <TutorialGuide initialTutorial={{ ...freshTutorial, step: 5 }} />,
    );

    expect(html).toContain('Finish');
    expect(html).not.toContain('>Next<');
  });

  it.each(TUTORIAL_STEPS.map((step, index) => ({ ...step, index })))(
    'retains the destination and navigation controls for $title',
    ({ index, title, action, href }) => {
      const root = parse(renderToStaticMarkup(
        <TutorialGuide initialTutorial={{ ...freshTutorial, step: index }} />,
      ));
      expect(root.querySelector('h2')?.text).toBe(title);
      expect(root.querySelector('a')?.getAttribute('href')).toBe(href);
      expect(root.querySelector('a')?.text).toBe(action);
      expect(root.querySelector('button[aria-label="Collapse setup guide"]')).not.toBeNull();
      const buttons = root.querySelectorAll('button').filter((button) => !button.hasAttribute('aria-label'));
      expect(buttons.map((button) => button.text.trim())).toEqual([
        'Back', 'Skip for now', index === 5 ? 'Finish' : 'Next',
      ]);
      expect(buttons[0].hasAttribute('disabled')).toBe(index === 0);
      expect(buttons.every((button) => button.getAttribute('type') === 'button')).toBe(true);
    },
  );

  it.each(['skippedAt', 'completedAt'] as const)(
    'shows save failures with a retry control when %s is set',
    (field) => {
      const useState = React.useState;
      const message = 'Could not save your progress. Please try again.';
      const hook = jest.spyOn(React, 'useState').mockImplementation(((initial: unknown) =>
        useState(initial === '' ? message : initial)) as typeof React.useState);
      try {
        const root = parse(renderToStaticMarkup(
          <TutorialGuide initialTutorial={{ ...freshTutorial, [field]: '2026-09-08T08:00:00.000Z' }} />,
        ));
        expect(root.querySelector('[role="status"]')?.text).toBe(message);
        expect(root.querySelector('button')?.text).toBe(
          field === 'completedAt' ? 'Show setup guide' : 'Continue setup',
        );
        expect(root.querySelector('button')?.hasAttribute('disabled')).toBe(false);
      } finally {
        hook.mockRestore();
      }
    },
  );

  it('uses the shared workspace theme with visible focus and mobile reflow', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/tutorial/tutorial-guide.module.css'), 'utf8');
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|--guideCopper|font-display/);
    for (const token of ['surface', 'canvas', 'line', 'ink', 'muted', 'accent', 'accent-hover', 'selected']) {
      expect(css).toContain(`var(--workspace-${token})`);
    }
    expect(css).toMatch(/\.destination\s*\{[^}]*min-height: 2.75rem/);
    expect(css).toMatch(/\.actions button,\s*\.resume button\s*\{[^}]*min-height: 2.75rem/);
    expect(css).toContain('outline: 3px solid var(--workspace-accent)');
    expect(css).toContain('flex-wrap: wrap');
    expect(css).toMatch(/\.targetRing\s*\{[^}]*pointer-events: none/);
    expect(css).toMatch(/\.anchored\s*\{[^}]*overflow-y: auto/);
    const launcher = css.match(/(?:^|\})\s*\.resume\s*\{([^}]+)\}/)?.[1];
    expect(launcher).toContain('position: static');
    expect(launcher).not.toMatch(/position: fixed|z-index:|bottom:|right:/);
  });

  it('is mounted once in the authenticated workspace shell', () => {
    const layout = readFileSync(
      join(process.cwd(), 'src', 'app', '(app)', 'layout.tsx'),
      'utf8',
    );

    expect(layout).toContain("import { TutorialGuide } from '@/components/tutorial/TutorialGuide';");
    expect(layout.match(/<TutorialGuide initialTutorial=/g)).toHaveLength(1);
  });
});
