import Link from 'next/link';
import { Wordmark } from '@/components/brand/Wordmark';

type PublicHeaderProps = {
  home?: boolean;
  sticky?: boolean;
};

export function PublicHeader({ home = false, sticky = false }: PublicHeaderProps) {
  return (
    <header className={`public-header${sticky ? ' public-header--sticky' : ''}`}>
      <div className="public-container public-header__inner">
        <Link className="public-brand-link" href="/" aria-label="Home">
          <Wordmark />
        </Link>
        <nav aria-label="Primary navigation" className="public-nav">
          <Link href={home ? '#how-it-works' : '/#how-it-works'}>How it works</Link>
          {/* Native anchors re-scroll when the same hash is already active. */}
          <a href={home ? '#security' : '/#security'}>Security</a>
        </nav>
        <div className="public-header__actions">
          <Link className="public-text-action" href="/signin">Sign in</Link>
          <Link className="public-button public-button--small" href="/start">Get started</Link>
        </div>
      </div>
    </header>
  );
}
