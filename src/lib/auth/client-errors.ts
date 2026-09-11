const credentialFailures = new Set([
  'CredentialsSignin',
  'Email or password is incorrect.',
  'This account is not active.',
]);

const safeProviderMessages = new Map<string, string>([
  [
    'That email already has an account. Sign in with its existing method.',
    'That email already has an account. Sign in with its existing method.',
  ],
  [
    'No workspace is connected to this Google account. Start a workspace first.',
    'No workspace is connected to this Google account. Start a workspace first.',
  ],
  [
    'Continue with the same Google email used to start signup.',
    'Continue with the same Google email used to start signup.',
  ],
  [
    'Use a Google account with a verified email address.',
    'Use a Google account with a verified email address.',
  ],
  [
    'Google did not return a valid account identity.',
    'Google did not return a valid account identity. Try again.',
  ],
  [
    'Sign in is temporarily unavailable. Try again shortly.',
    'Sign in is temporarily unavailable. Try again shortly.',
  ],
  [
    'Google sign-in is temporarily unavailable. Try again shortly.',
    'Google sign-in is temporarily unavailable. Try again shortly.',
  ],
  [
    'OAuthAccountNotLinked',
    'That email already uses another sign-in method. Use the method you registered with.',
  ],
  ['AccessDenied', 'Google sign-in was cancelled or denied. Try again when ready.'],
]);

const unavailableCodes = new Set([
  'Signin',
  'OAuthSignin',
  'OAuthCallback',
  'OAuthCreateAccount',
  'Callback',
  'Configuration',
]);

export function authErrorMessage(error: unknown): string {
  if (typeof error !== 'string') {
    return 'Sign in could not be completed. Try again.';
  }
  if (credentialFailures.has(error)) {
    return 'Email or password is incorrect, or this workspace is inactive.';
  }
  const safeProviderMessage = safeProviderMessages.get(error);
  if (safeProviderMessage) return safeProviderMessage;
  if (unavailableCodes.has(error)) {
    return 'Google sign-in is temporarily unavailable. Try again shortly.';
  }
  return 'Sign in could not be completed. Try again.';
}
