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

    expect(source).toContain("{ href: '/dashboard', icon: LayoutDashboard, label: 'Home' }");
    expect(source).toContain("{ href: '/procurement', icon: ClipboardList, label: 'Buy ingredients' }");
    expect(source).toContain("{ href: '/menus', icon: BookOpen, label: 'Menu and ingredients' }");
    expect(source).toContain("{ href: '/suppliers', icon: Users, label: 'Suppliers' }");
    expect(source).toContain("{ href: '/insights', icon: BarChart3, label: 'Savings and prices' }");
    expect(source).toContain("{ href: '/history', icon: History, label: 'Past purchases' }");
    expect(source).toContain("{ href: '/settings', icon: Settings, label: 'Restaurant settings' }");
    expect(source).toContain(
      '<Plus aria-hidden="true" /> Ask suppliers for prices',
    );
  });

  it('reassures restaurants about privacy immediately before their account', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'app', '(app)', 'layout.tsx'),
      'utf8',
    );
    const privacy = source.indexOf('aria-label="Restaurant data privacy"');
    const account = source.indexOf('<div className={styles.account}>', privacy);

    expect(privacy).toBeGreaterThan(-1);
    expect(source).toContain('Private to your restaurant');
    expect(source).toContain(
      'Other restaurants cannot see your records. Suppliers see their requests, own orders and delivery checks, and estimates you choose to share. Recipes, menus and other suppliers’ prices stay private.',
    );
    expect(account).toBeGreaterThan(privacy);
    expect(source.slice(privacy, account)).not.toContain('<nav');
  });
});
