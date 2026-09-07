import { renderToStaticMarkup } from 'react-dom/server';

import { SupplierDiscovery } from '@/components/suppliers/SupplierDiscovery';
import { GoogleSupplierSearch } from '@/components/suppliers/GoogleSupplierSearch';

describe('supplier discovery entry point', () => {
  const originalEngineId = process.env.NEXT_PUBLIC_SUPPLIER_SEARCH_ENGINE_ID;
  afterEach(() => {
    if (originalEngineId === undefined) delete process.env.NEXT_PUBLIC_SUPPLIER_SEARCH_ENGINE_ID;
    else process.env.NEXT_PUBLIC_SUPPLIER_SEARCH_ENGINE_ID = originalEngineId;
  });

  it('offers a collapsed, labelled search and manual add flow without preloading external results', () => {
    delete process.env.NEXT_PUBLIC_SUPPLIER_SEARCH_ENGINE_ID;
    const html = renderToStaticMarkup(<SupplierDiscovery onAddSupplier={() => undefined} />);
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
    expect(html).toContain('Find nearby suppliers');
    expect(html).toContain('Ingredient or category');
    expect(html).toContain('Locality');
    expect(html).toContain('PIN code');
    expect(html).toContain('results are not imported into QuotePlate');
    expect(html).toContain('Area matches are approximate');
    expect(html).toContain('Add reviewed supplier');
    expect(html).toContain('https://www.openstreetmap.org/copyright');
    expect(html.slice(html.indexOf('<details'))).not.toContain('href=');
    expect(html).not.toContain('https://www.google.com/search');
    expect(html).not.toContain('https://www.justdial.com');
    expect(html).not.toContain('<iframe');
  });

  it('explains Google search and ads before submission without loading its widget', () => {
    process.env.NEXT_PUBLIC_SUPPLIER_SEARCH_ENGINE_ID = 'configured_engine';
    const html = renderToStaticMarkup(<SupplierDiscovery onAddSupplier={() => undefined} />);
    expect(html).toContain('Searching sends these terms to Google');
    expect(html).toContain('including ads');
    expect(html).toContain('Find suppliers');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('cse.google.com');
  });

  it('isolates the Google widget and identifies its ads for assistive technology', () => {
    const html = renderToStaticMarkup(<GoogleSupplierSearch engineId="configured_engine" query="Paneer Mumbai" />);
    expect(html).toContain('title="Google supplier search results and ads"');
    expect(html).toContain('sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"');
    expect(html).not.toContain('allow-same-origin');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });
});
