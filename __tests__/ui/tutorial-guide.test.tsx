import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
      { action: 'Open suppliers', href: '/suppliers' },
      { action: 'Ask suppliers for prices', href: '/procurement/new' },
      { action: 'Compare supplier prices', href: '/procurement' },
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
    expect(html).toContain('Six guided steps');
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

  it('is mounted once in the authenticated workspace shell', () => {
    const layout = readFileSync(
      join(process.cwd(), 'src', 'app', '(app)', 'layout.tsx'),
      'utf8',
    );

    expect(layout).toContain("import { TutorialGuide } from '@/components/tutorial/TutorialGuide';");
    expect(layout.match(/<TutorialGuide initialTutorial=/g)).toHaveLength(1);
  });
});
