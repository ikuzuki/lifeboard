import type { State } from '../types';
import { KEY as LEGACY_KEY, StateCorruptError, isState, migrate } from '../store';
import { empty } from '../seed';

/**
 * IndexedDB is the source of truth. localStorage has a small quota and browsers evict
 * it under pressure, which for a local-first app with no server is data loss.
 *
 * The exported surface deliberately matches the localStorage one it replaces, so the
 * only integration change is `await initStorage()` before the first render.
 */

const DB_NAME = 'lifeboard';
const DB_VERSION = 1;
const STORE = 'state';
const RECORD = 'current';

export { LEGACY_KEY };

let dbPromise: Promise<IDBDatabase> | null = null;
let cache: State | null = null;
let initError: Error | null = null;
let writes: Promise<unknown> = Promise.resolve();
/** Set when IndexedDB will not open at all, as in some private browsing modes. */
let degraded = false;

type PersistListener = (state: State) => void;
const listeners = new Set<PersistListener>();

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB could not be opened'));
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
  return dbPromise;
}

async function readRecord(): Promise<unknown> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  return request(tx.objectStore(STORE).get(RECORD));
}

async function writeRecord(value: State): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  await request(tx.objectStore(STORE).put(value, RECORD));
}

async function deleteRecord(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  await request(tx.objectStore(STORE).delete(RECORD));
}

/** Validation and migration are shared with the legacy path so behaviour cannot drift. */
function accept(parsed: unknown): State {
  if (!isState(parsed)) throw new StateCorruptError('Saved data is not in the expected shape.');
  return migrate(parsed);
}

/** The localStorage state, or null when the key was never written. */
export function readLegacy(): State | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A key existed and we could not read it. Halt rather than silently overwrite.
    throw new StateCorruptError('Saved data could not be read.');
  }
  return accept(parsed);
}

/**
 * Reads IndexedDB, migrating any localStorage state on first run. The old key is left
 * in place as a backup: a one-way move that fails halfway would take the only copy.
 */
export async function initStorage(): Promise<State> {
  initError = null;
  degraded = false;
  try {
    const record = await readRecord();
    if (record !== undefined) {
      cache = accept(record);
      return cache;
    }
    const legacy = readLegacy();
    const state = legacy ?? empty();
    cache = state;
    await writeRecord(state);
    return state;
  } catch (error) {
    // Corrupt data must surface, not reseed. A storage engine that will not open is a
    // different failure: the app can still run for the session on seeded state.
    if (error instanceof StateCorruptError) {
      initError = error;
      throw error;
    }
    degraded = true;
    cache = readLegacyQuietly() ?? empty();
    return cache;
  }
}

/** True when writes are falling back to localStorage because IndexedDB would not open. */
export const isDegraded = (): boolean => degraded;

function readLegacyQuietly(): State | null {
  try {
    return readLegacy();
  } catch (error) {
    if (error instanceof StateCorruptError) {
      initError = error;
      throw error;
    }
    return null;
  }
}

/** Synchronous by design: `initStorage()` has already done the asynchronous work. */
export function load(): State {
  if (initError) throw initError;
  if (cache) return cache;
  // Reached only if a caller renders before initStorage resolves. Seeding here would
  // overwrite real data on the next persist, so refuse instead.
  throw new Error('initStorage() must resolve before load()');
}

export function persist(state: State): void {
  cache = state;
  if (degraded) {
    try {
      localStorage.setItem(LEGACY_KEY, JSON.stringify(state));
    } catch {
      /* quota or private browsing; the app still works for this session */
    }
  } else {
    writes = writes.then(() => writeRecord(state)).catch(() => undefined);
  }
  for (const listener of listeners) listener(state);
}

/** Fires after every persist. Sync uses this rather than App having to call it. */
export function onPersist(listener: PersistListener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Resolves once every queued write has landed. */
export function flushWrites(): Promise<unknown> {
  return writes;
}

export function exportState(): string {
  if (!cache) {
    try {
      return localStorage.getItem(LEGACY_KEY) ?? '{}';
    } catch {
      return '{}';
    }
  }
  return JSON.stringify(cache, null, 2);
}

/**
 * Clears both stores. Leaving the legacy key would resurrect the same data, and the
 * only caller is a deliberate reset behind a confirmation.
 */
export function clearState(): void {
  cache = null;
  initError = null;
  writes = writes.then(deleteRecord).catch(() => undefined);
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* nothing useful to do */
  }
}

/** Closes the connection and drops every piece of in-memory state. */
export async function closeStorage(): Promise<void> {
  const open = dbPromise;
  dbPromise = null;
  cache = null;
  initError = null;
  degraded = false;
  writes = Promise.resolve();
  listeners.clear();
  try {
    (await open)?.close();
  } catch {
    /* it never opened, so there is nothing to close */
  }
}

/** Ask the browser not to evict the store under storage pressure. */
export function requestPersistence(): void {
  void navigator.storage?.persist?.().catch(() => undefined);
}

/** Parses and validates a user-supplied export. Throws `StateCorruptError` if it is not one. */
export function parseImport(text: string): State {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StateCorruptError('That file is not valid JSON.');
  }
  return accept(parsed);
}

export { StateCorruptError };
