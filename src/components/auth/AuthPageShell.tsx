import { JourneyIcon } from '@/components/public/JourneyIcon';
import { PublicFooter } from '@/components/public/PublicFooter';
import { PublicHeader } from '@/components/public/PublicHeader';

import { AuthForm } from './AuthForm';
import styles from './AuthExperience.module.css';

type AuthPageShellProps = {
  mode: 'signin' | 'start';
  googleAvailable: boolean;
  emailOwnerSignupAvailable?: boolean;
  callbackUrl: string;
  initialError?: string | null;
};

const content = {
  signin: {
    eyebrow: 'Restaurant workspace',
    title: 'Return to the decisions that need you.',
    description:
      'Open your purchases, compare prices and check deliveries.',
    document: 'Account access',
    note: 'Restaurant records remain on the server; your browser stores only the session needed to keep you signed in.',
  },
  start: {
    eyebrow: 'India pilot',
    title: 'Set up the workspace behind your next purchase.',
    description:
      'Keep your team, suppliers, purchases and order history in one restaurant workspace.',
    document: 'Owner registration',
    note: 'Starting the pilot does not activate a paid plan or automatic billing.',
  },
} as const;

const assurances = [
  { icon: 'privacy', label: 'Restaurant privacy', text: 'One workspace, isolated from every other restaurant.' },
  { icon: 'link', label: 'Sign-in security', text: 'Google stores identity only; QuotePlate stores no Google access tokens.' },
  { icon: 'approve', label: 'Purchasing decisions', text: 'Your restaurant chooses the supplier and confirms each order.' },
] as const;

export function AuthPageShell(props: AuthPageShellProps) {
  const page = content[props.mode];

  return (
    <div className={`${styles.page} public-site`} data-mode={props.mode}>
      <a className="skip-link" href="#account-form">
        Skip to account form
      </a>
      <PublicHeader sticky />

      <main className={styles.layout} id="main-content">
        <aside className={styles.context} aria-labelledby="account-heading">
          <p className={styles.eyebrow}>{page.eyebrow}</p>
          <h1 id="account-heading">{page.title}</h1>
          <p className={styles.introduction}>{page.description}</p>

          <dl className={styles.assurances}>
            {assurances.map((assurance) => (
              <div key={assurance.icon}>
                <dt>
                  <JourneyIcon name={assurance.icon} />
                  <span className="sr-only">{assurance.label}</span>
                </dt>
                <dd>{assurance.text}</dd>
              </div>
            ))}
          </dl>

          <p className={styles.contextNote}>{page.note}</p>
        </aside>

        <section
          className={styles.sheet}
          id="account-form"
          tabIndex={-1}
          aria-label={page.document}
        >
          <div className={styles.sheetHeader}>
            <div>
              <span>QuotePlate / {page.document}</span>
              <strong>{props.mode === 'signin' ? 'Existing user' : 'Workspace owner'}</strong>
            </div>
          </div>
          {props.mode === 'start' && (
            <aside className={styles.pilotNotice} aria-label="Controlled pilot terms">
              <strong>Controlled pilot terms</strong>
              <ul>
                <li>Up to twenty approved restaurant workspaces</li>
                <li>Use the Google account approved for your workspace</li>
                <li>No payment card. No billing.</li>
              </ul>
            </aside>
          )}
          <AuthForm {...props} />
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
