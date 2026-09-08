'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  SupplierQuoteForm,
  type PublicQuoteDto,
  type PublicQuoteRequestDto,
} from './SupplierQuoteForm';
import styles from './quote-access.module.css';

type AccessState = 'checking' | 'ready' | 'unavailable';

export function QuoteAccessClient() {
  const [state, setState] = useState<AccessState>('checking');
  const [request, setRequest] = useState<PublicQuoteRequestDto | null>(null);

  const loadRequest = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/public/quote', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    });
    const body = (await response.json().catch(() => null)) as
      | PublicQuoteRequestDto
      | null;
    if (!response.ok || !body || !Array.isArray(body.items)) {
      throw new Error('SUPPLIER_LINK_UNAVAILABLE');
    }
    setRequest(body);
    setState('ready');
  }, []);

  useEffect(() => {
    // A new supplier link can be opened in the same tab without a document
    // navigation: only its fragment differs. Reload to discard the old form
    // and run the normal private-grant exchange for the new token.
    function openChangedLink() {
      if (new URLSearchParams(window.location.hash.slice(1)).has('token')) {
        window.location.reload();
      }
    }
    window.addEventListener('hashchange', openChangedLink);
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('token') ?? '';
    window.history.replaceState(null, '', '/quote');

    const controller = new AbortController();
    void (async () => {
      if (token) {
        const access = await fetch('/api/public/quote/access', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!access.ok) throw new Error('SUPPLIER_LINK_UNAVAILABLE');
      }
      await loadRequest(controller.signal);
    })()
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState('unavailable');
        }
      });

    return () => {
      window.removeEventListener('hashchange', openChangedLink);
      controller.abort();
    };
  }, [loadRequest]);

  async function refresh() {
    await loadRequest();
  }

  function saved(quote: PublicQuoteDto) {
    setRequest((current) =>
      current ? { ...current, latestQuote: quote } : current,
    );
  }

  if (request && state === 'ready') {
    return (
      <section className={`${styles.card} ${styles.formCard}`}>
        <div className={styles.rule} aria-hidden="true" />
        <SupplierQuoteForm
          request={request}
          onSaved={saved}
          onRefresh={refresh}
        />
      </section>
    );
  }

  return (
    <section className={styles.card} aria-labelledby="quote-access-heading">
      <div className={styles.rule} aria-hidden="true" />
      <p className={styles.eyebrow}>Supplier request</p>
      <h1 id="quote-access-heading">Send your prices.</h1>
      <p className={styles.intro}>
        No account needed. Enter your prices, check the total, then send your quote.
      </p>
      <p className={styles.intro}>
        This link opens only this restaurant request. The restaurant can replace or close it.
      </p>
      <div className={styles.status} role="status" aria-live="polite">
        <span className={styles.indicator} aria-hidden="true" />
        <div>
          <strong>
            {state === 'checking'
              ? 'Checking your supplier link'
              : 'This link is unavailable'}
          </strong>
          <p>
            {state === 'checking'
              ? 'This takes only a moment.'
              : 'Ask the restaurant to send you a new supplier link.'}
          </p>
        </div>
      </div>
      <div className={styles.assurance}>
        <span>Private link</span>
        <span>No supplier fee</span>
        <span>Prices in ₹ with GST</span>
      </div>
    </section>
  );
}
