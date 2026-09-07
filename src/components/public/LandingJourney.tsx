import { JourneyStage } from './JourneyStage';
import { ProductDecisionPreview } from './ProductDecisionPreview';
import { JourneyIcon, type JourneyIconName } from './JourneyIcon';

const intakeOptions = [
  ['camera', 'Take menu photos', 'Start with the menu on your phone.'],
  ['upload', 'Upload existing photos', 'Bring your menu photos together.'],
  ['list', 'Type dishes or ingredients', 'Enter what your kitchen needs.'],
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
          Explore the workflow at your own pace. Your restaurant stays in control.
        </p>
      </header>

      <JourneyStage>
        <ol className="landing-story__track" role="list">
          <li className="story-scene story-scene--intake" id="journey-step-1">
            <div className="story-scene__copy">
              <h3>Tell us what your kitchen needs</h3>
              <p>
                Start with a menu or enter the items yourself. QuotePlate turns the dishes into an
                ingredient list for your team to check before it is used.
              </p>
              <p>For daily service, set portions and batch servings, enter usable stock and confirmed arrivals, and calculate what is missing before preparing a request.</p>
            </div>
            <div
              className="intake-diagram"
              role="group"
              aria-label="Three ways to add a menu or ingredient list"
            >
              <p className="journey-preview-label">Menu intake</p>
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
              <h3>Choose who should send prices</h3>
              <p>
                Use your existing suppliers, select suppliers for specific items, or allow new
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
              <h3>Send one clear request</h3>
              <p>
                Each supplier receives only the items and quantities assigned to them through a
                private link, with the relevant delivery requirements and terms. No supplier
                account needed.
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
              <h3>Compare the complete cost</h3>
              <p>
                Prices, GST, freight, delivery and missing items stay together. See the full request
                total and the price of every item. Your restaurant can choose one supplier or split
                items between suppliers.
              </p>
            </div>
            <ProductDecisionPreview headingLevel={4} />
          </li>

          <li className="story-scene story-scene--decision" id="journey-step-5">
            <div className="story-scene__copy">
              <h3>Choose and save the decision</h3>
              <p>
                Your restaurant makes the final choice. The saved order keeps the approval and
                price history together, so your team can run the request again from saved history.
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
                <span>Saved buying history</span>
              </div>
            </div>
          </li>
          <li className="story-scene story-scene--decision" id="journey-step-6">
            <div className="story-scene__copy">
              <h3>Check deliveries and follow every credit</h3>
              <p>Record received, rejected and billed quantities against the order. Keep partial deliveries open and track credits claimed, received and still owed.</p>
              <p>Use those recorded outcomes to review supplier fulfilment and delivery reliability before your next purchase.</p>
            </div>
            <div className="decision-route" role="group" aria-label="Delivery checks connect accepted quantities with credit balances">
              <div><JourneyIcon name="receipt" /><span>Record actual quantities</span></div>
              <span aria-hidden="true" />
              <div><JourneyIcon name="history" /><span>Track credits and supplier history</span></div>
            </div>
          </li>
        </ol>
      </JourneyStage>
    </section>
  );
}
