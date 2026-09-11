import Link from 'next/link';
import { brand } from '@/config/brand';
import { Wordmark } from '@/components/brand/Wordmark';

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-container public-footer__main">
        <div>
          <Link className="public-brand-link" href="/" aria-label="Home">
            <Wordmark inverse />
          </Link>
          <p>{brand.tagline}</p>
        </div>
        <nav aria-label="Footer navigation" className="public-footer__links">
          <Link href="/#how-it-works">How it works</Link>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Native anchors re-scroll when the same hash is already active. */}
          <a href="/#security">Security</a>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/signin">Sign in</Link>
          <Link href="/start">Get started</Link>
        </nav>
      </div>
      <div className="public-container public-footer__legal">
        <span>© {new Date().getFullYear()} {brand.companyName}</span>
        <span>Built for clearer restaurant buying in India.</span>
      </div>
    </footer>
  );
}
