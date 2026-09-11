import type { Metadata } from 'next';
import { brand } from '@/config/brand';
import { LegalPageLayout } from '@/components/public/LegalPageLayout';

export const metadata: Metadata = {
  title: 'Privacy',
  description: `Privacy notice for ${brand.productName}.`,
};

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title="Privacy notice"
      intro={`This notice explains how ${brand.companyName} handles personal and commercial information when you use the service.`}
    >
      <section>
        <h2>Data we collect</h2>
        <p>We collect the account and restaurant details entered during workspace setup, including names, work email addresses, phone numbers, restaurant addresses, and GSTIN when supplied. We also store the procurement records your team creates: menus, recipe snapshots, service plans, portion targets, stock counts, arrival confirmations, supplier contact details, requests, quotes, awards, item-level delivery checks, credit records, supplier acknowledgements and delivery responses, shared demand estimates, and a limited action history.</p>
        <p>If you choose Google to sign in, we use the basic identity information needed to verify your account. The product does not retain Google access tokens or refresh tokens.</p>
      </section>
      <section>
        <h2>How we use it</h2>
        <p>We use this information to operate and secure the service, provide the procurement workflow, respond to support requests, and diagnose service problems. We do not sell personal information or use procurement records for advertising.</p>
      </section>
      <section>
        <h2>Who can see it</h2>
        <p>Active members of your workspace can access its records according to their role. A quote link opens one supplier request. A separate supplier workspace link shows that supplier’s requests, awarded items, delivery records and only the ingredient estimates the restaurant explicitly shares. Recipes, portions, stock counts and other suppliers’ records are excluded. Infrastructure providers may process limited data to host the application and database. We may disclose information where the law requires it.</p>
      </section>
      <section>
        <h2>Retention and deletion</h2>
        <p>We keep active workspace records while the workspace is in use and retain limited security or commercial records where reasonably needed. Workspace users may request access, correction, export, or deletion through the support channel supplied during onboarding. Some request, quote, award, or audit records may need to be retained to preserve an accurate commercial history.</p>
      </section>
      <section>
        <h2>Security and changes</h2>
        <p>When you choose to check a supplier website, our server reads permitted public pages from that site to find published contact details. We show their source and check date for your review. This does not send your restaurant records to that website or independently verify the business.</p>
        <p>Shopping-list, supplier price-list and invoice photo reading runs in your browser. These helpers do not upload those photos; you review any suggested values before adding them to a saved record.</p>
        <p>Nearby supplier searches send the area you choose to Photon and a category and approximate coordinates to VK Maps’ public Overpass service (maps.mail.ru, hosted in Russia). Public map results may be cached to reduce repeat requests. Restaurant recipes, prices and purchasing records are not sent with these searches. Review public listings before adding a supplier.</p>
        <p>We use access controls, tenant isolation, expiring supplier links, and limited audit history. No online service can promise absolute security. We may update this draft as the service and hosting arrangements develop, and will present a revised date when we do.</p>
      </section>
    </LegalPageLayout>
  );
}
