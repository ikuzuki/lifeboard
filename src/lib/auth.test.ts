import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeIdToken, getAuthState, getCredentials, isConfigured, readConfig, restore } from './auth';

/** Nothing here calls Cognito. The token is fabricated and never verified client side. */

function fakeIdToken(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

function configure(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    VITE_AWS_REGION: 'eu-west-2',
    VITE_COGNITO_USER_POOL_ID: 'eu-west-2_test',
    VITE_COGNITO_USER_POOL_CLIENT_ID: 'client',
    VITE_COGNITO_DOMAIN: 'https://lifeboard.auth.eu-west-2.amazoncognito.com/',
    VITE_COGNITO_IDENTITY_POOL_ID: 'eu-west-2:pool',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('readConfig', () => {
  it('is null when the build carries no Cognito settings, so sync stays inactive', () => {
    expect(readConfig()).toBeNull();
    expect(isConfigured()).toBe(false);
  });

  it('is null when any single setting is missing', () => {
    configure({ VITE_COGNITO_IDENTITY_POOL_ID: '' });
    expect(readConfig()).toBeNull();
  });

  it('trims the trailing slash from the hosted UI domain', () => {
    configure();
    expect(readConfig()?.domain).toBe('https://lifeboard.auth.eu-west-2.amazoncognito.com');
  });

  it('adds a scheme to a bare hostname, which is what Terraform reports', () => {
    // The fixture above carries a full URL, which is why the shipped build broke while the
    // suite stayed green: `terraform output` gives the hosted UI as a bare host, and both
    // location.assign and fetch then resolve it against the app's own origin. Sign-in
    // navigated to https://<app>/lifeboard-ik-dev.auth.../oauth2/authorize and the SPA
    // fallback served index.html, so the app looked like it had simply reloaded.
    configure({ VITE_COGNITO_DOMAIN: 'lifeboard-ik-dev.auth.eu-west-2.amazoncognito.com' });
    expect(readConfig()?.domain).toBe('https://lifeboard-ik-dev.auth.eu-west-2.amazoncognito.com');
  });

  it('leaves an explicit scheme alone', () => {
    configure({ VITE_COGNITO_DOMAIN: 'http://localhost:9229' });
    expect(readConfig()?.domain).toBe('http://localhost:9229');
  });

  it('falls back to the page origin for the redirect', () => {
    configure();
    expect(readConfig()?.redirectUri).toBe(window.location.origin);
  });

  it('prefers an explicit redirect when one is set', () => {
    configure({ VITE_COGNITO_REDIRECT_URI: 'https://lifeboard.example/app' });
    expect(readConfig()?.redirectUri).toBe('https://lifeboard.example/app');
  });
});

describe('decodeIdToken', () => {
  it('reads the claims the settings screen displays', () => {
    const user = decodeIdToken(
      fakeIdToken({ sub: 'abc', email: 'someone@example.com', name: 'Someone' }),
    );
    expect(user).toEqual({
      sub: 'abc',
      email: 'someone@example.com',
      name: 'Someone',
      picture: null,
    });
  });

  it('returns null rather than throwing on anything that is not a token', () => {
    expect(decodeIdToken('not-a-token')).toBeNull();
    expect(decodeIdToken('header..signature')).toBeNull();
    expect(decodeIdToken(fakeIdToken({ email: 'no-subject@example.com' }))).toBeNull();
  });
});

describe('an expired session', () => {
  /** In memory, because the environment provides no usable `localStorage` global. */
  function storeExpiredSession() {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    });
    localStorage.setItem(
      'lifeboard.auth',
      JSON.stringify({
        idToken: fakeIdToken({ sub: 'user-1' }),
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() - 1000,
      }),
    );
  }

  it('signs out when Cognito refuses the refresh, rather than claiming to be signed in', async () => {
    configure();
    storeExpiredSession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));

    await restore();
    expect(getAuthState().status).toBe('signed-in');

    expect(await getCredentials()).toBeNull();
    expect(getAuthState().status).toBe('signed-out');
    expect(getAuthState().error).toMatch(/sign in again/i);
    expect(localStorage.getItem('lifeboard.auth')).toBeNull();
  });

  it('keeps the session through a network failure, which may pass', async () => {
    configure();
    storeExpiredSession();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await restore();
    expect(await getCredentials()).toBeNull();
    expect(getAuthState().status).toBe('error');
    expect(localStorage.getItem('lifeboard.auth')).not.toBeNull();
  });
});
