import { useEffect, useState } from 'react';
import type { Goal, Item, State } from '../types';
import { isState, migrate } from '../store';
import { getCredentials, isConfigured, subscribe as subscribeAuth } from './auth';
import { isDegraded, load, onPersist, persist } from './storage';
import { buildDigest, sameDigest, type Digest } from './digest';

/**
 * One JSON document per user at `users/{identityId}/state.json`, written straight from
 * the browser with identity-pool credentials. No API layer.
 *
 * Writes are conditional on the ETag from the last read. A 412 means another device
 * got there first, so we re-read and merge per item rather than clobber: whole-document
 * last-write-wins loses data every time two devices touch different items.
 */

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'conflict';

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  error: string | null;
}

export const documentKey = (identityId: string): string => `users/${identityId}/state.json`;

/** Counts and dates only, and the one key the notifier is allowed to read. */
export const digestKey = (identityId: string): string => `users/${identityId}/digest.json`;

/**
 * Keyed by a hash of the endpoint rather than the endpoint itself, which keeps a URL holding
 * a device-scoped token out of key names, log lines and bucket listings.
 */
export const pushKey = (identityId: string, endpointHash: string): string =>
  `users/${identityId}/push/${endpointHash}.json`;

export class PreconditionFailed extends Error {}

export interface RemoteDocument {
  body: string;
  etag: string;
}

/**
 * The S3 surface sync needs, narrow enough to fake in tests. `ifMatch` of null means
 * the write must only succeed when the object does not yet exist.
 */
export interface Transport {
  get(key: string): Promise<RemoteDocument | null>;
  put(key: string, body: string, ifMatch: string | null): Promise<string>;
  /**
   * Last write wins, for the documents where that is the right answer. The digest is derived
   * from the state document, so an older one losing is correct rather than lossy, and a push
   * subscription belongs to the device writing it.
   */
  overwrite(key: string, body: string): Promise<void>;
}

/** Ties for the same item resolve to local, which keeps the device you are holding authoritative. */
function newer(local: Item, remote: Item): Item {
  return remote.updatedAt > local.updatedAt ? remote : local;
}

function mergeItems(local: Item[], remote: Item[]): Item[] {
  const byId = new Map(remote.map((i) => [i.id, i]));
  const merged = local.map((i) => {
    const other = byId.get(i.id);
    byId.delete(i.id);
    return other ? newer(i, other) : i;
  });
  return [...merged, ...byId.values()];
}

/**
 * Goals carry no timestamp, so a goal present on both sides keeps the local copy.
 * Only creation and deletion of goals propagate cleanly.
 */
function mergeGoals(local: Goal[], remote: Goal[]): Goal[] {
  const seen = new Set(local.map((g) => g.id));
  return [...local, ...remote.filter((g) => !seen.has(g.id))];
}

export function mergeStates(local: State, remote: State): State {
  // Spread local first so any field without an explicit merge rule survives as
  // local-wins. Naming the keys instead would silently drop every field added later.
  return {
    ...local,
    version: Math.max(local.version, remote.version),
    items: mergeItems(local.items, remote.items),
    goals: mergeGoals(local.goals, remote.goals),
  };
}

function parseDocument(body: string): State {
  const parsed: unknown = JSON.parse(body);
  if (!isState(parsed)) throw new Error('The remote document is not in the expected shape.');
  return migrate(parsed);
}

export interface PushResult {
  state: State;
  etag: string;
  merged: boolean;
}

/**
 * Writes `local`, merging and retrying whenever the remote moved under us. Returns the
 * state actually stored, which the caller must persist so the two stop diverging.
 */
export async function pushState(
  transport: Transport,
  key: string,
  local: State,
  knownEtag: string | null,
  attempts = 3,
): Promise<PushResult> {
  let candidate = local;
  let etag = knownEtag;
  let merged = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const written = await transport.put(key, JSON.stringify(candidate), etag);
      return { state: candidate, etag: written, merged };
    } catch (error) {
      if (!(error instanceof PreconditionFailed)) throw error;
      const remote = await transport.get(key);
      if (!remote) {
        // The object was deleted between the failed write and the re-read.
        etag = null;
        continue;
      }
      candidate = mergeStates(candidate, parseDocument(remote.body));
      etag = remote.etag;
      merged = true;
    }
  }
  throw new PreconditionFailed('The remote document kept changing under us.');
}

/**
 * Adopts what the account already holds. Sync was push-only, so a device learned about
 * remote changes only when it next wrote something: signing in on a second device showed
 * that device's own list and nothing else until you happened to edit something.
 *
 * Merged rather than replaced, and in both directions, because either side may be the one
 * with history. A new account has no document, in which case the local list is what the
 * account starts from.
 */
export async function pullState(
  transport: Transport,
  key: string,
  local: State,
): Promise<{ state: State; etag: string | null; adopted: boolean }> {
  const remote = await transport.get(key);
  if (!remote) return { state: local, etag: null, adopted: false };
  const merged = mergeStates(local, parseDocument(remote.body));
  return { state: merged, etag: remote.etag, adopted: true };
}

async function s3Transport(): Promise<{ transport: Transport; key: string; identityId: string } | null> {
  const bucket = import.meta.env.VITE_SYNC_BUCKET;
  const region = import.meta.env.VITE_AWS_REGION;
  if (!bucket || !region) return null;
  const session = await getCredentials();
  if (!session) return null;

  const { S3Client, GetObjectCommand, PutObjectCommand, NoSuchKey } = await import(
    '@aws-sdk/client-s3'
  );
  const client = new S3Client({ region, credentials: session.credentials });

  const transport: Transport = {
    async get(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const body = await result.Body?.transformToString();
        if (body === undefined || !result.ETag) return null;
        return { body, etag: result.ETag };
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        if (isStatus(error, 404)) return null;
        throw error;
      }
    },
    async put(key, body, ifMatch) {
      try {
        const result = await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: 'application/json',
            ...(ifMatch ? { IfMatch: ifMatch } : { IfNoneMatch: '*' }),
          }),
        );
        if (!result.ETag) throw new Error('S3 returned no ETag');
        return result.ETag;
      } catch (error) {
        if (isStatus(error, 412) || isStatus(error, 409)) {
          throw new PreconditionFailed('The remote document has moved on.');
        }
        throw error;
      }
    },
    async overwrite(key, body) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: 'application/json',
        }),
      );
    },
  };
  return { transport, key: documentKey(session.identityId), identityId: session.identityId };
}

function isStatus(error: unknown, code: number): boolean {
  const meta = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return meta?.httpStatusCode === code;
}

const LAST_SYNCED_KEY = 'lifeboard.sync.lastSyncedAt';
const ETAG_KEY = 'lifeboard.sync.etag';
/** Coalesces a burst of edits into one write. */
const DEBOUNCE_MS = 2000;

let syncState: SyncState = {
  status: 'idle',
  lastSyncedAt: readStored(LAST_SYNCED_KEY),
  error: null,
};
const listeners = new Set<(s: SyncState) => void>();
let etag: string | null = readStored(ETAG_KEY);
let pending: State | null = null;
let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;
let failures = 0;

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private browsing; the ETag is recoverable by re-reading */
  }
}

function setSyncState(next: Partial<SyncState>): void {
  syncState = { ...syncState, ...next };
  for (const listener of listeners) listener(syncState);
}

export const getSyncState = (): SyncState => syncState;

export function subscribe(listener: (s: SyncState) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Queues a push. Never awaited by the UI: the local write has already happened and the
 * remote catching up is not something the user should wait on.
 */
export function queue(state: State): void {
  pending = state;
  if (!isConfigured()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setSyncState({ status: 'offline' });
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), DEBOUNCE_MS);
}

/**
 * Runs once when a session begins: take what the account has, fold this device's list into
 * it, and write the result back so the two agree from the start.
 */
export async function adopt(): Promise<void> {
  if (running || !isConfigured()) return;
  const local = pending ?? safeLoad();
  if (!local) return;
  running = true;
  setSyncState({ status: 'syncing', error: null });
  try {
    const wired = await s3Transport();
    if (!wired) {
      setSyncState({ status: 'idle' });
      return;
    }
    const pulled = await pullState(wired.transport, wired.key, local);
    etag = pulled.etag;
    writeStored(ETAG_KEY, etag);
    if (pulled.adopted) persist(pulled.state);
    // Write the merge back, so the account holds the union rather than only one side of it.
    const result = await pushState(wired.transport, wired.key, pulled.state, etag);
    etag = result.etag;
    writeStored(ETAG_KEY, etag);
    if (result.merged) persist(result.state);
    const at = new Date().toISOString();
    writeStored(LAST_SYNCED_KEY, at);
    failures = 0;
    setSyncState({ status: 'idle', lastSyncedAt: at, error: null });
  } catch (error) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    setSyncState({
      status: offline ? 'offline' : error instanceof PreconditionFailed ? 'conflict' : 'idle',
      error: error instanceof Error ? error.message : 'Could not read the account.',
    });
  } finally {
    running = false;
  }
}

/**
 * An empty local document is never authoritative. It means one of three things: a genuinely
 * new device, storage that has been cleared, or IndexedDB failing to open, and in every one of
 * those the account is the better copy. Pushing instead of pulling is what destroyed a week of
 * work: `pushState` writes conditionally, so a device whose etag still matched replaced a
 * 62-item document with an empty one and never saw a conflict.
 */
const isEmpty = (state: State): boolean => state.items.length === 0 && state.goals.length === 0;

/**
 * The sidecar the notifier reads. Written on the same flush as the state document, and
 * deliberately never allowed to fail the sync: a notification that does not fire is a smaller
 * problem than an edit that does not save.
 */
async function writeDigest(transport: Transport, identityId: string, state: State): Promise<void> {
  try {
    const next = buildDigest(state);
    if (sameDigest(lastDigest, next)) return;
    await transport.overwrite(digestKey(identityId), JSON.stringify(next));
    lastDigest = next;
  } catch {
    /* the account still holds yesterday's digest, which the notifier can tell is stale */
  }
}

let lastDigest: Digest | null = null;

export async function flush(): Promise<void> {
  if (running || !isConfigured()) return;
  // Running on a fallback means this device does not know what it holds, so it has no business
  // writing to the account. It can still be used for the session; it just cannot speak for you.
  if (isDegraded()) {
    setSyncState({ status: 'idle', error: 'Storage is unavailable on this device, so syncing is paused.' });
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setSyncState({ status: 'offline' });
    return;
  }
  const local = pending ?? safeLoad();
  if (!local) return;
  pending = null;
  running = true;
  setSyncState({ status: 'syncing', error: null });

  try {
    const wired = await s3Transport();
    if (!wired) {
      setSyncState({ status: 'idle' });
      return;
    }
    if (isEmpty(local)) {
      // Take what the account has rather than writing over it. If the account is empty too,
      // there is nothing to lose and the push below is harmless.
      const remote = await pullState(wired.transport, wired.key, local);
      if (remote.adopted && !isEmpty(remote.state)) {
        etag = remote.etag;
        writeStored(ETAG_KEY, etag);
        persist(remote.state);
        const recovered = new Date().toISOString();
        writeStored(LAST_SYNCED_KEY, recovered);
        failures = 0;
        setSyncState({ status: 'idle', lastSyncedAt: recovered, error: null });
        return;
      }
    }

    const result = await pushState(wired.transport, wired.key, local, etag);
    etag = result.etag;
    writeStored(ETAG_KEY, etag);
    // A merge means the remote held items this device did not, so adopt the result.
    if (result.merged) persist(result.state);
    await writeDigest(wired.transport, wired.identityId, result.state);

    const at = new Date().toISOString();
    writeStored(LAST_SYNCED_KEY, at);
    failures = 0;
    setSyncState({ status: 'idle', lastSyncedAt: at, error: null });
    if (pending) queue(pending);
  } catch (error) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    setSyncState({
      status: offline ? 'offline' : error instanceof PreconditionFailed ? 'conflict' : 'idle',
      error: error instanceof Error ? error.message : 'Sync failed.',
    });
    // Keep the edit so the next attempt retries it rather than dropping it. Backed off,
    // because retrying a hard failure every two seconds is how you get rate limited.
    pending ??= local;
    failures += 1;
    if (!offline) {
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), Math.min(60_000, DEBOUNCE_MS * 2 ** failures));
    }
  } finally {
    running = false;
  }
}

function safeLoad(): State | null {
  try {
    return load();
  } catch {
    return null;
  }
}

/**
 * Wires sync to persistence and to connectivity. Idempotent, and a no-op when the
 * environment has no Cognito configuration.
 */
export function startSync(): () => void {
  if (started) return () => undefined;
  started = true;

  const stopPersist = onPersist(queue);
  const online = () => {
    failures = 0;
    setSyncState({ status: 'idle' });
    void flush();
  };
  const offline = () => setSyncState({ status: 'offline' });
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  const stopAuth = subscribeAuth((auth) => {
    // Pull before push on sign-in. Pushing first would send this device's list up and only
    // discover the account's existing one on a conflict, which is the same convergence by a
    // longer route and looks like data loss in the meantime.
    if (auth.status === 'signed-in') void adopt();
    if (auth.status === 'signed-out') {
      etag = null;
      writeStored(ETAG_KEY, null);
    }
  });

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setSyncState({ status: 'offline' });
  } else {
    // Reconcile at launch so another device's edits arrive without waiting for one here.
    void flush();
  }

  return () => {
    started = false;
    stopPersist();
    stopAuth();
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
    clearTimeout(timer);
  };
}

export function useSync(): SyncState & { syncNow: () => void } {
  const [current, setCurrent] = useState(syncState);
  useEffect(() => subscribe(setCurrent), []);
  return { ...current, syncNow: () => void flush() };
}
