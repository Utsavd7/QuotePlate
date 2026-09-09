import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
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
  [`${restaurantSampleQuotes.length} supplier replies`, 'Sample replies, not customer activity.'],
  [`${restaurantSampleRequest.items.length} items requested`, `Sample ${restaurantSampleRequest.id}; see which items each supplier quoted.`],
  ['1 decision waiting', 'Sample choice pending. Your restaurant decides.'],
  ['Your approval required', 'You check the prices and confirm the order.'],
];

const restaurantBenefits = [
  {
    icon: 'history' as const,
    title: 'Repeat a purchase',
    detail: 'Repeat a meal plan with fresh stock counts, or start a new draft from a past purchase. Suppliers can check previous rates before quoting again.',
  },
  {
    icon: 'receipt' as const,
    title: 'See the full cost',
    detail: 'Compare prices, GST, delivery charges and dates. Recorded billed quantities and rates show cost per accepted unit, with tax assumptions and exclusions.',
  },
  {
    icon: 'approve' as const,
    title: 'Keep delivery records',
    detail: 'Record received, rejected and billed quantities against the order. Keep missing items and replacements visible.',
  },
  {
    icon: 'list' as const,
    title: 'Plan meals and stock',
    detail: 'Choose meals and portions, then check stock and missing ingredients. Enter recipe batch servings, usable stock, yields and confirmed arrivals before creating a purchase draft.',
  },
  {
    icon: 'price' as const,
    title: 'Follow up credits',
    detail: 'See deliveries to check, missing items and credits still owed. Open the purchase to update the record.',
  },
  {
    icon: 'suppliers' as const,
    title: 'Review supplier deliveries',
    detail: 'Check on-time deliveries, accepted quantities and rejected items. Use your saved delivery record to inform the next purchase.',
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
              Plan meals, buy missing ingredients and track deliveries and credits.
              Find each next step in one clear workspace.
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
              <span>Choose ingredients</span>
            </div>
            <span className="hero-route__connector" aria-hidden="true"><ArrowRight /></span>
            <div>
              <JourneyIcon name="list" />
              <span>Compare prices</span>
            </div>
            <span className="hero-route__connector" aria-hidden="true"><ArrowRight /></span>
            <div>
              <JourneyIcon name="price" />
              <span>Choose supplier</span>
            </div>
            <span className="hero-route__connector" aria-hidden="true"><ArrowRight /></span>
            <div>
              <JourneyIcon name="approve" />
              <span>Check delivery</span>
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
              <p className="public-eyebrow">For everyday restaurant work</p>
              <h2 id="restaurant-benefits-title">Useful for every purchase, not just the first one.</h2>
              <p>From planned portions to checked deliveries and credits still owed.</p>
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
            <p className="public-hero__note">Planning example: 10 kg usable ingredients needed − 4 kg usable stock = 6 kg short. At 80% yield, prepare a purchase draft for 7.5 kg. Your team confirms the inputs and reviews the draft.</p>
          </div>
        </section>

        <section className="supplier-benefits public-container" id="for-suppliers" aria-labelledby="supplier-benefits-title">
          <header>
            <p className="public-eyebrow">A clearer relationship, on both sides</p>
            <h2 id="supplier-benefits-title">Good for your kitchen. Useful for your suppliers.</h2>
            <p>Keep your saved suppliers together. Find nearby businesses when needed and review them before inviting them. Open-map listings are free to search.</p>
          </header>
          <ol className="supplier-benefits__steps">
            <li><span aria-hidden="true">01</span><div><h3>Enter prices, review, then send</h3><p>Suppliers enter prices, review delivery and the total, then send their quote through a private link. They can confirm orders or ask for a change. No supplier account required.</p></div></li>
            <li><span aria-hidden="true">02</span><div><h3>Agree on what arrived</h3><p>Suppliers can agree or dispute delivery checks and recorded credits, with an invoice or delivery-note reference. Changed checks need a fresh response.</p></div></li>
            <li><span aria-hidden="true">03</span><div><h3>Share upcoming needs</h3><p>Share selected ingredient estimates so suppliers can prepare. Recipes, portions and stock stay private. Confirm orders separately.</p></div></li>
            <li><span aria-hidden="true">04</span><div><h3>Make your delivery terms clear</h3><p>Suppliers enter service PIN codes, minimum orders and ordering times, with their confirmation date shown. These are supplier declarations, not verified stock or delivery guarantees.</p></div></li>
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
                  <dd>Their requests, ordered items, delivery checks and explicitly shared ingredient estimates</dd>
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
              Start with an approved menu and your portions. Choose your suppliers,
              compare prices and check delivery. No payment card needed.
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
