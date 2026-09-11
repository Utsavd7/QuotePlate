import { ArrowUpRight, ChevronDown, MapPin, Plus, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { PROCUREMENT_CATEGORIES } from '@/lib/domain/procurement-categories';
import { buildSupplierDiscoveryLinks, type SupplierDiscoveryInput } from '@/lib/suppliers/discovery';
import { supplierSearchEngineId } from '@/lib/suppliers/google-search-element';

import { NearbySupplierSearch } from './NearbySupplierSearch';
import type { NearbyPrefill } from '@/lib/suppliers/nearby-types';
import type { ExistingSupplierContact } from '@/lib/suppliers/contact-list';

import { GoogleSupplierSearch } from './GoogleSupplierSearch';
import styles from './supplier-discovery.module.css';

export function SupplierDiscovery({ onAddSupplier, existingContacts }: { onAddSupplier: (prefill?: NearbyPrefill) => void; existingContacts?: readonly ExistingSupplierContact[] }) {
  const searchEngineId = supplierSearchEngineId(process.env.NEXT_PUBLIC_SUPPLIER_SEARCH_ENGINE_ID);
  const [input, setInput] = useState<SupplierDiscoveryInput>({
    ingredient: '', locality: '', city: '', state: '', pin: '',
  });
  const [results, setResults] = useState<ReturnType<typeof buildSupplierDiscoveryLinks>>(null);
  const [error, setError] = useState('');
  const [searchAttempt, setSearchAttempt] = useState(0);

  function update(field: keyof SupplierDiscoveryInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
    setResults(null);
    setError('');
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = buildSupplierDiscoveryLinks(input);
    setResults(next);
    if (next) setSearchAttempt((current) => current + 1);
    setError(next ? '' : 'Enter an ingredient or category and city. Use a valid six-digit PIN if provided, and keep the search brief.');
  }

  return (
    <>
    <NearbySupplierSearch onAddSupplier={onAddSupplier} existingContacts={existingContacts} />
    <details className={styles.panel}>
      <summary className={styles.summary}>
        <MapPin aria-hidden="true" />
        <span><strong>Search other websites</strong><span>Search your area, then add suppliers you have reviewed.</span></span>
        <ChevronDown className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.content}>
        <p className={styles.help} id="discovery-help">
          {searchEngineId
            ? 'Choose what you need and where. Searching sends these terms to Google to show combined results here, including ads. Google Maps opens separately.'
            : 'Choose what you need and where. Searches open on external websites; results are not imported into QuotePlate.'}
        </p>
        <form onSubmit={search} aria-label="Find nearby suppliers" aria-describedby="discovery-help">
          <div className={styles.fields}>
            <label className={styles.ingredient}>Ingredient or category
              <input required maxLength={60} list="discovery-categories" placeholder="e.g. Paneer or dairy" value={input.ingredient} onChange={(event) => update('ingredient', event.target.value)} />
              <datalist id="discovery-categories">
                {Object.values(PROCUREMENT_CATEGORIES).map((category) => <option key={category} value={category} />)}
              </datalist>
            </label>
            <label>Locality <span>(optional)</span>
              <input maxLength={60} placeholder="e.g. Andheri East" value={input.locality} onChange={(event) => update('locality', event.target.value)} />
            </label>
            <label>City
              <input required maxLength={40} placeholder="e.g. Mumbai" value={input.city} onChange={(event) => update('city', event.target.value)} />
            </label>
            <label>State <span>(optional)</span>
              <input maxLength={40} placeholder="e.g. Maharashtra" value={input.state} onChange={(event) => update('state', event.target.value)} />
            </label>
            <label>PIN code <span>(optional)</span>
              <input inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} title="Enter a six-digit Indian PIN code" placeholder="e.g. 400069" value={input.pin} onChange={(event) => update('pin', event.target.value)} />
            </label>
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.searchButton} type="submit"><Search aria-hidden="true" /> {searchEngineId ? 'Find suppliers' : 'Choose a search website'}</button>
        </form>
        {results && searchEngineId && <GoogleSupplierSearch key={searchAttempt} engineId={searchEngineId} query={results.query} />}
        {results && <section className={styles.results} aria-label="Supplier search websites">
          {!searchEngineId && <p className={styles.help}>Combined search is not available yet. Search individual websites below.</p>}
          <p className={styles.query} role="status">Search for: <strong>{results.query}</strong></p>
          <div className={styles.sources}>
            {results.links.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
              <span className={styles.sourceName}>{source.name}<ArrowUpRight aria-hidden="true" /></span>
              <span>{source.description}</span>
              <small>{source.domain ? 'Search this website via Google · new tab' : 'Open search · new tab'}</small>
            </a>)}
          </div>
        </section>}
        <p className={styles.help}>
          Area matches are approximate. Confirm delivery coverage and supplier details yourself. QuotePlate charges nothing for these searches; external websites may require sign-in or offer paid services.
        </p>
        <div className={styles.nextStep}>
          <p><strong>Found a suitable supplier?</strong><span>Review their details, then add them here. Applications and approvals stay in your existing workflow.</span></p>
          <button type="button" onClick={() => onAddSupplier()}><Plus aria-hidden="true" /> Add reviewed supplier</button>
        </div>
      </div>
    </details>
    </>
  );
}
