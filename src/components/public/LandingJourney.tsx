import { JourneyStage } from './JourneyStage';
import { ProductDecisionPreview } from './ProductDecisionPreview';
import { JourneyIcon, type JourneyIconName } from './JourneyIcon';

const intakeOptions = [
  ['camera', 'Take menu photos', 'Use your phone camera.'],
  ['upload', 'Upload photos', 'Use saved menu images.'],
  ['list', 'Type or paste', 'Enter dish names only.'],
] satisfies ReadonlyArray<readonly [JourneyIconName, string, string]>;

const supplierCategories = [
  'Vegetables',
  'Fruits',
  'Dairy',
  'Dry goods',
  'Beverages',
  'Coffee & tea',
  'Sweets',
  'Packaged foods',
  'Outsourced snacks',
] as const;

const requestRecipients = [
  'Vegetable supplier',
  'Dairy supplier',
  'Dry goods supplier',
] as const;

export function LandingJourney() {
  return (
    <section className="landing-story" id="how-it-works" aria-labelledby="landing-story-title">
      <header className="public-container landing-story__intro">
        <p className="public-eyebrow">One buying journey</p>
        <h2 id="landing-story-title">From today&apos;s menu to tomorrow&apos;s order.</h2>
        <p>
          Start in Today. Find daily work in Purchases, Suppliers, Menu and Reports.
        </p>
      </header>

      <JourneyStage>
        <ol className="landing-story__track" role="list">
          <li className="story-scene story-scene--intake" id="journey-step-1">
            <div className="story-scene__copy">
              <h3>Choose ingredients</h3>
              <p>
                Add a menu by photo, upload, paste or a permitted website link.
                Check dish names, add ingredients and quantities, then approve the menu. Or start a purchase directly from a typed shopping list or photo, reviewing each quantity and unit.
              </p>
              <p>In Plan meals, choose meals and portions, check stock, then review missing ingredients. Enter batch servings, usable stock, yield and confirmed arrivals explicitly.</p>
            </div>
            <div
              className="intake-diagram"
              role="group"
              aria-label="Three ways to add a menu or ingredient list"
            >
              <p className="journey-preview-label">Add menu</p>
              {intakeOptions.map(([icon, label, detail]) => (
                <div key={label}>
                  <JourneyIcon name={icon} />
                  <div><strong>{label}</strong><p>{detail}</p></div>
                </div>
              ))}
            </div>
          </li>

          <li className="story-scene story-scene--suppliers" id="journey-step-2">
            <div className="story-scene__copy">
              <h3>Invite your suppliers</h3>
              <p>
                Use your saved suppliers. Choose suppliers for specific items, or allow new
                suppliers to apply, then approve them yourself.
              </p>
            </div>
            <div
              className="supplier-diagram"
              role="group"
              aria-label="Supplier categories selected by the restaurant"
            >
              <div className="supplier-diagram__heading">
                <JourneyIcon name="suppliers" />
                <strong>Your suppliers</strong>
              </div>
              <ul>
                {supplierCategories.map((category) => <li key={category}>{category}</li>)}
              </ul>
            </div>
          </li>

          <li className="story-scene story-scene--request" id="journey-step-3">
            <div className="story-scene__copy">
              <h3>Ask for prices</h3>
              <p>
                Choose WhatsApp or Email to prepare a message, then press Send in that app. Or copy
                the private link yourself. Suppliers see only their assigned items, quantities and delivery terms,
                enter prices, review the total and submit their quote. No supplier account needed.
              </p>
            </div>
            <div
              className="request-route"
              role="group"
              aria-label="Assigned items from one request sent to vegetable, dairy and dry goods suppliers by private links"
            >
              <div>
                <JourneyIcon name="list" />
                <strong>One request</strong>
              </div>
              <span className="request-route__link" aria-hidden="true">
                <JourneyIcon name="link" />
              </span>
              <ul>
                {requestRecipients.map((supplier) => <li key={supplier}>{supplier}</li>)}
              </ul>
            </div>
          </li>

          <li className="story-scene story-scene--comparison" id="journey-step-4">
            <div className="story-scene__copy">
              <h3>Compare prices</h3>
              <p>
                Compare item prices, GST, delivery charges and dates. Missing quotes stay visible.
                Check the full total, then choose one supplier or split items between suppliers.
              </p>
            </div>
            <ProductDecisionPreview headingLevel={4} />
          </li>

          <li className="story-scene story-scene--decision" id="journey-step-5">
            <div className="story-scene__copy">
              <h3>Choose supplier</h3>
              <p>
                Your restaurant makes the final choice. Save the order with its approval and price
                history. Repeat it later from Past purchases.
              </p>
            </div>
            <div
              className="decision-route"
              role="group"
              aria-label="Selected supplier saved to buying history"
            >
              <div>
                <JourneyIcon name="approve" />
                <span>Supplier selected</span>
              </div>
              <span aria-hidden="true" />
              <div>
                <JourneyIcon name="history" />
                <span>Past purchases</span>
              </div>
            </div>
          </li>
          <li className="story-scene story-scene--decision" id="journey-step-6">
            <div className="story-scene__copy">
              <h3>Check delivery</h3>
              <p>Record received, rejected and billed quantities. Track partial deliveries and credits claimed, received and still owed.</p>
              <p>Check Delivery record for supplier performance and Reports for prices and order totals.</p>
            </div>
            <div className="decision-route" role="group" aria-label="Delivery checks connect accepted quantities with credit balances">
              <div><JourneyIcon name="receipt" /><span>Check what arrived</span></div>
              <span aria-hidden="true" />
              <div><JourneyIcon name="history" /><span>Follow up credits</span></div>
            </div>
          </li>
        </ol>
      </JourneyStage>
    </section>
  );
}
