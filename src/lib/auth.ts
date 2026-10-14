import { useEffect, useState } from 'react';

/** Structurally the SDK's `AwsCredentialIdentity`, declared here to avoid a static import. */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

/**
 * A thin client over a Cognito user pool federated to Google, plus an identity pool
 * that exchanges the resulting token for temporary AWS credentials.
 *
 * Auth is additive. Every export here degrades to a no-op when the environment is not
 * configured, so the app runs fully signed out with sync simply inactive.
 */

export type AuthStatus = 'signed-out' | 'signing-in' | 'signed-in' | 'error';

export interface AuthUser {
  sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
}

export interface AuthConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  /** Hosted UI origin, for example https://lifeboard.auth.eu-west-2.amazoncognito.com */
  domain: string;
  identityPoolId: string;
  redirectUri: string;
}

interface Tokens {
  idToken: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

const TOKEN_KEY = 'lifeboard.auth';
const VERIFIER_KEY = 'lifeboard.auth.verifier';
const SCOPES = 'openid email profile';
/** Refresh this far ahead of expiry so an in-flight request cannot straddle it. */
const SKEW_MS = 5 * 60_000;

const withScheme = (host: string): string =>
  /^https?:\/\//.test(host) ? host : `https://${host}`;

export function readConfig(): AuthConfig | null {
  const env = import.meta.env;
  const region = env.VITE_AWS_REGION;
  const userPoolId = env.VITE_COGNITO_USER_POOL_ID;
  const clientId = env.VITE_COGNITO_USER_POOL_CLIENT_ID;
  const domain = env.VITE_COGNITO_DOMAIN;
  const identityPoolId = env.VITE_COGNITO_IDENTITY_POOL_ID;
  if (!region || !userPoolId || !clientId || !domain || !identityPoolId) return null;
  return {
    region,
    userPoolId,
    clientId,
    // Normalised to an absolute origin. Terraform reports the hosted UI as a bare
    // hostname, and both `location.assign` and `fetch` treat a schemeless string as a path
    // relative to the current origin: the sign-in redirect became
    // https://lifeboard.isseikuzuki.co.uk/lifeboard-ik-dev.auth.../oauth2/authorize, which
    // the SPA fallback answered with index.html, so the app appeared to reload instead of
    // leaving for Google.
    domain: withScheme(domain).replace(/\/$/, ''),
    identityPoolId,
    redirectUri: env.VITE_COGNITO_REDIRECT_URI || window.location.origin,
  };
}

export const isConfigured = (): boolean => readConfig() !== null;

let state: AuthState = { status: 'signed-out', user: null, error: null };
const listeners = new Set<(s: AuthState) => void>();

function setState(next: Partial<AuthState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

export const getAuthState = (): AuthState => state;

export function subscribe(listener: (s: AuthState) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes the payload without verifying it. The token came from the token endpoint over TLS. */
export function decodeIdToken(idToken: string): AuthUser | null {
  const part = idToken.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as Record<string, unknown>;
    if (typeof claims.sub !== 'string') return null;
    const text = (key: string) => (typeof claims[key] === 'string' ? (claims[key] as string) : null);
    return { sub: claims.sub, email: text('email'), name: text('name'), picture: text('picture') };
  } catch {
    return null;
  }
}

function readTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Tokens>;
    if (typeof parsed.idToken !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    return {
      idToken: parsed.idToken,
      accessToken: typeof parsed.accessToken === 'string' ? parsed.accessToken : '',
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function writeTokens(tokens: Tokens | null): void {
  try {
    if (tokens) localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private browsing; the session still works until the tab closes */
  }
}

interface TokenResponse {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function postToken(config: AuthConfig, body: Record<string, string>): Promise<Tokens> {
  const response = await fetch(`${config.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, ...body }).toString(),
  });
  if (!response.ok) throw new Error(`Cognito token endpoint returned ${response.status}`);
  const json = (await response.json()) as TokenResponse;
  if (!json.id_token) throw new Error('Cognito returned no identity token');
  return {
    idToken: json.id_token,
    accessToken: json.access_token ?? '',
    refreshToken: json.refresh_token ?? body.refresh_token ?? null,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

/**
 * Redirects to the hosted UI with Google preselected. Authorisation code with PKCE
 * rather than the implicit flow, so no token is ever exposed in a URL fragment.
 */
export async function signIn(): Promise<void> {
  const config = readConfig();
  if (!config) {
    setState({ status: 'error', error: 'Sync is not configured in this build.' });
    return;
  }
  setState({ status: 'signing-in', error: null });

  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const verifier = base64url(random);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  // localStorage, not sessionStorage: an installed PWA sends the user out to Google in a
  // separate browsing context, and the return can land in a fresh one that never had the
  // session copy. Losing the verifier fails the exchange with nothing to retry from.
  localStorage.setItem(VERIFIER_KEY, verifier);

  const query = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: SCOPES,
    identity_provider: 'Google',
    code_challenge_method: 'S256',
    code_challenge: base64url(new Uint8Array(digest)),
  });
  window.location.assign(`${config.domain}/oauth2/authorize?${query.toString()}`);
}

/**
 * Handles the redirect back from the hosted UI and restores an existing session
 * otherwise. Safe to call on every load, configured or not.
 */
export async function restore(): Promise<void> {
  const config = readConfig();
  if (!config) return;

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const failure = params.get('error');

  if (failure) {
    stripQuery();
    setState({ status: 'error', user: null, error: params.get('error_description') ?? failure });
    return;
  }

  if (code) {
    const verifier = localStorage.getItem(VERIFIER_KEY);
    stripQuery();
    localStorage.removeItem(VERIFIER_KEY);
    if (!verifier) {
      setState({ status: 'error', error: 'Sign-in could not be verified. Try again.' });
      return;
    }
    setState({ status: 'signing-in', error: null });
    try {
      const tokens = await postToken(config, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        code_verifier: verifier,
      });
      writeTokens(tokens);
      setState({ status: 'signed-in', user: decodeIdToken(tokens.idToken), error: null });
    } catch (error) {
      setState({ status: 'error', user: null, error: message(error) });
    }
    return;
  }

  const existing = readTokens();
  if (!existing) return;
  setState({ status: 'signed-in', user: decodeIdToken(existing.idToken), error: null });
}

function stripQuery(): void {
  window.history.replaceState({}, '', window.location.pathname + window.location.hash);
}

export function signOut(): void {
  writeTokens(null);
  credentialCache = null;
  identityId = null;
  setState({ status: 'signed-out', user: null, error: null });
}

async function freshIdToken(): Promise<{ config: AuthConfig; idToken: string } | null> {
  const config = readConfig();
  if (!config) return null;
  const tokens = readTokens();
  if (!tokens) return null;

  if (tokens.expiresAt - Date.now() > SKEW_MS) return { config, idToken: tokens.idToken };
  if (!tokens.refreshToken) {
    signOut();
    return null;
  }
  try {
    const refreshed = await postToken(config, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    });
    writeTokens(refreshed);
    return { config, idToken: refreshed.idToken };
  } catch (error) {
    setState({ status: 'error', error: message(error) });
    return null;
  }
}

export interface Session {
  identityId: string;
  credentials: AwsCredentials;
}

let credentialCache: { session: Session; expiresAt: number } | null = null;
let identityId: string | null = null;
let inflight: Promise<Session | null> | null = null;

/**
 * Temporary AWS credentials for the signed-in user, or null when signed out or
 * unconfigured. Cached and refreshed ahead of expiry. The SDK is imported lazily so
 * a signed-out user never downloads it.
 */
export function getCredentials(): Promise<Session | null> {
  if (credentialCache && credentialCache.expiresAt - Date.now() > SKEW_MS) {
    return Promise.resolve(credentialCache.session);
  }
  inflight ??= exchange().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function exchange(): Promise<Session | null> {
  const fresh = await freshIdToken();
  if (!fresh) return null;
  const { config, idToken } = fresh;
  const logins = { [`cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`]: idToken };

  const { CognitoIdentityClient, GetIdCommand, GetCredentialsForIdentityCommand } = await import(
    '@aws-sdk/client-cognito-identity'
  );
  const client = new CognitoIdentityClient({ region: config.region });

  try {
    if (!identityId) {
      const identity = await client.send(
        new GetIdCommand({ IdentityPoolId: config.identityPoolId, Logins: logins }),
      );
      identityId = identity.IdentityId ?? null;
    }
    if (!identityId) throw new Error('Cognito returned no identity');

    const result = await client.send(
      new GetCredentialsForIdentityCommand({ IdentityId: identityId, Logins: logins }),
    );
    const issued = result.Credentials;
    if (!issued?.AccessKeyId || !issued.SecretKey) {
      throw new Error('Cognito returned no credentials');
    }

    const session: Session = {
      identityId,
      credentials: {
        accessKeyId: issued.AccessKeyId,
        secretAccessKey: issued.SecretKey,
        sessionToken: issued.SessionToken,
        expiration: issued.Expiration,
      },
    };
    const expiresAt = issued.Expiration ? issued.Expiration.getTime() : Date.now() + 3_600_000;
    credentialCache = { session, expiresAt };
    return session;
  } catch (error) {
    // A rejected identity means the session is no longer usable, so surface it rather
    // than retrying against a token the identity pool will not accept.
    identityId = null;
    setState({ status: 'error', error: message(error) });
    return null;
  } finally {
    client.destroy();
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Sign-in failed.';
}

export function useAuth(): AuthState & { signIn: () => void; signOut: () => void } {
  const [current, setCurrent] = useState(state);
  useEffect(() => subscribe(setCurrent), []);
  return {
    ...current,
    signIn: () => void signIn(),
    signOut,
  };
}
