/**
 * Brain dump parsing. The browser sends free text plus a compact index of what
 * already exists; a Lambda holding the Anthropic API key returns drafted items.
 *
 * Two rules shape everything here. Drafts never commit: this module returns plain
 * data and the caller decides what reaches the store. And every failure degrades to
 * the raw text in a single draft title, because a capture surface that loses what you
 * said is worse than one that never parsed it.
 */
import type { Category, Day, Item } from '../types';
import { CATEGORY_KEYS } from './categories';
import { today } from './dates';

/** A drafted item, before the user has accepted anything. Nulls mean "you decide". */
export interface Draft {
  title: string;
  /** Null when the model returned a category the user's list does not hold. */
  category: Category | null;
  description: string;
  act: Day | null;
  due: Day | null;
  buy: boolean;
  cost: number | null;
}

export type CaptureOutcome =
  | { kind: 'parsed'; drafts: Draft[] }
  /** Parsing was unavailable or unusable. `drafts` holds the raw text, unedited. */
  | { kind: 'fallback'; drafts: Draft[]; reason: string };

/** Titles and dates only. Never descriptions or notes: this leaves the device. */
export interface IndexEntry {
  title: string;
  act: Day | null;
  due: Day | null;
}

const ENDPOINT_KEY = 'VITE_CAPTURE_ENDPOINT';
const TOKEN_KEY = 'lifeboard.auth';
const TIMEOUT_MS = 20_000;
/** Enough context to resolve "before the insurance renews" without paying for the lot. */
export const INDEX_LIMIT = 60;
const MAX_TRANSCRIPT = 4000;

export function readEndpoint(): string | null {
  const raw = (import.meta.env as Record<string, string | undefined>)[ENDPOINT_KEY];
  if (!raw) return null;
  return raw.replace(/\/$/, '');
}

/**
 * Whether parsing is wired up at all. With no endpoint the whole surface should be
 * hidden rather than offered and then failing: an unconfigured feature is invisible.
 */
export const captureConfigured = (): boolean => readEndpoint() !== null;

/**
 * The signed-in user's identity token. Read straight from the key `auth.ts` writes,
 * because `auth.ts` exposes AWS credentials but not the raw token and is owned
 * elsewhere. Swap this for an exported accessor when one exists.
 */
export function readIdToken(): string | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { idToken?: unknown };
    return typeof parsed.idToken === 'string' ? parsed.idToken : null;
  } catch {
    return null;
  }
}

/**
 * The live list, nearest action first, trimmed to titles and dates. Dated items come
 * first because those are what a relative reference can anchor to.
 */
export function buildIndex(items: Item[], limit = INDEX_LIMIT): IndexEntry[] {
  return items
    .filter((i) => i.status === 'todo' || i.status === 'doing')
    .sort((a, b) => (a.act ?? '9999-12-31').localeCompare(b.act ?? '9999-12-31'))
    .slice(0, limit)
    .map((i) => ({ title: i.title, act: i.act, due: i.due }));
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function asDay(value: unknown): Day | null {
  return typeof value === 'string' && DAY.test(value) ? value : null;
}

/**
 * Leaving this null is the honest answer. Coercing an unrecognised category to a real
 * one puts an item somewhere the user never said, which is the failure the prompt is
 * written to avoid.
 */
function asCategory(value: unknown, allowed: Category[]): Category | null {
  return allowed.includes(value as Category) ? (value as Category) : null;
}

function asCost(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Validates one drafted item. Anything unrecognised becomes empty rather than a
 * guess: the model is told to leave fields blank when unsure and this enforces it on
 * the way in. Returns null when there is no usable title.
 */
export function toDraft(value: unknown, allowed: Category[] = CATEGORY_KEYS): Draft | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const title = typeof v.title === 'string' ? v.title.trim() : '';
  if (!title) return null;
  return {
    title,
    category: asCategory(v.category, allowed),
    description: typeof v.description === 'string' ? v.description.trim() : '',
    act: asDay(v.act),
    due: asDay(v.due),
    buy: v.buy === true,
    cost: asCost(v.cost),
  };
}

export function parseResponse(body: unknown, allowed: Category[] = CATEGORY_KEYS): Draft[] {
  if (typeof body !== 'object' || body === null) return [];
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.map((i) => toDraft(i, allowed)).filter((d): d is Draft => d !== null);
}

/** The degraded path. One draft, the text verbatim, every field left for the user. */
export function transcriptFallback(text: string, reason: string): CaptureOutcome {
  const title = text.trim().slice(0, 200);
  return {
    kind: 'fallback',
    reason,
    drafts: title
      ? [{ title, category: null, description: '', act: null, due: null, buy: false, cost: null }]
      : [],
  };
}

/**
 * Sends the dump for parsing. Never throws and never rejects: an unreachable or
 * unconfigured service is a degraded capture, not an error the caller has to handle.
 */
export async function parseCapture(
  text: string,
  items: Item[],
  options: {
    signal?: AbortSignal;
    token?: string | null;
    /** The user's live category ids. Defaults to the built-ins for callers without a store. */
    categories?: Category[];
  } = {},
): Promise<CaptureOutcome> {
  const allowed = options.categories ?? CATEGORY_KEYS;
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'parsed', drafts: [] };

  const endpoint = readEndpoint();
  if (!endpoint) return transcriptFallback(trimmed, 'Parsing is not configured in this build.');

  const token = options.token ?? readIdToken();
  if (!token) return transcriptFallback(trimmed, 'Sign in to have a dump split into items.');

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const onOuterAbort = () => timeout.abort();
  options.signal?.addEventListener('abort', onOuterAbort);

  try {
    const response = await fetch(`${endpoint}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        text: trimmed.slice(0, MAX_TRANSCRIPT),
        // The local day, not the UTC one. "Tomorrow" said at half past midnight under
        // BST resolves a day early otherwise, which is the bug the rest of the app
        // already anchors dates at local noon to avoid.
        today: today(),
        categories: allowed,
        existing: buildIndex(items),
      }),
      signal: timeout.signal,
    });

    if (!response.ok) {
      return transcriptFallback(trimmed, `Parsing service returned ${response.status}.`);
    }
    const drafts = parseResponse(await response.json(), allowed);
    if (drafts.length === 0) {
      return transcriptFallback(trimmed, 'Parsing returned nothing usable.');
    }
    return { kind: 'parsed', drafts };
  } catch {
    // Network failure, timeout, or a body that was not JSON. All the same to the user.
    return transcriptFallback(trimmed, 'Parsing service could not be reached.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}
