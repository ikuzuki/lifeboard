import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildIndex, parseCapture, parseResponse, toDraft, transcriptFallback } from './capture';
import { newItem } from '../store';
import type { Item } from '../types';

/** The model is never called here. Every response is a fake and fetch is stubbed. */

const ENDPOINT = 'https://capture.example.test';

function stubStorage(token: string | null) {
  const map = new Map<string, string>();
  if (token !== null) map.set('lifeboard.auth', JSON.stringify({ idToken: token, expiresAt: 0 }));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  });
}

/** One fake HTTP response, so a test states only the part it cares about. */
function stubFetch(reply: { status?: number; body?: unknown; throws?: boolean }) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (reply.throws) return Promise.reject(new Error('network down'));
    return Promise.resolve({
      ok: (reply.status ?? 200) < 400,
      status: reply.status ?? 200,
      json: () =>
        reply.body === undefined
          ? Promise.reject(new SyntaxError('not json'))
          : Promise.resolve(reply.body),
    });
  });
  return calls;
}

const item = (title: string, patch: Partial<Item> = {}): Item => newItem({ title, ...patch });

beforeEach(() => {
  vi.stubEnv('VITE_CAPTURE_ENDPOINT', ENDPOINT);
  stubStorage('token-abc');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('the parsing contract', () => {
  it('maps a well-formed response to drafts', async () => {
    stubFetch({
      body: {
        items: [
          {
            title: 'book the dentist',
            category: 'health',
            description: 'the one on the high street',
            act: '2026-08-20',
            due: '2026-08-29',
            buy: false,
            cost: null,
          },
          {
            title: 'buy a shoehorn',
            category: 'home',
            description: '',
            act: null,
            due: null,
            buy: true,
            cost: 8.5,
          },
        ],
      },
    });

    const result = await parseCapture('dentist and a shoehorn', []);

    expect(result.kind).toBe('parsed');
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[0]).toEqual({
      title: 'book the dentist',
      category: 'health',
      description: 'the one on the high street',
      act: '2026-08-20',
      due: '2026-08-29',
      buy: false,
      cost: null,
    });
    expect(result.drafts[1].buy).toBe(true);
    expect(result.drafts[1].cost).toBe(8.5);
  });

  it('sends the ID token as a bearer credential and posts to /capture', async () => {
    const calls = stubFetch({ body: { items: [{ title: 'x' }] } });

    await parseCapture('something', []);

    expect(calls[0].url).toBe(`${ENDPOINT}/capture`);
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer token-abc');
  });

  it('anchors the model on the local day, not the UTC one', async () => {
    // Half past midnight local during BST: the UTC date is still yesterday, and
    // sending it would resolve "tomorrow" a day early.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T00:30:00+01:00'));
    const calls = stubFetch({ body: { items: [{ title: 'x' }] } });

    await parseCapture('do it tomorrow', []);

    expect(JSON.parse(calls[0].init.body as string).today).toBe('2026-08-17');
    vi.useRealTimers();
  });

  it('keeps a field empty rather than accepting a value it cannot read', () => {
    // A date the model phrased rather than formatted is exactly the case that must
    // not reach the store. Nothing here is repaired or guessed.
    const draft = toDraft({
      title: '  chase the refund  ',
      category: 'not-a-category',
      description: 42,
      act: 'next week',
      due: '2026-13-99x',
      buy: 'yes',
      cost: -3,
    });

    expect(draft).toEqual({
      title: 'chase the refund',
      category: null,
      description: '',
      act: null,
      due: null,
      buy: false,
      cost: null,
    });
  });

  it('drops items with no usable title', () => {
    const drafts = parseResponse({ items: [{ title: '   ' }, { title: 'real one' }, 7, null] });
    expect(drafts.map((d) => d.title)).toEqual(['real one']);
  });

  it('sends titles and dates only, never descriptions or notes', () => {
    const items = [
      item('renew the insurance', {
        act: '2026-09-01',
        due: '2026-09-14',
        description: 'policy number 12345, private',
        notes: [{ at: '2026-08-01T00:00:00.000Z', text: 'rang them, private' }],
      }),
    ];

    const index = buildIndex(items);

    expect(index).toEqual([{ title: 'renew the insurance', act: '2026-09-01', due: '2026-09-14' }]);
    expect(JSON.stringify(index)).not.toContain('12345');
    expect(JSON.stringify(index)).not.toContain('rang them');
  });

  it('indexes live items nearest first and leaves finished ones out', () => {
    const items = [
      item('later', { act: '2026-12-01' }),
      item('undated'),
      item('sooner', { act: '2026-08-18' }),
      item('finished', { act: '2026-08-01', status: 'done' }),
    ];

    expect(buildIndex(items).map((e) => e.title)).toEqual(['sooner', 'later', 'undated']);
  });
});

describe('the malformed-response path', () => {
  it('falls back when the body is not JSON', async () => {
    stubFetch({});
    const result = await parseCapture('dentist and a shoehorn', []);
    expect(result.kind).toBe('fallback');
    expect(result.drafts[0].title).toBe('dentist and a shoehorn');
  });

  it('falls back when items is missing or the wrong shape', async () => {
    stubFetch({ body: { drafts: [] } });
    const result = await parseCapture('one thing', []);
    expect(result.kind).toBe('fallback');
    expect(result).toHaveProperty('reason');
  });

  it('falls back when every item is unusable, rather than adding nothing', async () => {
    stubFetch({ body: { items: [{ title: '' }, { nope: true }] } });
    const result = await parseCapture('one thing', []);
    expect(result.kind).toBe('fallback');
    expect(result.drafts).toHaveLength(1);
  });
});

describe('the unavailable-service path', () => {
  it('falls back when the network fails', async () => {
    stubFetch({ throws: true });
    const result = await parseCapture('call the insurer', []);
    expect(result.kind).toBe('fallback');
    expect(result.drafts[0].title).toBe('call the insurer');
  });

  it('falls back on a 502, and says what happened', async () => {
    stubFetch({ status: 502, body: { error: 'parsing unavailable' } });
    const result = await parseCapture('call the insurer', []);
    expect(result.kind).toBe('fallback');
    if (result.kind === 'fallback') expect(result.reason).toContain('502');
  });

  it('never calls the endpoint when the build has none configured', async () => {
    vi.stubEnv('VITE_CAPTURE_ENDPOINT', '');
    const calls = stubFetch({ body: { items: [] } });

    const result = await parseCapture('unconfigured', []);

    expect(calls).toHaveLength(0);
    expect(result.kind).toBe('fallback');
  });

  it('never calls the endpoint when signed out', async () => {
    stubStorage(null);
    const calls = stubFetch({ body: { items: [] } });

    const result = await parseCapture('signed out', []);

    expect(calls).toHaveLength(0);
    expect(result.kind).toBe('fallback');
  });
});

describe('the transcript fallback', () => {
  it('keeps the words and leaves every judgement to the user', () => {
    const result = transcriptFallback('  ring the surgery about the appointment  ', 'service down');

    expect(result.drafts).toEqual([
      {
        title: 'ring the surgery about the appointment',
        category: null,
        description: '',
        act: null,
        due: null,
        buy: false,
        cost: null,
      },
    ]);
  });

  it('adds nothing at all for an empty dump', async () => {
    const calls = stubFetch({ body: { items: [] } });
    const result = await parseCapture('   ', []);

    expect(calls).toHaveLength(0);
    expect(result.drafts).toEqual([]);
  });
});
