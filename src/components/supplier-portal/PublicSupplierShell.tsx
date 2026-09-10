import Link from 'next/link';
import type { ReactNode } from 'react';
import { Wordmark } from '@/components/brand/Wordmark';
import styles from './public-supplier-shell.module.css';

export function PublicSupplierShell({ children, footer, className }: {
  children: ReactNode;
  footer: ReactNode;
  className?: string;
}) {
  return <div className={styles.frame}>
    <div className={styles.container}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="QuotePlate home"><Wordmark /></Link>
      </header>
      <main className={className}>{children}</main>
      <footer className={styles.footer}><p>{footer}</p></footer>
    </div>
  </div>;
}
