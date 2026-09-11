import type { Metadata } from 'next';

import { AuthPageShell } from '@/components/auth/AuthPageShell';
import { googleAuthAvailable } from '@/lib/auth';
import { resolveAuthCallback } from '@/lib/auth/callback-url';
import { authErrorMessage } from '@/lib/auth/client-errors';
import { productionEmailOwnerSignupAllowed } from '@/lib/auth/pilot-access';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Create a workspace',
  description: 'Create your private restaurant workspace with a verified Google email.',
  robots: { index: false, follow: false },
};

type StartPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function one(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

export default async function StartPage({ searchParams }: StartPageProps) {
  const params = await searchParams;
  const callbackUrl = resolveAuthCallback(params.callbackUrl);
  const error = one(params.error);
  const googleAvailable =
    googleAuthAvailable(process.env) && Boolean(process.env.NEXTAUTH_SECRET?.trim());

  return (
    <AuthPageShell
      mode="start"
      callbackUrl={callbackUrl}
      googleAvailable={googleAvailable}
      emailOwnerSignupAvailable={productionEmailOwnerSignupAllowed(process.env)}
      initialError={error ? authErrorMessage(error) : null}
    />
  );
}
