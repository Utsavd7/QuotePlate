import type { Metadata } from 'next';
import { PublicSupplierShell } from '@/components/supplier-portal/PublicSupplierShell';

import { QuoteAccessClient } from './QuoteAccessClient';
import styles from './quote-access.module.css';

export const metadata: Metadata = {
  title: 'Supplier quote',
  description: 'Open a secure QuotePlate supplier request.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function SupplierQuoteAccessPage() {
  return (
    <PublicSupplierShell className={styles.shell} footer="The restaurant that sent this link controls the request and can issue a new link if needed.">
      <QuoteAccessClient />
    </PublicSupplierShell>
  );
}
