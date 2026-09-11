import { isIP } from 'node:net';

type PilotEnvironment = {
  DATABASE_URL?: string;
  NEXTAUTH_URL?: string;
  NODE_ENV?: string;
  QUOTEPLATE_LOCAL_E2E?: string;
};

// Accept URL-parsed hostnames only: URL normalizes IPv6 and retains its brackets.
export function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (normalized === 'localhost') return true;
  const address = normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized;
  const version = isIP(address);
  return (version === 4 && address.startsWith('127.')) ||
    (version === 6 && address === '::1');
}

function hasLoopbackUrl(value: string | undefined, protocols: string[]) {
  if (!value?.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return protocols.includes(parsed.protocol) && isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function localPilotTestModeAllowed(environment: PilotEnvironment) {
  return (
    environment.NODE_ENV === 'production' &&
    environment.QUOTEPLATE_LOCAL_E2E === '1' &&
    hasLoopbackUrl(environment.NEXTAUTH_URL, ['http:', 'https:']) &&
    hasLoopbackUrl(environment.DATABASE_URL, ['postgres:', 'postgresql:'])
  );
}

export function productionEmailOwnerSignupAllowed(
  environment: PilotEnvironment = process.env,
) {
  return environment.NODE_ENV !== 'production' || localPilotTestModeAllowed(environment);
}
