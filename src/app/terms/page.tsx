import type { Metadata } from 'next';
import { brand } from '@/config/brand';
import { LegalPageLayout } from '@/components/public/LegalPageLayout';

export const metadata: Metadata = {
  title: 'Terms',
  description: `Service terms for ${brand.productName}.`,
};

export default function TermsPage() {
  return (
    <LegalPageLayout
      title="Service terms"
      intro={`These draft terms govern access to the ${brand.productName} service. Any additional written onboarding conditions will be stated separately.`}
    >
      <section>
        <h2>The service</h2>
        <p>The service helps restaurant teams prepare procurement requests, collect supplier quote submissions, compare commercial facts, record award decisions, plan service quantities, check deliveries and track entered credit settlements. Suppliers can acknowledge orders and respond to delivery records through a separate private workspace. Restaurants may explicitly share upcoming ingredient estimates. Features may change as the product is tested. We may limit, suspend, or end access with reasonable notice, or sooner where security or misuse requires it.</p>
      </section>
      <section>
        <h2>Accounts and access</h2>
        <p>You must provide accurate account information, protect your account credentials and invitation links, and promptly tell the service operator about suspected unauthorized access. Workspace owners are responsible for member access and for the suppliers to whom they distribute request links.</p>
      </section>
      <section>
        <h2>Procurement decisions</h2>
        <p>Shared demand is an estimate, not an order, reservation or promise to purchase. Supplier responses do not alter accepted awards or transfer money. Nearby search results come from public open-map data, may be incomplete or outdated, and do not establish wholesale capability or verification. Free public search services have usage limits and may be unavailable. Planning results depend on the recipe, stock, yield and arrival information entered by your team. Credit settlements are recorded entries, not verified bank payments. The service organises information; it does not make purchasing decisions or guarantee price, quality, availability, delivery, tax treatment, or supplier performance. Your restaurant and its suppliers remain responsible for checking every request, supplier quote, award, purchase order, invoice, and applicable tax obligation.</p>
      </section>
      <section>
        <h2>Your information</h2>
        <p>You retain responsibility for the information you enter and must have the right to use and share it. You permit us to process that information only as needed to operate, secure, support, and improve the service. Do not upload unlawful material, malicious code, or unnecessary sensitive personal information.</p>
      </section>
      <section>
        <h2>Availability and responsibility</h2>
        <p>The service is provided for evaluation and may experience interruptions or data loss. Keep any independent records your business requires. To the extent permitted by law, the service operator is not responsible for indirect or consequential loss arising from use of the service or a commercial decision made through it.</p>
      </section>
      <section>
        <h2>Ending participation</h2>
        <p>You may stop using the service and request workspace closure through the support channel supplied during onboarding. Terms that logically continue after closure, including responsibility for prior activity, permitted record retention, and limits of responsibility, will continue.</p>
      </section>
    </LegalPageLayout>
  );
}
