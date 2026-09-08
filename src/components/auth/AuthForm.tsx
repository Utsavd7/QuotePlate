'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { FormEvent, useRef, useState, useSyncExternalStore } from 'react';

import { authErrorMessage } from '@/lib/auth/client-errors';
import {
  beginGoogleAuthentication,
  type GoogleSignupFields,
} from '@/lib/auth/google-client';

import styles from './AuthExperience.module.css';

type AuthFormProps = {
  mode: 'signin' | 'start';
  googleAvailable: boolean;
  emailOwnerSignupAvailable?: boolean;
  callbackUrl: string;
  initialError?: string | null;
};

type PendingAction = 'email' | 'google' | null;

const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

function GoogleGlyph() {
  return (
    <svg aria-hidden="true" className={styles.googleGlyph} viewBox="0 0 18 18">
      <path fill="#EA4335" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.715v2.258h2.909c1.702-1.567 2.684-3.878 2.684-6.613Z" />
      <path fill="#4285F4" d="M9 18c2.43 0 4.467-.806 5.956-2.182l-2.909-2.258c-.806.54-1.836.86-3.047.86-2.344 0-4.328-1.584-5.037-3.71H.956v2.332A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.963 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.281-1.71V4.958H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.042l3.007-2.332Z" />
      <path fill="#34A853" d="M9 3.58c1.322 0 2.507.454 3.441 1.345l2.581-2.581C13.463.891 11.426 0 9 0A9 9 0 0 0 .956 4.958L3.963 7.29C4.672 5.164 6.656 3.58 9 3.58Z" />
    </svg>
  );
}

function value(formData: FormData, name: string) {
  return String(formData.get(name) ?? '').trim();
}

function signupFields(form: HTMLFormElement): GoogleSignupFields {
  const formData = new FormData(form);
  return {
    restaurantName: value(formData, 'restaurantName'),
    ownerName: value(formData, 'ownerName'),
    email: value(formData, 'email'),
    addressLine: value(formData, 'addressLine'),
    city: value(formData, 'city'),
    state: value(formData, 'state'),
    pin: value(formData, 'pin'),
    phone: value(formData, 'phone'),
    timezone: 'Asia/Kolkata',
    gstin: value(formData, 'gstin'),
  };
}

async function responseError(response: Response) {
  try {
    const data = (await response.json()) as { error?: unknown };
    if (typeof data.error === 'string') return data.error;
  } catch {
    // Keep the stable fallback when the response is not JSON.
  }
  return 'Unable to create the workspace right now. Try again shortly.';
}

export function AuthForm({
  mode,
  googleAvailable,
  emailOwnerSignupAvailable = true,
  callbackUrl,
  initialError = null,
}: AuthFormProps) {
  const router = useRouter();
  const ready = useSyncExternalStore(subscribeHydration, clientReady, serverReady);
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(initialError);

  async function finishCredentials(email: string, password: string) {
    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
      callbackUrl,
    });
    if (!result || result.error || !result.ok) {
      throw new Error(authErrorMessage(result?.error));
    }
    router.replace(callbackUrl);
    router.refresh();
  }

  async function handleEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || pending) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    setError(null);
    setPending('email');
    const formData = new FormData(form);
    const email = value(formData, 'email');
    const password = String(formData.get('password') ?? '');

    try {
      if (mode === 'start') {
        const response = await fetch('/api/auth/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'email',
            ...signupFields(form),
            password,
          }),
        });
        if (!response.ok) throw new Error(await responseError(response));
      }
      await finishCredentials(email, password);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Sign in could not be completed. Try again.',
      );
      setPending(null);
    }
  }

  async function handleGoogle() {
    if (!ready || !googleAvailable || pending || !formRef.current) return;
    const form = formRef.current;
    const password = form.elements.namedItem('password');
    const passwordInput = password instanceof HTMLInputElement ? password : null;
    if (mode === 'start' && passwordInput) passwordInput.disabled = true;
    const valid = mode === 'signin' || form.reportValidity();
    if (passwordInput) passwordInput.disabled = false;
    if (!valid) return;

    setError(null);
    setPending('google');
    try {
      await beginGoogleAuthentication(
        mode === 'signin'
          ? { mode: 'signin', callbackUrl }
          : { mode: 'signup', signup: signupFields(form), callbackUrl },
        {
          fetcher: (input, init) => fetch(input, init),
          googleSignIn: (provider, options) => signIn(provider, options),
        },
      );
    } catch (caught) {
      const raw = caught instanceof Error ? caught.message : undefined;
      const knownStartError =
        raw?.startsWith('Google sign-in is not configured') ||
        raw?.startsWith('Google sign-in is temporarily unavailable')
          ? raw
          : null;
      setError(knownStartError ?? authErrorMessage(raw));
      setPending(null);
    }
  }

  const busyMessage =
    pending === 'google'
      ? 'Opening Google…'
      : pending === 'email'
        ? mode === 'start'
          ? 'Creating workspace…'
          : 'Signing in…'
        : '';

  return (
    <form className={styles.form} method="post" onSubmit={handleEmail} ref={formRef}>
      <div className={styles.formIntro}>
        <div>
          <p className={styles.formKicker}>{mode === 'signin' ? 'Welcome back' : 'Controlled pilot'}</p>
          <h2>{mode === 'signin' ? 'Sign in to QuotePlate' : 'Create your workspace'}</h2>
        </div>
        <p>
          {mode === 'signin'
            ? 'Use the method connected to your account.'
            : 'Your owner account and restaurant workspace are created together.'}
        </p>
      </div>

      {mode === 'start' && (
        <fieldset className={styles.fieldset} disabled={!ready || pending !== null}>
          <legend>Restaurant</legend>
          <div className={styles.fieldGrid}>
            <label>
              <span>Restaurant name</span>
              <input name="restaurantName" autoComplete="organization" maxLength={200} required />
            </label>
            <label>
              <span>Restaurant phone</span>
              <input name="phone" autoComplete="tel" inputMode="tel" maxLength={32} required />
            </label>
            <label className={styles.fieldWide}>
              <span>Street address</span>
              <input name="addressLine" autoComplete="street-address" maxLength={500} required />
            </label>
            <label>
              <span>City</span>
              <input name="city" autoComplete="address-level2" maxLength={120} required />
            </label>
            <label>
              <span>State</span>
              <input name="state" autoComplete="address-level1" maxLength={120} required />
            </label>
            <label>
              <span>PIN code</span>
              <input name="pin" autoComplete="postal-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required />
            </label>
            <label>
              <span>GSTIN <em>optional</em></span>
              <input
                name="gstin"
                autoCapitalize="characters"
                aria-describedby="gstin-help"
                maxLength={15}
                pattern="[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][A-Za-z0-9]Z[A-Za-z0-9]"
              />
              <small id="gstin-help">You can add this later in workspace settings.</small>
            </label>
          </div>
        </fieldset>
      )}

      <fieldset className={styles.fieldset} disabled={!ready || pending !== null}>
        <legend>{mode === 'signin' ? 'Account' : 'Owner account'}</legend>
        <div className={styles.fieldGrid}>
          {mode === 'start' && (
            <label>
              <span>Your name</span>
              <input name="ownerName" autoComplete="name" maxLength={200} required />
            </label>
          )}
          <label className={mode === 'signin' ? styles.fieldWide : undefined}>
            <span>Work email</span>
            <input name="email" type="email" autoComplete="email" maxLength={320} required />
          </label>
          {(mode === 'signin' || emailOwnerSignupAvailable) && (
            <label className={styles.fieldWide}>
              <span>Password</span>
              <input
                name="password"
                type="password"
                autoComplete={mode === 'start' ? 'new-password' : 'current-password'}
                aria-describedby={mode === 'start' ? 'password-help' : undefined}
                minLength={8}
                maxLength={1024}
                required
              />
              {mode === 'start' && <small id="password-help">Use at least 8 characters.</small>}
            </label>
          )}
        </div>
      </fieldset>

      {error && <p className={styles.error} role="alert">{error}</p>}
      <p className={styles.progress} aria-live="polite">{busyMessage}</p>

      {!ready && <p role="status">Preparing secure sign-in… JavaScript is required.</p>}
      <div className={styles.actions}>
        {(mode === 'signin' || emailOwnerSignupAvailable) && (
          <>
            <button className={styles.primaryButton} disabled={!ready || pending !== null} type="submit">
              {pending === 'email'
                ? busyMessage
                : mode === 'signin'
                  ? 'Sign in with email'
                  : 'Create workspace with email'}
            </button>
            <div className={styles.divider}><span>or</span></div>
          </>
        )}

        <button
          className={styles.googleButton}
          disabled={!ready || !googleAvailable || pending !== null}
          onClick={handleGoogle}
          type="button"
        >
          <GoogleGlyph />
          {pending === 'google' ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {!googleAvailable && (
          <p className={styles.providerNote}>
            {mode === 'signin'
              ? 'Google sign-in is not configured for this deployment. Use email and password.'
              : 'Google pilot access is not configured for this deployment yet.'}
          </p>
        )}
        {mode === 'start' && !emailOwnerSignupAvailable && (
          <p className={styles.providerNote}>
            Pilot activation uses the approved owner&apos;s verified Google email.
          </p>
        )}
      </div>

      <p className={styles.switchMode}>
        {mode === 'signin' ? 'New to QuotePlate?' : 'Already registered?'}{' '}
        <Link href={mode === 'signin' ? '/start' : '/signin'}>
          {mode === 'signin' ? 'Create a workspace' : 'Sign in'}
        </Link>
      </p>

      {mode === 'start' && (
        <p className={styles.terms}>
          By creating a workspace, you agree to the <Link href="/terms">pilot terms</Link>{' '}
          and acknowledge the <Link href="/privacy">privacy notice</Link>.
        </p>
      )}
    </form>
  );
}
