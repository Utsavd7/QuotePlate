import Link from 'next/link';
import {
  restaurantSampleQuotes,
  restaurantSampleRequest,
} from '@/data/sample-procurement';
import { PublicHeader } from './PublicHeader';
import { PublicFooter } from './PublicFooter';
import { JourneyIcon } from './JourneyIcon';
import { LandingJourney } from './LandingJourney';
import { ProductDemoVideo } from './ProductDemoVideo';

const proofPoints = [
  [`${restaurantSampleQuotes.length} supplier replies`, 'Labelled sample replies, not customer activity.'],
  [`${restaurantSampleRequest.items.length} items requested`, `Requested in sample ${restaurantSampleRequest.id}; coverage stays visible supplier by supplier.`],
  ['1 decision waiting', 'One sample decision is waiting; the product never chooses automatically.'],
  ['Human approval required', 'Product rule: the restaurant records the final choice.'],
];

const restaurantBenefits = [
  {
    icon: 'history' as const,
    title: 'Reuse each buying cycle',
    detail: 'Repeat a saved daily plan with fresh stock counts, or turn a completed purchase into a new draft. Suppliers can review matching historical rates before submitting a fresh quote.',
  },
  {
    icon: 'receipt' as const,
    title: 'Check the complete cost',
    detail: 'Compare item prices, GST, freight and delivery. After receiving, see billed cost per accepted unit where billed inputs are recorded, with tax assumptions and exclusions shown.',
  },
  {
    icon: 'approve' as const,
    title: 'Keep delivery history',
    detail: 'Record received, rejected and billed quantities for each awarded item. Keep partial deliveries and replacement quantities visible.',
  },
  {
    icon: 'list' as const,
    title: 'Know what service still needs',
    detail: 'Set portions and recipe batch servings. Check usable stock and confirmed arrivals, account for yield, and create a purchase draft for the shortage.',
  },
  {
    icon: 'price' as const,
    title: 'Keep credits from getting lost',
    detail: 'Open one follow-up list for unchecked deliveries, remaining items and credits still owed. Go straight to the purchase and update the record when it is resolved.',
  },
  {
    icon: 'suppliers' as const,
    title: 'Choose with delivery evidence',
    detail: 'Review actual fulfilment, rejection and on-time delivery records. Established delivery evidence helps rank suppliers with equal capability matches.',
  },
];

export function PublicLandingPage() {
  return (
    <div className="public-site">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <PublicHeader home sticky />
      <main id="main-content">
        <section className="public-hero public-container">
          <div className="public-hero__copy public-reveal">
            <p className="public-eyebrow">Restaurant buying, made clear</p>
            <h1>
              Send one list.<br />
              Compare every supplier.<br />
              <em>Choose the best deal.</em>
            </h1>
            <p className="public-hero__lede">
              Plan what today’s service needs, compare supplier quotes, and check what actually
              arrives. Keep ingredient shortages, delivery problems and outstanding credits in one workspace.
            </p>
            <div className="public-hero__actions">
              <a className="public-button" href="#watch-demo">Watch the demo <span aria-hidden="true">↓</span></a>
              <Link className="public-inline-link" href="/start">Start free pilot <span aria-hidden="true">↗</span></Link>
            </div>
            <p className="public-hero__note">No supplier commission. No card required.</p>
          </div>
          <div className="hero-route" role="group" aria-label="QuotePlate buying journey">
            <div>
              <JourneyIcon name="receipt" />
              <span>Menu</span>
            </div>
            <span className="hero-route__connector" aria-hidden="true">→</span>
            <div>
              <JourneyIcon name="list" />
              <span>Request</span>
            </div>
            <span className="hero-route__connector" aria-hidden="true">→</span>
            <div>
              <JourneyIcon name="price" />
              <span>Supplier prices</span>
            </div>
            <span className="hero-route__connector" aria-hidden="true">→</span>
            <div>
              <JourneyIcon name="approve" />
              <span>Your choice</span>
            </div>
          </div>
        </section>

        <section className="proof-band" aria-label="Sample decision facts">
          <div className="public-container proof-band__grid">
            {proofPoints.map(([title, detail]) => (
              <div key={title}><strong>{title}</strong><span>{detail}</span></div>
            ))}
          </div>
        </section>

        <ProductDemoVideo />

        <LandingJourney />

        <section className="restaurant-benefits" id="benefits" aria-labelledby="restaurant-benefits-title">
          <div className="public-container">
            <header className="restaurant-benefits__header">
              <p className="public-eyebrow">Why restaurants keep using it</p>
              <h2 id="restaurant-benefits-title">Useful for every purchase, not just the first one.</h2>
              <p>Connect planned portions to purchases, accepted deliveries and the money still owed.</p>
            </header>
            <div className="restaurant-benefits__grid">
              {restaurantBenefits.map((benefit) => (
                <article className="restaurant-benefit" key={benefit.title}>
                  <JourneyIcon name={benefit.icon} />
                  <h3>{benefit.title}</h3>
                  <p>{benefit.detail}</p>
                </article>
              ))}
            </div>
            <p className="public-hero__note">Planning example: 10 kg usable ingredients needed − 4 kg usable stock = 6 kg short. At 80% yield, prepare a request for 7.5 kg. Your team confirms the inputs and reviews the draft.</p>
          </div>
        </section>

        <section className="supplier-benefits public-container" id="for-suppliers" aria-labelledby="supplier-benefits-title">
          <header>
            <p className="public-eyebrow">A clearer relationship, on both sides</p>
            <h2 id="supplier-benefits-title">Good for your kitchen. Useful for your suppliers.</h2>
            <p>Find nearby food businesses inside your workspace, review their details and invite suitable suppliers. Open-map listings are free to search. Invite a supplier to declare service PIN codes, wholesale status, minimum order and ordering times; the confirmation date stays visible.</p>
          </header>
          <ol className="supplier-benefits__steps">
            <li><span aria-hidden="true">01</span><div><h3>Know where the order stands</h3><p>Suppliers use a private link to see their request status, confirm awarded quantities or ask for a change. No supplier account required.</p></div></li>
            <li><span aria-hidden="true">02</span><div><h3>Agree on what arrived</h3><p>Share delivery checks and recorded credits. Suppliers can agree or dispute the record with a delivery-note or invoice reference; changed checks need a fresh response.</p></div></li>
            <li><span aria-hidden="true">03</span><div><h3>Give suppliers time to prepare</h3><p>Choose which upcoming ingredient quantities to share. Suppliers see estimates, while your recipes, portions and stock counts stay private. You still confirm the order separately.</p></div></li>
            <li><span aria-hidden="true">04</span><div><h3>Make your delivery terms clear</h3><p>Suppliers update their service areas and ordering terms through their private workspace. These are supplier declarations, not independent verification or a guarantee of stock.</p></div></li>
          </ol>
        </section>

        <section className="privacy-story" id="security" aria-labelledby="privacy-story-title">
          <div className="public-container privacy-story__grid">
            <header>
              <JourneyIcon name="privacy" />
              <p className="public-eyebrow">Clear boundaries</p>
              <h2 id="privacy-story-title">Your recipes stay private with your restaurant.</h2>
              <p>
                Your recipes, menus, supplier prices, and purchase records stay private to your
                restaurant. Other restaurants cannot see them. Suppliers see their own requests and
                orders, delivery records and the ingredient estimates you choose to share.
              </p>
            </header>
            <div>
              <dl className="privacy-map">
                <div>
                  <dt>Your restaurant team</dt>
                  <dd>Menus, recipes, service plans, stock counts, quotes, delivery checks and credits</dd>
                </div>
                <div>
                  <dt>Each supplier</dt>
                  <dd>Their requests, awarded items, delivery checks and explicitly shared ingredient estimates</dd>
                </div>
                <div>
                  <dt>Other restaurants</dt>
                  <dd>Cannot see your information</dd>
                </div>
              </dl>
              <p className="privacy-story__note">
                Private supplier links expire. Quote changes and decisions stay recorded for your
                restaurant team.
              </p>
            </div>
          </div>
        </section>

        <section className="public-cta public-container" aria-labelledby="pilot-title">
          <div>
            <p className="public-eyebrow">Start with one purchase</p>
            <h2 id="pilot-title">Try QuotePlate with one real purchase.</h2>
          </div>
          <div>
            <p>
              Start with an approved recipe and today’s portions, or one ingredient request and
              your current suppliers. Follow through to delivery and credits. No payment card needed.
            </p>
            <div className="public-hero__actions">
              <Link className="public-button" href="/start">Start free pilot <span aria-hidden="true">→</span></Link>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
