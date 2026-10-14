import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PreconditionFailed,
  documentKey,
  getSyncState,
  mergeStates,
  pullState,
  pushState,
  queue,
  type Transport,
} from './sync';
import { newItem } from '../store';
import type { Item, State } from '../types';

/** Nothing here touches the network. Every remote is an in-memory fake. */

const state = (items: Item[] = [], version = 4): State => ({ items, goals: [], version, reviewDeferredOn: null });

const at = (item: Item, updatedAt: string): Item => ({ ...item, updatedAt });

function stubStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  });
}

/** A one-document S3 stand-in with real ETag semantics, including the 412. */
function fakeRemote(initial?: { body: string; etag: string }) {
  let stored = initial ?? null;
  let version = initial ? 1 : 0;
  const puts: (string | null)[] = [];

  const transport: Transport = {
    get: (_key) => Promise.resolve(stored ? { ...stored } : null),
    put: (_key, body, ifMatch) => {
      puts.push(ifMatch);
      const matches = stored ? ifMatch === stored.etag : ifMatch === null;
      if (!matches) return Promise.reject(new PreconditionFailed('etag mismatch'));
      version += 1;
      stored = { body, etag: `"v${version}"` };
      return Promise.resolve(stored.etag);
    },
    overwrite: (_key, body) => {
      version += 1;
      stored = { body, etag: `"v${version}"` };
      return Promise.resolve();
    },
  };

  return {
    transport,
    puts,
    /** Simulates the other device writing while this one was mid-flight. */
    overwrite(body: string) {
      version += 1;
      stored = { body, etag: `"v${version}"` };
    },
    read: () => stored,
  };
}

beforeEach(stubStorage);

describe('documentKey', () => {
  it('is one document per identity', () => {
    expect(documentKey('eu-west-2:abc')).toBe('users/eu-west-2:abc/state.json');
  });
});

describe('mergeStates', () => {
  it('keeps both edits when two devices touch different items', () => {
    const shared = [
      at(newItem({ id: 'a', title: 'Book the ferry' }), '2026-08-17T09:00:00.000Z'),
      at(newItem({ id: 'b', title: 'Renew the insurance' }), '2026-08-17T09:00:00.000Z'),
    ];

    const phone = state([
      at({ ...shared[0], status: 'done' }, '2026-08-17T10:00:00.000Z'),
      shared[1],
    ]);
    const laptop = state([
      shared[0],
      at({ ...shared[1], act: '2026-09-01' }, '2026-08-17T10:30:00.000Z'),
    ]);

    const merged = mergeStates(phone, laptop);
    expect(merged.items).toHaveLength(2);
    expect(merged.items.find((i) => i.id === 'a')?.status).toBe('done');
    expect(merged.items.find((i) => i.id === 'b')?.act).toBe('2026-09-01');
  });

  it('takes the later edit when both devices touched the same item', () => {
    const base = newItem({ id: 'a', title: 'Original' });
    const older = state([at({ ...base, title: 'Phone' }, '2026-08-17T10:00:00.000Z')]);
    const newest = state([at({ ...base, title: 'Laptop' }, '2026-08-17T11:00:00.000Z')]);

    expect(mergeStates(older, newest).items[0].title).toBe('Laptop');
    expect(mergeStates(newest, older).items[0].title).toBe('Laptop');
  });

  it('resolves an exact tie to local, so the device in your hand wins', () => {
    const base = newItem({ id: 'a', title: 'Original' });
    const local = state([at({ ...base, title: 'Local' }, '2026-08-17T10:00:00.000Z')]);
    const remote = state([at({ ...base, title: 'Remote' }, '2026-08-17T10:00:00.000Z')]);
    expect(mergeStates(local, remote).items[0].title).toBe('Local');
  });

  it('unions items only one side has ever seen', () => {
    const local = state([newItem({ id: 'a', title: 'Only local' })]);
    const remote = state([newItem({ id: 'b', title: 'Only remote' })]);
    expect(mergeStates(local, remote).items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('carries the higher version forward', () => {
    expect(mergeStates(state([], 4), state([], 5)).version).toBe(5);
  });
});

describe('the same starter item on two devices', () => {
  it('merges to one record rather than accumulating a copy per device', async () => {
    // Four browsers signing in left the account holding four of everything, because the seed
    // gave each install fresh random ids and the merge unions on id.
    const { seed } = await import('../seed');
    const a = seed();
    const b = seed();

    const merged = mergeStates(a, b);

    expect(merged.items).toHaveLength(a.items.length);
    const ids = new Set(merged.items.map((i) => i.id));
    expect(ids.size).toBe(merged.items.length);
  });
});

describe('pullState', () => {
  it('adopts the account document and folds the local list into it', async () => {
    // Sync used to be push-only, so signing in on a second device showed that device's own
    // list and learned about the account's only when it next happened to write.
    const mine = at(newItem({ title: 'Only on this device' }), '2026-08-18T10:00:00.000Z');
    const theirs = at(newItem({ title: 'Already in the account' }), '2026-08-18T09:00:00.000Z');
    const remote = fakeRemote({ body: JSON.stringify(state([theirs])), etag: 'e1' });

    const result = await pullState(remote.transport, 'k', state([mine]));

    expect(result.adopted).toBe(true);
    expect(result.etag).toBe('e1');
    expect(result.state.items.map((i) => i.title).sort()).toEqual([
      'Already in the account',
      'Only on this device',
    ]);
  });

  it('keeps the newer copy of an item the two disagree about', async () => {
    const base = newItem({ title: 'Book the dentist' });
    const older = at({ ...base, title: 'Stale' }, '2026-08-01T00:00:00.000Z');
    const newer = at({ ...base, title: 'Current' }, '2026-08-18T00:00:00.000Z');
    const remote = fakeRemote({ body: JSON.stringify(state([older])), etag: 'e1' });

    const result = await pullState(remote.transport, 'k', state([newer]));

    expect(result.state.items).toHaveLength(1);
    expect(result.state.items[0].title).toBe('Current');
  });

  it('treats a new account as starting from this device', async () => {
    const mine = newItem({ title: 'Mine' });
    const empty = fakeRemote();

    const result = await pullState(empty.transport, 'k', state([mine]));

    expect(result.adopted).toBe(false);
    expect(result.etag).toBeNull();
    expect(result.state.items.map((i) => i.title)).toEqual(['Mine']);
  });
});

describe('pushState', () => {
  it('writes with no ETag when the document does not exist yet', async () => {
    const remote = fakeRemote();
    const local = state([newItem({ id: 'a', title: 'First' })]);

    const result = await pushState(remote.transport, 'users/x/state.json', local, null);

    expect(remote.puts).toEqual([null]);
    expect(result.merged).toBe(false);
    expect(result.etag).toBe('"v1"');
    expect(JSON.parse(remote.read()!.body).items[0].title).toBe('First');
  });

  it('sends the ETag from the last read on a subsequent write', async () => {
    const remote = fakeRemote();
    const local = state([newItem({ id: 'a', title: 'First' })]);

    const first = await pushState(remote.transport, 'k', local, null);
    await pushState(remote.transport, 'k', local, first.etag);

    expect(remote.puts).toEqual([null, '"v1"']);
  });

  it('re-reads and merges rather than clobbering on a 412', async () => {
    const phoneItem = at(newItem({ id: 'a', title: 'Phone edit' }), '2026-08-17T10:00:00.000Z');
    const laptopItem = at(newItem({ id: 'b', title: 'Laptop edit' }), '2026-08-17T10:30:00.000Z');

    // This device last saw v1. The other device has since written v2.
    const remote = fakeRemote({ body: JSON.stringify(state([])), etag: '"v1"' });
    remote.overwrite(JSON.stringify(state([laptopItem])));

    const result = await pushState(remote.transport, 'k', state([phoneItem]), '"v1"');

    expect(remote.puts).toEqual(['"v1"', '"v2"']);
    expect(result.merged).toBe(true);
    const written = JSON.parse(remote.read()!.body) as State;
    expect(written.items.map((i) => i.title).sort()).toEqual(['Laptop edit', 'Phone edit']);
    expect(result.state.items).toHaveLength(2);
  });

  it('gives up rather than looping when the remote keeps moving', async () => {
    const transport: Transport = {
      get: () => Promise.resolve({ body: JSON.stringify(state([])), etag: '"moving"' }),
      put: () => Promise.reject(new PreconditionFailed('again')),
      overwrite: () => Promise.resolve(),
    };

    await expect(pushState(transport, 'k', state([]), '"stale"', 2)).rejects.toThrow(
      PreconditionFailed,
    );
  });

  it('starts over without an ETag when the document was deleted under it', async () => {
    let deleted = true;
    const remote = fakeRemote();
    const transport: Transport = {
      get: () => Promise.resolve(deleted ? null : remote.read()),
      put: (key, body, ifMatch) => {
        if (ifMatch !== null) return Promise.reject(new PreconditionFailed('gone'));
        deleted = false;
        return remote.transport.put(key, body, null);
      },
      overwrite: () => Promise.resolve(),
    };

    const result = await pushState(transport, 'k', state([]), '"stale"');
    expect(result.etag).toBe('"v1"');
  });

  it('refuses a remote document of the wrong shape instead of merging rubbish', async () => {
    const transport: Transport = {
      get: () => Promise.resolve({ body: '{"items":"nope"}', etag: '"v2"' }),
      put: () => Promise.reject(new PreconditionFailed('conflict')),
      overwrite: () => Promise.resolve(),
    };

    await expect(pushState(transport, 'k', state([]), '"v1"')).rejects.toThrow(
      /not in the expected shape/,
    );
  });

  it('propagates a transport failure that is not a conflict', async () => {
    const transport: Transport = {
      get: () => Promise.resolve(null),
      put: () => Promise.reject(new Error('AccessDenied')),
      overwrite: () => Promise.resolve(),
    };

    await expect(pushState(transport, 'k', state([]), null)).rejects.toThrow('AccessDenied');
  });
});

describe('an empty device never overwrites the account', () => {
  it('adopts what the account holds instead of pushing emptiness over it', async () => {
    // What actually happened: a device came up empty, `pushState` wrote conditionally with a
    // matching etag, and a 62-item document became a 427-byte one with no conflict raised.
    const theirs = [newItem({ title: 'Ring the dentist' }), newItem({ title: 'Swim trunks' })];
    const remote = fakeRemote({ body: JSON.stringify(state(theirs)), etag: 'e1' });

    const result = await pullState(remote.transport, 'k', state([]));

    expect(result.adopted).toBe(true);
    expect(result.state.items.map((i) => i.title).sort()).toEqual(['Ring the dentist', 'Swim trunks']);
  });

  it('still lets a genuinely empty account stay empty', async () => {
    const remote = fakeRemote();
    const result = await pullState(remote.transport, 'k', state([]));

    expect(result.adopted).toBe(false);
    expect(result.state.items).toEqual([]);
  });
});

describe('the offline queue', () => {
  it('reports offline and holds the edit rather than blocking', () => {
    vi.stubEnv('VITE_AWS_REGION', 'eu-west-2');
    vi.stubEnv('VITE_COGNITO_USER_POOL_ID', 'eu-west-2_test');
    vi.stubEnv('VITE_COGNITO_USER_POOL_CLIENT_ID', 'client');
    vi.stubEnv('VITE_COGNITO_DOMAIN', 'https://example.auth.eu-west-2.amazoncognito.com');
    vi.stubEnv('VITE_COGNITO_IDENTITY_POOL_ID', 'eu-west-2:pool');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    queue(state([newItem({ title: 'Written on a train' })]));

    expect(getSyncState().status).toBe('offline');
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('stays idle when nothing is configured, so sync is simply inactive', () => {
    queue(state([newItem({ title: 'No account' })]));
    expect(getSyncState().status).not.toBe('syncing');
  });
});

describe('mergeStates field preservation', () => {
  it('keeps fields it has no merge rule for, rather than dropping them', () => {
    // The merge used to name its keys, so every field added to State later vanished
    // on the first sync. Anything unrecognised must survive as local-wins.
    const local = { version: 4, items: [], goals: [], future: ['kept'] } as never;
    const remote = { version: 4, items: [], goals: [] } as never;
    expect((mergeStates(local, remote) as unknown as { future: string[] }).future).toEqual(['kept']);
  });
});
