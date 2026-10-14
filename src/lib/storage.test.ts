import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VERSION } from '../store';
import {
  LEGACY_KEY,
  clearState,
  closeStorage,
  exportState,
  flushWrites,
  initStorage,
  load,
  onPersist,
  parseImport,
  persist,
} from './storage';
import { StateCorruptError, newItem } from '../store';
import type { State } from '../types';

const state = (items: State['items'] = []): State => ({
  items,
  goals: [],
  version: 4,
  reviewDeferredOn: null,
});

/**
 * Deliberately does not resolve on `blocked`. A close does not take effect until the
 * transactions behind it finish, and resolving early left the previous test's data in
 * place and made the next one pass or fail on ordering.
 */
function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('lifeboard');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

/** Minimal in-memory store. The environment provides no usable `localStorage` global. */
function stubStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  });
}

beforeEach(async () => {
  stubStorage();
  await closeStorage();
  await deleteDatabase();
});

afterEach(async () => {
  await flushWrites();
  await closeStorage();
});

describe('IndexedDB round trip', () => {
  it('starts empty on a first run and writes that through', async () => {
    // It used to start with the starter list. A new user saw two dozen plausible tasks with
    // nothing saying they were examples, and the first person shared with reasonably concluded
    // she was looking at someone else's data. Categories still come with defaults: nobody
    // mistakes "Admin" for a stranger's errand, and colour is the app's main encoding.
    const first = await initStorage();
    expect(first.items).toEqual([]);
    expect(first.goals).toEqual([]);
    expect(first.categories?.length).toBeGreaterThan(0);
    await flushWrites();

    await closeStorage();
    const second = await initStorage();
    expect(second.items).toEqual([]);
    expect(second.categories).toEqual(first.categories);
  });

  it('reads back exactly what was persisted', async () => {
    await initStorage();
    const item = newItem({ title: 'Book the ferry', act: '2026-09-01' });
    persist(state([item]));
    await flushWrites();

    await closeStorage();
    const reloaded = await initStorage();
    expect(reloaded.items).toHaveLength(1);
    expect(reloaded.items[0].title).toBe('Book the ferry');
    expect(reloaded.items[0].act).toBe('2026-09-01');
  });

  it('serves load() synchronously once init has resolved', async () => {
    await initStorage();
    const item = newItem({ title: 'Cached' });
    persist(state([item]));
    expect(load().items[0].title).toBe('Cached');
  });

  it('refuses to load before init rather than guessing', () => {
    expect(() => load()).toThrow();
  });

  it('notifies persist listeners', async () => {
    await initStorage();
    const seen: string[] = [];
    const stop = onPersist((s) => seen.push(String(s.items.length)));
    persist(state([newItem({ title: 'One' })]));
    stop();
    persist(state([]));
    expect(seen).toEqual(['1']);
  });
});

describe('localStorage migration', () => {
  const legacy = {
    version: 3,
    goals: [],
    items: [
      {
        id: 'a',
        title: 'Kept',
        kind: 'buy',
        // An instant written at local midnight under BST, the previous day in UTC.
        act: '2026-08-16T23:00:00.000Z',
        due: null,
        unblocks: null,
        blockedBy: null,
        contact: null,
        description: '',
        notes: [],
        cost: 10,
        phase: 1,
        status: 'todo',
        order: 0,
        createdAt: '2026-08-16T00:00:00.000Z',
        doneAt: null,
      },
    ],
  };

  it('moves existing localStorage state into IndexedDB and migrates it', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    const migrated = await initStorage();

    expect(migrated.version).toBe(VERSION);
    expect(migrated.items).toHaveLength(1);
    expect(migrated.items[0].title).toBe('Kept');
    expect(migrated.items[0].buy).toBe(true);
    expect(migrated.items[0].act).toBe('2026-08-17');
    // Nothing else can date pre-timestamp data, so creation is the honest answer.
    expect(migrated.items[0].updatedAt).toBe('2026-08-16T00:00:00.000Z');
  });

  it('leaves the old key in place as a backup', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    await initStorage();
    await flushWrites();
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it('does not migrate again once IndexedDB holds data', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    await initStorage();
    await flushWrites();

    await closeStorage();
    persistDirect();
    const second = await initStorage();
    expect(second.items.map((i) => i.title)).toEqual(['Kept']);

    function persistDirect() {
      // The backup key now disagrees with IndexedDB. IndexedDB must still win.
      localStorage.setItem(
        LEGACY_KEY,
        JSON.stringify({ ...legacy, items: [{ ...legacy.items[0], title: 'Stale' }] }),
      );
    }
  });

  it('refuses to silently replace unreadable legacy data with the seed', async () => {
    localStorage.setItem(LEGACY_KEY, '{ not json');
    await expect(initStorage()).rejects.toThrow(StateCorruptError);
  });

  it('refuses legacy data of the wrong shape', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ items: 'nope', goals: [], version: 4 }));
    await expect(initStorage()).rejects.toThrow(StateCorruptError);
  });

  it('keeps throwing from load() after a corrupt init', async () => {
    localStorage.setItem(LEGACY_KEY, '{ not json');
    await expect(initStorage()).rejects.toThrow(StateCorruptError);
    expect(() => load()).toThrow(StateCorruptError);
  });
});

describe('export, import and reset', () => {
  it('exports the live state as JSON', async () => {
    await initStorage();
    persist(state([newItem({ title: 'Exported' })]));
    expect(JSON.parse(exportState()).items[0].title).toBe('Exported');
  });

  it('validates an import and rejects anything else', () => {
    const good = JSON.stringify(state([newItem({ title: 'Fine' })]));
    expect(parseImport(good).items[0].title).toBe('Fine');
    expect(() => parseImport('nonsense')).toThrow(StateCorruptError);
    expect(() => parseImport('{"items":[],"goals":[]}')).toThrow(StateCorruptError);
  });

  it('clears both stores on reset, so the backup cannot resurrect the data', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(state([newItem({ title: 'Old' })])));
    await initStorage();
    await flushWrites();

    clearState();
    await flushWrites();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();

    await closeStorage();
    const fresh = await initStorage();
    expect(fresh.items.some((i) => i.title === 'Old')).toBe(false);
  });
});
