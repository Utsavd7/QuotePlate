import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('mobile navigation accessibility contract', () => {
  it('closes on navigation and provides labelled open, close, and Escape actions', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'app', '(app)', 'layout.tsx'),
      'utf8',
    );

    expect(source).toContain('onClick={onNav}');
    expect(source).toContain("if (event.key === 'Escape') {");
    expect(source).toContain('aria-label="Open navigation"');
    expect(source).toContain('aria-label="Close navigation"');
    expect(source).toContain("if (event.key !== 'Tab') return");
    expect(source).toContain('inert={mobileOpen ? true : undefined}');
    expect(source).toContain('opener?.focus()');
  });

  it('uses plain restaurant language without changing workspace routes', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'app', '(app)', 'layout.tsx'),
      'utf8',
    );

    for (const route of ['/dashboard', '/procurement', '/menus', '/suppliers', '/insights', '/history', '/service-planning', '/supplier-collaboration', '/supplier-performance']) {
      expect(source).toContain(`href: '${route}'`);
    }
    for (const label of ['Today', 'Purchases', 'Menu', 'Suppliers', 'Reports']) {
      expect(source).toContain(`label: '${label}'`);
    }
    expect(source).toContain('href="/settings"');
    expect(source).toContain('<Plus aria-hidden="true" /> New purchase');

  });

  it('reassures restaurants about privacy immediately before their account', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'app', '(app)', 'layout.tsx'),
      'utf8',
    );
    const privacy = source.indexOf('<details className={styles.privacy}>');
    const account = source.indexOf('<div className={styles.account}>', privacy);

    expect(privacy).toBeGreaterThan(-1);
    expect(source).toContain('Your information is private');
    expect(source).toContain(
      'Other restaurants cannot see your records. Suppliers see only their requests, orders, delivery checks and estimates you choose to share. Your recipes and other suppliers’ prices stay private.',
    );
    expect(account).toBeGreaterThan(privacy);
    expect(source.slice(privacy, account)).not.toContain('<nav');
  });
});
