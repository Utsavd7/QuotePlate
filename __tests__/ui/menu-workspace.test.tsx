import { readFileSync } from 'node:fs';
import path from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';

import {
  MenuIntakeDialog,
  MenuWorkspace,
} from '@/components/menus/MenuWorkspace';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe('menu workspace', () => {
  it('explains review and approval in plain English', () => {
    const html = renderToStaticMarkup(
      <MenuWorkspace
        initialMenus={[
          {
            id: 'menu-1',
            name: 'Dinner menu',
            status: 'DRAFT',
            version: 2,
            approvedAt: null,
            updatedAt: '2026-08-28T08:00:00.000Z',
          },
        ]}
        initialError=""
      />,
    );

    expect(html).toContain('Prepare what you need');
    expect(html).toContain('<h1>Menu</h1>');
    expect(html).toContain('Add your menu, check ingredients, then approve it for planning.');
    expect(html).toContain('Dinner menu');
    expect(html).toContain('Open and check the ingredient list');
    expect(html).toContain('Needs review');
    expect(html).toContain('Add menu');
    expect(html).toContain('Your recipes and menus stay private to your restaurant.');
    expect(html).toContain('Other suppliers’ prices remain private.');
    expect(html).toContain('Other restaurants cannot see your records.');
    expect(html).toContain('Suppliers see requests you send, their own orders and delivery checks, and ingredient estimates you explicitly share.');
    expect(html).not.toContain('AI');
    expect(html).not.toContain('AutoRFP');
  });

  it('reassures the restaurant when the read-only menu load fails', () => {
    const html = renderToStaticMarkup(
      <MenuWorkspace initialMenus={[]} initialError="We could not load menus." />,
    );

    expect(html).toContain('We could not load menus.');
    expect(html).toContain('Your saved restaurant records are unchanged.');
    expect(html).toContain('Try again');
  });

  it('keeps the menu privacy reassurance visible on narrower screens', () => {
    const html = renderToStaticMarkup(
      <MenuWorkspace initialMenus={[]} initialError="" />,
    );
    const css = readFileSync(
      path.resolve(__dirname, '../../src/components/menus/menu-workspace.module.css'),
      'utf8',
    );

    expect(html).toContain('<details class="privacyReassurance">');
    expect(css).toContain('.privacyReassurance');
    expect(css).not.toMatch(/[^{}]*\.privacyReassurance[^{}]*\{[^}]*display\s*:\s*none/);
    expect(css).not.toMatch(/[^{}]*\.explainer\s+small[^{}]*\{[^}]*display\s*:\s*none/);
  });

  it('uses the task-led browser title', () => {
    const page = readFileSync(
      path.resolve(__dirname, '../../src/app/(app)/menus/page.tsx'),
      'utf8',
    );

    expect(page).toContain("metadata = { title: 'Menu' };");
    expect(page).not.toContain('Menu and ingredients · QuotePlate');
  });

  it('has a clear empty state', () => {
    const html = renderToStaticMarkup(
      <MenuWorkspace initialMenus={[]} initialError="" />,
    );

    expect(html).toContain('Add your restaurant menu');
    expect(html).toContain('Paste one dish per line');
  });

  it('offers the next real API page when a cursor is available', () => {
    const Workspace = MenuWorkspace as unknown as React.ComponentType<Record<string, unknown>>;
    const html = renderToStaticMarkup(
      <Workspace initialMenus={[]} initialError="" initialNextCursor="menu-page-2" />,
    );

    expect(html).toContain('Load more menus');
  });

  it('offers three plainly labelled ways to add a menu', () => {
    const html = renderToStaticMarkup(
      <MenuIntakeDialog onClose={jest.fn()} onCreated={jest.fn()} />,
    );

    expect(html).toContain('Type or paste');
    expect(html).toContain('Photos');
    expect(html).toContain('Permitted website link');
    expect(html).not.toContain('AI');
  });

  it('uses a camera friendly private photo input and clear privacy copy', () => {
    const html = renderToStaticMarkup(
      <MenuIntakeDialog
        initialMode="photo"
        onClose={jest.fn()}
        onCreated={jest.fn()}
      />,
    );

    expect(html).toContain('accept="image/*"');
    expect(html).toContain('capture="environment"');
    expect(html).toContain('multiple=""');
    expect(html).toContain('never uploaded or saved');
    expect(html).toContain('Use your phone');
  });

  it('requires website permission before importing editable menu text', () => {
    const html = renderToStaticMarkup(
      <MenuIntakeDialog
        initialMode="url"
        onClose={jest.fn()}
        onCreated={jest.fn()}
      />,
    );

    expect(html).toContain('I have permission to use this menu');
    expect(html).toContain('Import menu text');
    expect(html).toContain('type="checkbox"');
  });
});
