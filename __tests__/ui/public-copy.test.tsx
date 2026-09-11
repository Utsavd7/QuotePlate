import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicLandingPage } from '../../src/components/public/PublicLandingPage';
import { PublicHeader } from '../../src/components/public/PublicHeader';
import { ProductDecisionPreview } from '../../src/components/public/ProductDecisionPreview';
import { LandingJourney } from '../../src/components/public/LandingJourney';
import { AuthPageShell } from '../../src/components/auth/AuthPageShell';
import {
  formatSampleInr,
  restaurantSampleQuotes,
  restaurantSampleRequest,
} from '../../src/data/sample-procurement';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), replace: jest.fn() }),
}));

const root = path.resolve(__dirname, '../..');

function source(file: string) {
  const absolute = path.join(root, file);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
}

function luminance(hex: string) {
  const channels = hex.match(/[\da-f]{2}/gi)?.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  if (!channels || channels.length !== 3) throw new Error(`Invalid color: ${hex}`);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const publicFiles = [
  'src/app/page.tsx',
  'src/app/product/page.tsx',
  'src/app/privacy/page.tsx',
  'src/app/terms/page.tsx',
  'src/components/public/PublicLandingPage.tsx',
  'src/components/public/PublicHeader.tsx',
  'src/components/public/PublicFooter.tsx',
  'src/components/public/LegalPageLayout.tsx',
  'src/components/public/JourneyStage.tsx',
  'src/components/public/ProductDecisionPreview.tsx',
  'src/components/public/JourneyIcon.tsx',
  'src/components/public/LandingJourney.tsx',
];

describe('public website contract', () => {
  test('keeps the provisional name and tagline in one brand authority', () => {
    const brand = source('src/config/brand.ts');
    const routeAndComponentSource = publicFiles.map(source).join('\n');

    expect(brand).toContain("productName: 'QuotePlate'");
    expect(brand).toContain("companyName: 'QuotePlate Technologies'");
    expect(brand).toContain("tagline: 'Every quote, accountable.'");
    expect(routeAndComponentSource).not.toMatch(/['"`]QuotePlate(?: Technologies)?['"`]/);
  });

  test('keeps the home page static and independent of identity or data access', () => {
    const home = source('src/app/page.tsx');
    const landingDependencies = [
      'src/components/public/PublicLandingPage.tsx',
      'src/components/public/LandingJourney.tsx',
      'src/components/public/JourneyIcon.tsx',
      'src/components/public/ProductDecisionPreview.tsx',
    ].map(source).join('\n');

    expect(home).not.toContain("'use client'");
    expect(home).not.toMatch(/next-auth|@\/lib\/(?:auth|prisma)|\/api\//);
    expect(landingDependencies).not.toMatch(/next-auth|@\/lib\/(?:auth|prisma)|\/api\//);
    expect(home).toContain('<PublicLandingPage');
  });

  test('uses the approved product-led hero', () => {
    const landing = source('src/components/public/PublicLandingPage.tsx');
    const markup = renderToStaticMarkup(<PublicLandingPage />);

    expect(markup).toContain('Send one list.');
    expect(markup).toContain('Compare every supplier.');
    expect(markup).toContain('Choose the best deal.');
    expect(markup).toContain('Compare prices');
    expect(markup).toContain('You choose the supplier');
    expect(markup).toContain('No card required');
    expect(markup).toContain(`${restaurantSampleQuotes.length} supplier replies`);
    expect(markup).toContain(`${restaurantSampleRequest.items.length} items requested`);
    expect(markup).toContain('Sample replies, not customer activity.');
    expect(markup).toContain(`Sample ${restaurantSampleRequest.id}; see which items each supplier quoted.`);
    expect(markup).toContain('Sample choice pending. Your restaurant decides.');
    expect(landing).toContain('<LandingJourney');
    expect(landing).not.toMatch(/['"]use client['"]/);
  });

  test('integrates the buying journey between the hero proof and private closing action', () => {
    const markup = renderToStaticMarkup(<PublicLandingPage />);
    const heroStart = markup.indexOf('<section class="public-hero');
    const heroRouteStart = markup.indexOf('<div class="hero-route"');
    const proofStart = markup.indexOf('<section class="proof-band');
    const journeyStart = markup.indexOf('<section class="landing-story');
    const benefitsStart = markup.indexOf('<section class="restaurant-benefits');
    const privacyStart = markup.indexOf('<section class="privacy-story');
    const closingStart = markup.indexOf('<section class="public-cta');
    const mainEnd = markup.indexOf('</main>');
    const orderedSections = [heroRouteStart, proofStart, journeyStart, benefitsStart, privacyStart, closingStart];

    expect(heroStart).toBeGreaterThanOrEqual(0);
    expect(orderedSections.every((index) => index >= 0)).toBe(true);
    expect(orderedSections).toEqual([...orderedSections].sort((a, b) => a - b));

    const heroMarkup = markup.slice(heroStart, proofStart);
    const heroRouteMarkup = markup.slice(heroRouteStart, proofStart);
    const routeLabels = ['Choose ingredients', 'Compare prices', 'Choose supplier', 'Check delivery'];
    let previousRouteLabel = -1;

    expect(heroRouteMarkup).toContain('aria-label="QuotePlate buying journey"');
    for (const label of routeLabels) {
      const labelIndex = heroRouteMarkup.indexOf(`>${label}</span>`);
      expect(labelIndex).toBeGreaterThan(previousRouteLabel);
      previousRouteLabel = labelIndex;
    }
    expect(heroMarkup).not.toContain('href="/product"');
    expect(heroMarkup.match(/href="\/start"/g)).toHaveLength(1);
    expect(heroMarkup).toContain('href="#watch-demo"');
    expect(heroMarkup.match(/href="\/start">Get started /g)).toHaveLength(1);

    const journeyMarkup = markup.slice(journeyStart, privacyStart);
    expect(journeyMarkup).toContain('Choose ingredients');
    expect(journeyMarkup).toContain('Choose supplier');

    const privacyMarkup = markup.slice(privacyStart, closingStart);
    expect(privacyMarkup).toContain('<dl class="privacy-map">');
    expect(privacyMarkup).toContain('<p class="public-eyebrow">Clear boundaries</p>');
    expect(privacyMarkup).not.toContain('public-eyebrow--light');
    expect(privacyMarkup).toContain('Your recipes stay private with your restaurant.');

    const closingMarkup = markup.slice(closingStart, mainEnd);
    expect(closingMarkup).toContain('<div class="public-hero__actions">');
    expect(closingMarkup.match(/href="\/start"/g)).toHaveLength(1);
    expect(closingMarkup).not.toContain('href="/product"');
    expect(closingMarkup.match(/href="\/start">Get started /g)).toHaveLength(1);
  });

  test('explains why restaurant teams keep using the product after the first purchase', () => {
    const markup = renderToStaticMarkup(<PublicLandingPage />);
    const benefitsStart = markup.indexOf('<section class="restaurant-benefits');
    const privacyStart = markup.indexOf('<section class="privacy-story');
    const benefits = markup.slice(benefitsStart, privacyStart);

    expect(benefitsStart).toBeGreaterThanOrEqual(0);
    expect(benefits).toContain('Useful for every purchase, not just the first one.');
    for (const benefit of [
      'Repeat a purchase',
      'See the full cost',
      'Keep delivery records',
      'Plan meals and stock',
      'Follow up credits',
      'Review supplier deliveries',
    ]) expect(benefits).toContain(benefit);
    expect(benefits.match(/class="restaurant-benefit"/g)).toHaveLength(6);
    expect(benefits).not.toMatch(/guaranteed|save \d+%|recommended supplier/i);
  });

  test('presents the restaurant procurement story in the approved order', () => {
    const markup = renderToStaticMarkup(<LandingJourney />);
    const orderedStory = [
      'Choose ingredients',
      'Invite your suppliers',
      'Ask for prices',
      'Compare prices',
      'Choose supplier',
      'Check delivery',
    ];
    let previousIndex = -1;

    for (const statement of orderedStory) {
      expect(markup).toContain(statement);
      const statementIndex = markup.indexOf(`<h3>${statement}</h3>`);
      expect(statementIndex).toBeGreaterThan(previousIndex);
      previousIndex = statementIndex;
    }

    expect(markup).toContain('Take menu photos');
    expect(markup).toContain('permitted website link');
    expect(markup).toContain('In Plan meals, choose meals and portions, check stock, then review missing ingredients.');
    expect(markup).toContain('Enter batch servings, usable stock, yield and confirmed arrivals explicitly.');
    expect(markup).toContain('Choose WhatsApp or Email to prepare a message, then press Send in that app.');
    expect(markup).toContain('enter prices, review the total and submit their quote.');
    expect(markup).toContain('Check dish names, add ingredients and quantities, then approve the menu.');
    expect(markup).toContain('Enter dish names only.');
    expect(markup).toContain('Or start a purchase directly from a typed shopping list or photo');
    expect(markup).not.toContain('enter ingredients directly');
    expect(markup).toContain('Use your saved suppliers');
    expect(markup).toContain('allow new suppliers to apply, then approve them yourself');
    expect(markup).not.toContain('verified new suppliers');
    expect(markup).toContain('No supplier account needed');
    expect(markup).toContain('Suppliers see only their assigned items, quantities and delivery terms');
    expect(markup).toContain('Compare item prices, GST, delivery charges and dates');
    expect(markup).toContain('Check the full total');
    expect(markup).toContain('choose one supplier or split items between suppliers');
    expect(markup).toContain('Your restaurant makes the final choice.');
    expect(markup).toContain('<ol class="landing-story__track" role="list">');
    for (const category of ['Coffee &amp; tea', 'Sweets', 'Packaged foods']) {
      expect(markup).toContain(category);
    }
  });

  test('loads cinematic story styles only with the landing route', () => {
    const home = source('src/app/page.tsx');
    const globalCss = source('src/app/globals.css');
    const landingCss = source('src/app/landing.css');

    expect(home).toContain("import './landing.css'");
    expect(landingCss).toContain('.hero-route');
    expect(landingCss).toContain('.landing-story');
    expect(landingCss).toContain('.privacy-story');
    expect(landingCss).toMatch(/@supports\s*\(\s*animation-timeline\s*:\s*view\(\s*\)\s*\)/);
    expect(landingCss).toMatch(/\.privacy-map\s*\{[^}]*animation-timeline\s*:\s*view\(/);
    expect(landingCss).not.toMatch(/\binfinite\b/i);
    expect(globalCss).not.toContain('.hero-route');
    expect(globalCss).not.toContain('.landing-story');
    expect(globalCss).not.toContain('.privacy-story');
  });

  test('lets the quote comparison title follow its surrounding heading level', () => {
    const defaultMarkup = renderToStaticMarkup(<ProductDecisionPreview />);
    const nestedMarkup = renderToStaticMarkup(<ProductDecisionPreview headingLevel={4} />);

    expect(defaultMarkup).toContain('<h2 id="decision-preview-title">Compare prices</h2>');
    expect(nestedMarkup).toContain('<h4 id="decision-preview-title">Compare prices</h4>');
  });

  test('uses consistent local icons for the landing journey diagram', () => {
    const journeyIcon = source('src/components/public/JourneyIcon.tsx');
    const landingJourney = source('src/components/public/LandingJourney.tsx');

    expect(journeyIcon).toMatch(/from ['"]lucide-react['"]/);
    expect(journeyIcon).toMatch(/strokeWidth\s*=\s*\{1\.8\}/);
    expect(journeyIcon).not.toMatch(/['"]use client['"]/);
    expect(landingJourney).toContain('<JourneyIcon');
    expect(landingJourney).not.toMatch(/['"]use client['"]/);
    expect(landingJourney).not.toMatch(/https?:\/\//i);
    expect(landingJourney).not.toMatch(/<img\b/i);
    expect(landingJourney).not.toMatch(
      /(?:from\s+['"]three(?:\/[^'"]*)?['"]|require\s*\(\s*['"]three(?:\/[^'"]*)?['"])/i,
    );
    expect(landingJourney).not.toMatch(/\bgsap\b/i);
  });

  test('renders the approved header links with accessible names and destinations', () => {
    const markup = renderToStaticMarkup(<PublicHeader home />);

    expect(markup).toContain('aria-label="Primary navigation"');
    expect(markup).not.toContain('href="/product"');
    expect(markup).toContain('<a href="#how-it-works">How it works</a>');
    expect(markup).toContain('<a href="#security">Security</a>');
    expect(markup).toContain('<a class="public-text-action" href="/signin">Sign in</a>');
    expect(markup).toContain('<a class="public-button public-button--small" href="/start">Get started</a>');
  });

  test('exposes every required public destination with honest calls to action', () => {
    const markup = renderToStaticMarkup(<PublicLandingPage />);
    const allPublicSource = publicFiles.map(source).join('\n');

    for (const destination of ['#watch-demo', '#how-it-works', '#security', '/privacy', '/terms', '/signin', '/start']) {
      expect(markup).toContain(`href="${destination}"`);
    }

    expect(markup).not.toContain('See the product');
    expect(markup).toContain('Get started');
    expect(allPublicSource).not.toMatch(
      /\b(?:AI|artificial intelligence|automatic negotiation|market pricing|guaranteed savings|customer count|integrations?)\b/i,
    );
  });



  test('explains public verified-Google signup before account onboarding', () => {
    const markup = renderToStaticMarkup(
      <AuthPageShell
        callbackUrl="/dashboard"
        googleAvailable
        mode="start"
      />,
    );

    expect(markup).toContain('Keep your team, suppliers, purchases and order history in one restaurant workspace.');
    expect(markup).toContain('Your restaurant chooses the supplier and confirms each order.');
    expect(markup).toContain('aria-label="Create your restaurant workspace"');
    expect(markup).toContain('Sign up with your verified Google email');
    expect(markup).toContain('No operator approval needed');
    expect(markup).toContain('No payment card. No billing.');
    expect(markup.indexOf('Create your restaurant workspace')).toBeLessThan(
      markup.indexOf('Create your workspace'),
    );
  });

  test('shows owner fields without a password for Google-only registration', () => {
    const markup = renderToStaticMarkup(
      <AuthPageShell
        callbackUrl="/dashboard"
        emailOwnerSignupAvailable={false}
        googleAvailable
        mode="start"
      />,
    );

    expect(markup).toContain('<label><span>Your name</span>');
    expect(markup).toContain('<label><span>Work email</span>');
    expect(markup).not.toContain('<span>Password</span>');
  });

  test('explains unavailable Google signup without offering password-only owner creation', () => {
    const markup = renderToStaticMarkup(
      <AuthPageShell callbackUrl="/dashboard" googleAvailable={false} emailOwnerSignupAvailable={false} mode="start" />,
    );
    expect(markup).toContain('Google signup is temporarily unavailable. Please try again later.');
    expect(markup).toContain('Choose the same email you entered above.');
    expect(markup).not.toContain('Create workspace with email');
    expect(markup).not.toContain('<span>Password</span>');
    expect(markup).not.toContain('Use email and password');
    expect(markup).toContain('href="/signin"');
  });

  test('retains password signup controls for local fixtures and credentials for returning users', () => {
    const fixture = renderToStaticMarkup(
      <AuthPageShell callbackUrl="/dashboard" googleAvailable emailOwnerSignupAvailable mode="start" />,
    );
    expect(fixture).toContain('Create workspace with email');
    expect(fixture).toContain('<span>Password</span>');
    const signin = renderToStaticMarkup(
      <AuthPageShell callbackUrl="/dashboard" googleAvailable={false} emailOwnerSignupAvailable={false} mode="signin" />,
    );
    expect(signin).toContain('Sign in with email');
    expect(signin).toContain('<span>Password</span>');
  });

  test('keeps sign in focused on account access and states browser session storage accurately', () => {
    const markup = renderToStaticMarkup(
      <AuthPageShell
        callbackUrl="/dashboard"
        googleAvailable
        mode="signin"
      />,
    );

    expect(markup).toContain('Open your purchases, compare prices and check deliveries.');
    expect(markup).toContain('Your restaurant chooses the supplier and confirms each order.');
    expect(markup).not.toContain('Create your restaurant workspace');
    expect(markup).toContain('class="public-header public-header--sticky"');
    expect(markup).not.toContain('href="/product"');
    expect(markup).toContain('href="/#how-it-works">How it works</a>');
    expect(markup).toContain('href="/#security">Security</a>');
    expect(markup).toContain('your browser stores only the session needed to keep you signed in');
    expect(markup).not.toContain('No supplier, quote, or workspace data is stored in this browser.');
  });

  test('shows a factual product decision in the hero without inventing market data', () => {
    const markup = renderToStaticMarkup(<ProductDecisionPreview />);

    expect(markup).toContain('Sample data');
    expect(markup).toContain('Sample purchase');
    expect(markup).toContain('You choose the supplier');
    expect(markup).toContain('href="#watch-demo"');
    expect(markup).toContain('Watch demo');
    expect(markup).toContain('Illustrative prices · not live market data');
    expect(markup).toContain('role="region"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).not.toContain('<aside');

    for (const quote of restaurantSampleQuotes) {
      expect(markup).toContain(quote.supplierName);
      expect(markup).toContain(formatSampleInr(quote.totalPaise));
      expect(markup).toContain(
        `${quote.coverageCount} of ${restaurantSampleRequest.items.length} items`,
      );
    }

    const sidebar = markup.split('class="decision-preview__sidebar"')[1]?.split('</div>')[0] ?? '';
    for (const label of ['Today', 'Purchases', 'Suppliers', 'Menu', 'Reports']) {
      expect(sidebar).toContain(`<span>${label}</span>`);
    }
    expect(markup).toContain('Total with GST &amp; delivery');
    expect(markup).toContain('Items quoted');
    expect(markup).toContain('Scroll to compare suppliers');
    expect(markup).not.toMatch(/guaranteed|recommended supplier|customer count|production telemetry/i);
  });

  test('states concrete workflow and security boundaries without certifications', () => {
    const markup = renderToStaticMarkup(<PublicLandingPage />);
    const allPublicSource = publicFiles.map(source).join('\n');

    expect(markup).toContain('₹');
    expect(markup).toMatch(/GST/);
    expect(markup).toMatch(/no supplier account/i);
    expect(markup).toContain('Your approval required');
    expect(markup).toContain('Your recipes stay private with your restaurant.');
    expect(markup).toContain('Your restaurant team');
    expect(markup).toContain('Their requests, ordered items, delivery checks and explicitly shared ingredient estimates');
    expect(markup).toContain('No supplier account required.');
    expect(markup).toContain('Open-map listings are free to search');
    expect(markup).toContain('Other restaurants');
    expect(markup).toContain('Cannot see your information');
    expect(markup).toContain('Private supplier links expire');
    expect(markup).toContain('Quote changes and decisions stay recorded');
    expect(markup).toContain('Repeat it later from Past purchases.');
    expect(markup).toContain('Save the order with its approval and price');
    expect(allPublicSource).not.toMatch(/SOC\s?2|ISO\s?27001|certified|compliant with/i);
  });

  test('ships conservative privacy and terms drafts with navigation home', () => {
    const legalLayout = source('src/components/public/LegalPageLayout.tsx');
    const privacy = `${source('src/app/privacy/page.tsx')}\n${legalLayout}`;
    const terms = `${source('src/app/terms/page.tsx')}\n${legalLayout}`;

    expect(privacy).toMatch(/service/i);
    expect(privacy).toMatch(/data (?:we )?collect/i);
    expect(privacy).toContain('href="/"');
    expect(terms).toMatch(/service/i);
    expect(terms).toMatch(/supplier quote/i);
    expect(terms).toContain('href="/"');
    expect(`${privacy}\n${terms}`).not.toMatch(/registered (?:office|address)|CIN|LLP|Private Limited/i);
  });

  test('uses the approved palette, local open-source fonts, and restrained motion', () => {
    const css = source('src/app/globals.css');
    const layout = source('src/app/layout.tsx');
    const packageJson = source('package.json');

    for (const color of ['#101817', '#172521', '#D8834F', '#285E4D', '#f6f7f5', '#ffffff', '#dce1db', '#515e56', '#285e4d', '#1c483b', '#e7f0eb']) {
      expect(css).toContain(color);
    }
    expect(packageJson).toContain('@fontsource-variable/manrope');
    expect(packageJson).toContain('@fontsource-variable/newsreader');
    expect(layout).toContain('@fontsource-variable/manrope');
    expect(layout).toContain('@fontsource-variable/newsreader');
    expect(css).toContain('font-variant-numeric: tabular-nums');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/transition[^;]*(?:300|500)ms/);
    expect(css).not.toContain('.public-eyebrow--light');
    expect(css).not.toContain('.section-heading');
  });

  test('provides an accessible ledger mark, skip link, metadata, and SVG icon', () => {
    const mark = source('src/components/brand/BrandMark.tsx');
    const allPublicSource = publicFiles.map(source).join('\n');
    const layout = source('src/app/layout.tsx');

    expect(mark).toContain('<svg');
    expect(mark).toContain('<title>');
    expect(mark).toContain('viewBox="0 0 34 40"');
    expect(mark).not.toMatch(/gradient|ChefHat|MessageCircle|speech/i);
    expect(allPublicSource).toContain('Skip to main content');
    expect(layout).toContain('metadataBase');
    expect(layout).toContain('openGraph');
    expect(source('src/app/icon.svg')).toContain('<svg');
  });


  test('keeps repeated wordmark symbols decorative without duplicate title ids', () => {
    const mark = source('src/components/brand/BrandMark.tsx');
    const wordmark = source('src/components/brand/Wordmark.tsx');
    const css = source('src/app/globals.css');
    const brandGuide = source('docs/brand/README.md');

    expect(mark).not.toContain('aria-labelledby=');
    expect(mark).toContain('decorative?: boolean');
    expect(mark).toContain('aria-hidden={decorative');
    expect(wordmark).toContain('<BrandMark decorative');
    expect(css).toMatch(
      /\.wordmark__name \{[^}]*font-family: var\(--font-brand\);[^}]*font-weight: 520;/,
    );
    expect(brandGuide).toContain('Newsreader Variable**: the QuotePlate wordmark only');
    expect(css).toContain('--font-display: var(--font-ui)');
    expect(brandGuide).not.toContain('Manrope lettering');
  });

  test('uses contrast-safe text tokens across light and dark public surfaces', () => {
    const css = source('src/app/globals.css');
    const copper = css.match(/--copper:\s*(#[\dA-F]{6})/i)?.[1];
    const copperText = css.match(/--copper-text:\s*(#[\dA-F]{6})/i)?.[1];
    const ink = css.match(/--ink:\s*(#[\dA-F]{6})/i)?.[1];
    const raisedInk = css.match(/--raised-ink:\s*(#[\dA-F]{6})/i)?.[1];
    const mutedLabel = css.match(/--workspace-muted:\s*(#[\dA-F]{6})/i)?.[1];
    expect(css).toContain('--ink-label: var(--workspace-muted)');

    expect(copper).toBeDefined();
    expect(copperText).toBeDefined();
    expect(ink).toBeDefined();
    expect(raisedInk).toBeDefined();
    expect(mutedLabel).toBeDefined();
    expect(contrastRatio(copper!, ink!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(copper!, raisedInk!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(copperText!, '#f6f7f5')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(copperText!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(mutedLabel!, '#f6f7f5')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(mutedLabel!, '#dce1db')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(mutedLabel!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/\.public-hero h1 em[\s\S]*?color: var\(--workspace-accent\)/);
    const token = (name: string) => {
      const value = css.match(new RegExp(`--workspace-${name}:\\s*(#[\\da-f]{6})`, 'i'))?.[1];
      expect(value).toBeDefined();
      return value!;
    };
    for (const surface of ['canvas', 'surface', 'selected']) {
      expect(contrastRatio(token('accent'), token(surface))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(token('muted'), token(surface))).toBeGreaterThanOrEqual(4.5);
    }
    for (const surface of ['accent', 'accent-hover']) {
      expect(contrastRatio(token('surface'), token(surface))).toBeGreaterThanOrEqual(4.5);
    }
    for (const surface of ['forest', 'raised-forest', 'selected-forest']) {
      for (const text of ['on-dark', 'muted-on-dark', 'accent-on-dark']) {
        expect(contrastRatio(token(text), token(surface))).toBeGreaterThanOrEqual(4.5);
      }
    }
    const publicScope = css.match(/\.public-site \{([^}]+)\}/)?.[1] ?? '';
    expect(publicScope).toContain('--stone: var(--workspace-canvas)');
    expect(publicScope).not.toMatch(/--copper(?:-text)?:/);
    expect(css).toContain('.brand-mark--duotone .brand-mark__request { color: var(--copper); }');
    expect(css).toMatch(/\.public-button \{[^}]*background: var\(--workspace-accent\);[^}]*box-shadow: none;/);
    expect(css).toMatch(/\.public-header \{[^}]*background: var\(--workspace-surface\);/);
    const appShell = source('src/app/(app)/app-shell.module.css');
    expect(appShell).toContain('--shell-stone: var(--workspace-canvas)');
    expect(appShell).toContain('--shell-paper: var(--workspace-surface)');
    expect(appShell).toContain('background: var(--workspace-accent)');
    const journey = source('src/components/public/journey-stage.module.css');
    expect(journey).toContain('color: var(--workspace-muted-on-dark)');
    expect(journey).toContain('outline: 2px solid var(--workspace-accent-on-dark)');
    expect(css).toMatch(/\.sample-label[\s\S]*?color: var\(--ink-label\)/);
    expect(css).toMatch(/\.decision-preview__summary > span \{[\s\S]*?color: var\(--ink-label\)/);
    expect(css).toMatch(/\.decision-preview__footer > span \{[\s\S]*?color: var\(--success\)/);
  });

  test('lets the root title template add the product name exactly once', () => {
    expect(source('src/app/product/page.tsx')).toContain("permanentRedirect('/#how-it-works')");
    expect(source('src/app/privacy/page.tsx')).toContain("title: 'Privacy'");
    expect(source('src/app/terms/page.tsx')).toContain("title: 'Terms'");
    expect(publicFiles.map(source).join('\n')).not.toMatch(/title: `(?:Product|Privacy|Terms) \|/);
  });

  test('keeps sample preview counts and launch units honest', () => {
    const landing = source('src/components/public/PublicLandingPage.tsx');
    const markup = renderToStaticMarkup(<PublicLandingPage />);
    const sample = source('src/data/sample-procurement.ts');

    expect(markup).toContain(`${restaurantSampleQuotes.length} supplier replies`);
    expect(markup).toContain(`${restaurantSampleRequest.items.length} items requested`);
    expect(landing).toContain("from '@/data/sample-procurement'");
    expect(landing).not.toMatch(/\b(?:3 supplier replies|8 items requested)\b/);
    expect(sample).toContain("name: 'Coriander', quantity: 3, unit: 'kg'");
    expect(sample).not.toContain("'bunch'");
  });

  test('uses a coherent seven-day restaurant order instead of decorative demo numbers', () => {
    expect(restaurantSampleRequest.context).toMatch(/Bengaluru/i);
    expect(restaurantSampleRequest.context).toMatch(/100 covers/i);
    expect(restaurantSampleRequest.cadence).toBe('7-day kitchen order');
    expect(restaurantSampleRequest.items).toHaveLength(8);

    const submittedQuote = restaurantSampleQuotes[0];
    const calculatedSubtotal = restaurantSampleRequest.items.reduce(
      (total: number, item: { quantity: number; sampleRatePaise: number }) => (
        total + item.quantity * item.sampleRatePaise
      ),
      0,
    );
    expect(calculatedSubtotal).toBe(submittedQuote.subtotalPaise);

    for (const quote of restaurantSampleQuotes) {
      expect(quote.totalPaise).toBe(quote.subtotalPaise + quote.gstPaise + quote.freightPaise);
      expect(quote.coverageCount).toBeLessThanOrEqual(restaurantSampleRequest.items.length);
    }
  });

  test('ships a static 1200 by 630 social card with complete sharing metadata', () => {
    const layout = source('src/app/layout.tsx');
    const siteUrl = source('src/config/site-url.ts');
    const socialCardPath = path.join(root, 'public/brand/social-card.png');

    expect(layout).toContain('twitter:');
    expect(`${layout}\n${siteUrl}`).toContain('"/brand/social-card.png"');
    expect(layout).toContain('siteUrls.socialImageUrl');
    expect(layout).not.toContain('NEXT_PUBLIC_SITE_URL');
    expect(layout).toContain('width: 1200');
    expect(layout).toContain('height: 630');
    expect(fs.existsSync(socialCardPath)).toBe(true);

    const socialCard = fs.readFileSync(socialCardPath);
    expect(socialCard.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(socialCard.readUInt32BE(16)).toBe(1200);
    expect(socialCard.readUInt32BE(20)).toBe(630);
  });

  test('keeps downloadable SVG assets synchronized with the canonical brand', () => {
    const brand = source('src/config/brand.ts');
    const mark = source('src/components/brand/BrandMark.tsx');
    const browserIcon = source('src/app/icon.svg');
    const canonicalPaths = [...mark.matchAll(/\n\s+d="([^"]+)"/g)].map((match) => match[1]);
    const productName = brand.match(/productName: '([^']+)'/)?.[1];
    const assets = [
      'public/brand/mark-ink.svg',
      'public/brand/mark-duotone.svg',
      'public/brand/wordmark-horizontal.svg',
      'public/brand/app-icon.svg',
    ].map(source);

    expect(canonicalPaths).toHaveLength(2);
    expect(productName).toBe('QuotePlate');
    for (const pathData of canonicalPaths) expect(browserIcon).toContain(`d="${pathData}"`);
    for (const asset of assets) {
      expect(asset).toContain('<svg');
      expect(asset).toContain('<title');
      expect(asset).toContain('<desc');
      expect(asset).not.toMatch(/gradient/i);
      for (const pathData of canonicalPaths) expect(asset).toContain(`d="${pathData}"`);
    }
    expect(assets[0]).toContain('#101817');
    expect(assets[1]).toContain('#D8834F');
    expect(assets[1]).toContain('#101817');
    expect(assets[2]).not.toMatch(/<text\b|font-family=/i);
    expect(assets[2].match(/<path\b/g)?.length).toBeGreaterThan(2);
    expect(assets[3]).toContain('#F5F1E8');
    expect(source('docs/brand/README.md')).toContain('Provisional identity');
    expect(source('docs/brand/README.md')).toContain('OFL-1.1');
  });
});
