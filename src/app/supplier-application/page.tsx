import type { Metadata } from 'next';
import { PublicSupplierShell } from '@/components/supplier-portal/PublicSupplierShell';

import { SupplierApplicationAccess } from './SupplierApplicationAccess';
import styles from './supplier-application.module.css';

export const metadata: Metadata = {
  title: 'Supplier application',
  description: 'Apply to supply a restaurant through QuotePlate.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function SupplierApplicationPage() {
  return (
    <PublicSupplierShell className={styles.shell} footer="Your details are shared only with the restaurant that sent this link.">
        <div className={styles.paper}>
          <div className={styles.rule} aria-hidden="true" />
          <SupplierApplicationAccess />
        </div>
    </PublicSupplierShell>
  );
}
