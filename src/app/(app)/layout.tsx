'use client';

import {
  BarChart3,
  BookOpen,
  ClipboardList,
  LayoutDashboard,
  Menu,
  Plus,
  Settings,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { DEMO_TENANT_ID } from '@/lib/demo/identity';
import { Wordmark } from '@/components/brand/Wordmark';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { PageSkeleton } from '@/components/Skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { TutorialGuide } from '@/components/tutorial/TutorialGuide';
import { WorkspaceProvider } from '@/components/WorkspaceContext';
import { createSignInRedirect } from '@/lib/auth/callback-url';
import {
  prefetchWorkspace,
  setWorkspacePrefetchScope,
  WORKSPACE_FIRST_REQUESTS,
} from '@/lib/client/workspace-prefetch';
import type { TutorialStateDto } from '@/lib/tutorial/tutorial-state';

import styles from './app-shell.module.css';

type RestaurantAccount = {
  name: string;
  addressLine: string;
  city: string;
  state: string;
  pin: string;
};

const NAV = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Today', paths: ['/dashboard', '/service-planning'], sections: [{ href: '/dashboard', label: 'Overview' }, { href: '/service-planning', label: 'Plan meals' }] },
  { href: '/procurement', icon: ClipboardList, label: 'Purchases', paths: ['/procurement', '/history'], sections: [{ href: '/procurement', label: 'Current purchases' }, { href: '/history', label: 'Past purchases' }] },
  { href: '/suppliers', icon: Users, label: 'Suppliers', paths: ['/suppliers', '/supplier-collaboration', '/supplier-performance'], sections: [{ href: '/suppliers', label: 'Your suppliers' }, { href: '/supplier-collaboration', label: 'Orders & messages' }, { href: '/supplier-performance', label: 'Delivery record' }] },
  { href: '/menus', icon: BookOpen, label: 'Menu', paths: ['/menus'], sections: [] },
  { href: '/insights', icon: BarChart3, label: 'Reports', paths: ['/insights'], sections: [] },
] as const;

function matchesPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SectionNavigation({ pathname }: { pathname: string }) {
  const group = NAV.find(item => item.paths.some(path => matchesPath(pathname, path)));
  if (!group?.sections.length) return null;
  return <nav className={styles.sectionNav} aria-label={`${group.label} sections`}>
    {group.sections.map(item => <Link key={item.href} href={item.href}
      aria-current={matchesPath(pathname, item.href) ? 'page' : undefined}>
      {item.label}
    </Link>)}
  </nav>;
}

function SidebarContent({
  account,
  pathname,
  onNav,
}: {
  account: RestaurantAccount;
  pathname: string;
  onNav: () => void;
}) {
  return (
    <div className={styles.sidebarContent}>
      <Link
        aria-label="QuotePlate home"
        className={styles.brand}
        href="/dashboard"
        onClick={onNav}
        onFocus={() => void prefetchWorkspace(WORKSPACE_FIRST_REQUESTS['/dashboard'])}
        onPointerEnter={() => void prefetchWorkspace(WORKSPACE_FIRST_REQUESTS['/dashboard'])}
      >
        <Wordmark />
      </Link>

      <Link className={styles.newRequest} href="/procurement/new" onClick={onNav}>
        <Plus aria-hidden="true" /> New purchase
      </Link>

      <nav className={styles.nav} aria-label="Workspace navigation">
        {NAV.map((item) => {
          const active = item.paths.some(path => matchesPath(pathname, path));
          return (
            <Link
              aria-current={active ? 'page' : undefined}
              className={active ? styles.navActive : styles.navLink}
              href={item.href}
              key={item.href}
              onClick={onNav}
              onFocus={() => void prefetchWorkspace(WORKSPACE_FIRST_REQUESTS[item.href])}
              onPointerEnter={() => void prefetchWorkspace(WORKSPACE_FIRST_REQUESTS[item.href])}
            >
              <item.icon aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <Link href="/settings" onClick={onNav} className={pathname === '/settings' ? styles.navActive : styles.navLink} aria-current={pathname === '/settings' ? 'page' : undefined}>
        <Settings aria-hidden="true" /> Settings
      </Link>
      <details className={styles.privacy}>
        <summary>Your information is private</summary>
        <p>Other restaurants cannot see your records. Suppliers see only their requests, orders, delivery checks and estimates you choose to share. Your recipes and other suppliers’ prices stay private.</p>
      </details>

      <div className={styles.account}>
        <span className={styles.accountInitial}>{account.name.charAt(0).toUpperCase()}</span>
        <span className={styles.accountName}>
          <strong>{account.name}</strong>
          <small>{[account.city, account.state].filter(Boolean).join(', ') || account.addressLine}</small>
        </span>
      </div>
      <SignOutButton className={styles.signOut} />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [account, setAccount] = useState<RestaurantAccount | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [tutorial, setTutorial] = useState<TutorialStateDto | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [accountUnavailable, setAccountUnavailable] = useState(false);
  const [accountRetry, setAccountRetry] = useState(0);
  const closeNavigation = useRef<HTMLButtonElement>(null);
  const openNavigation = useRef<HTMLButtonElement>(null);
  const mobileNavigation = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setWorkspacePrefetchScope(null);
    const redirectToSignIn = () => {
      const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      router.replace(createSignInRedirect(currentLocation));
    };

    fetch('/api/account', { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 401) {
          redirectToSignIn();
          return null;
        }
        if (!response.ok) throw new Error('Account request failed');
        const data = (await response.json()) as {
          account?: RestaurantAccount;
          tutorial?: TutorialStateDto;
          workspaceId?: string;
        };
        if (!data.account || !data.workspaceId) throw new Error('Account response was incomplete');
        return {
          account: data.account,
          tutorial: data.tutorial,
          workspaceId: data.workspaceId,
        };
      })
      .then((loaded) => {
        if (!active || !loaded) return;
        setWorkspacePrefetchScope(loaded.workspaceId);
        setWorkspaceId(loaded.workspaceId);
        setAccount(loaded.account!);
        setTutorial(loaded.tutorial ?? null);
        setAccountUnavailable(false);
        setReady(true);
      })
      .catch(() => {
        if (!active) return;
        setReady(false);
        setAccountUnavailable(true);
      });

    return () => {
      active = false;
      setWorkspaceId('');
      setWorkspacePrefetchScope(null);
    };
  }, [accountRetry, router]);

  useEffect(() => {
    if (!mobileOpen) return;
    const opener = openNavigation.current;
    closeNavigation.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleNavigationKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = mobileNavigation.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleNavigationKey);
    return () => {
      window.removeEventListener('keydown', handleNavigationKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [mobileOpen]);

  if (accountUnavailable) {
    return (
      <main className={styles.connectionPage}>
        <section className={styles.connectionCard} role="alert">
          <p>Workspace connection</p>
          <h1>Workspace is temporarily unavailable</h1>
          <span>Your session is still active. We could not load the restaurant account right now.</span>
          <button
            onClick={() => {
              setAccountUnavailable(false);
              setAccountRetry((value) => value + 1);
            }}
            type="button"
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (!ready || !account || !workspaceId) {
    return <div className={styles.loadingPage}><PageSkeleton /></div>;
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.desktopSidebar} inert={mobileOpen ? true : undefined}>
        <SidebarContent account={account} pathname={pathname} onNav={() => {}} />
      </aside>

      {mobileOpen && (
        <div className={styles.mobileOverlay}>
          <button className={styles.mobileScrim} aria-label="Close navigation" onClick={() => setMobileOpen(false)} tabIndex={-1} type="button" />
          <div aria-label="Workspace navigation" aria-modal="true" className={styles.mobileSidebar} ref={mobileNavigation} role="dialog">
            <aside>
              <SidebarContent account={account} pathname={pathname} onNav={() => setMobileOpen(false)} />
              <button
                aria-label="Close navigation"
                className={styles.mobileClose}
                onClick={() => setMobileOpen(false)}
                ref={closeNavigation}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </aside>
          </div>
        </div>
      )}

      <div className={styles.workspace} inert={mobileOpen ? true : undefined}>
        <header className={styles.mobileHeader}>
          <button aria-label="Open navigation" onClick={() => setMobileOpen(true)} ref={openNavigation} type="button">
            <Menu aria-hidden="true" />
          </button>
          <Link href="/dashboard" aria-label="QuotePlate home"><Wordmark /></Link>
          <span>{account.name}</span>
        </header>

        <ErrorBoundary>
          <div className={styles.content}>
            <WorkspaceProvider workspaceId={workspaceId}>
              {workspaceId === DEMO_TENANT_ID && (
                <aside className={styles.demoBanner} aria-label="Demo workspace notice">
                  <strong>Internal demo · fictional restaurant records</strong>
                  <span>This is a working test account. Changes are saved in this demo only. Do not enter real customer or supplier information.</span>
                </aside>
              )}
              <SectionNavigation pathname={pathname} />
              {children}
            </WorkspaceProvider>
          </div>
        </ErrorBoundary>

        <TutorialGuide initialTutorial={tutorial ?? undefined} />

        <footer className={styles.footer}>
          <span>QuotePlate</span>
          <span>Every quote, accountable.</span>
        </footer>
      </div>
    </div>
  );
}
