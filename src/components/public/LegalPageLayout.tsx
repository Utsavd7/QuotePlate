import Link from 'next/link';
import type { ReactNode } from 'react';
import { brand } from '@/config/brand';
import { PublicHeader } from './PublicHeader';
import { PublicFooter } from './PublicFooter';

type LegalPageLayoutProps = {
  title: string;
  intro: string;
  children: ReactNode;
};

export function LegalPageLayout({ title, intro, children }: LegalPageLayoutProps) {
  return (
    <div className="public-site">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <PublicHeader sticky />
      <main className="legal-page public-container" id="main-content">
        <Link className="legal-page__back" href="/">← Back to {brand.productName}</Link>
        <header>
          <p className="public-eyebrow">Service information · Last updated 11 September 2026</p>
          <h1>{title}</h1>
          <p>{intro}</p>
        </header>
        <div className="legal-copy">{children}</div>
      </main>
      <PublicFooter />
    </div>
  );
}
