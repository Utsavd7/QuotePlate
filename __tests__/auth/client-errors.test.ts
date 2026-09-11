import { authErrorMessage } from '@/lib/auth/client-errors';

describe('authentication client errors', () => {
  it('turns credentials and inactive failures into one safe useful message', () => {
    expect(authErrorMessage('CredentialsSignin')).toMatch(/incorrect/i);
    expect(authErrorMessage('Email or password is incorrect.')).toMatch(
      /inactive/i,
    );
    expect(authErrorMessage('This account is not active.')).toMatch(/inactive/i);
  });

  it('explains duplicate and collision-safe Google account failures', () => {
    expect(
      authErrorMessage(
        'That email already has an account. Sign in with its existing method.',
      ),
    ).toMatch(/already has an account/i);
    expect(
      authErrorMessage(
        'No workspace is connected to this Google account. Start a workspace first.',
      ),
    ).toMatch(/start a workspace/i);
  });

  it('never reflects an unknown provider or server error', () => {
    const secret = 'database password leaked by the driver';
    expect(authErrorMessage(secret)).not.toContain(secret);
    expect(authErrorMessage(secret)).toBe(
      'Sign in could not be completed. Try again.',
    );
  });

  it.each(['Signin', 'OAuthSignin', 'OAuthCallback', 'OAuthCreateAccount', 'Callback', 'Configuration'])('offers valid recovery for Google-only owners (%s)', (code) => {
    expect(authErrorMessage(code)).toBe('Google sign-in is temporarily unavailable. Try again shortly.');
  });

  it('keeps the exact safe Google outage message useful', () => {
    expect(
      authErrorMessage(
        'Google sign-in is temporarily unavailable. Try again shortly.',
      ),
    ).toBe(
      'Google sign-in is temporarily unavailable. Try again shortly.',
    );
  });
});
