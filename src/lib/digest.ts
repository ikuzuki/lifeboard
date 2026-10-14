import { addDays, daysUntil, isDaily, isLive, today } from './dates';
import type { Day, Item, State } from '../types';

/**
 * The only thing the notifier is allowed to see.
 *
 * Every field is a count or a date. Nothing here is a string anybody typed, which is what
 * lets the dispatcher's IAM be scoped to this key and never to the state document: the
 * server can say "4 missed" and has no way to say which four.
 */
export interface Digest {
  version: 1;
  /** The calendar day the counts were derived against, so staleness is derivable. */
  computedFor: Day;
  overdue: Bucket;
  /**
   * Live work by start date, `computedFor` through `computedFor + HORIZON_DAYS`, days with
   * nothing omitted. A histogram rather than pre-collapsed lanes because `pressure()`
   * depends on the date *and* on now: "starts today" is only true on the day it was
   * written, so a device left shut for a week would otherwise have the server confidently
   * announcing a Tuesday that has been and gone.
   */
  byDay: Record<Day, Bucket>;
}

/** `weekdayOnly` is a subset of `all`, not an addition, so `windowOpen` is reproducible. */
export interface Bucket {
  all: number;
  weekdayOnly: number;
}

export const DIGEST_VERSION = 1;
const HORIZON_DAYS = 21;

const bucket = (items: Item[]): Bucket => ({
  all: items.length,
  weekdayOnly: items.filter((i) => i.weekdaysOnly).length,
});

/**
 * Deliberately not `isBlocked`, which also excludes weekday-only work at a weekend. Filtering
 * that here would drop those items from a digest written on a Saturday, leaving `weekdayOnly`
 * almost always zero and the notifier unable to reproduce `windowOpen()` for whatever day it
 * actually sends on. Waiting on a date is a real wait and still excluded.
 */
const waitingOnADate = (item: Item, now: Date): boolean => {
  if (!item.unblocks) return false;
  const n = daysUntil(item.unblocks, now);
  return n !== null && n > 0;
};

/**
 * Derived from the same predicates the app uses, so the notifier and the screen cannot
 * disagree about what counts.
 */
export function buildDigest(state: State, now = new Date()): Digest {
  const from = today(now);
  const horizon = addDays(from, HORIZON_DAYS);
  const open = state.items.filter((i) => isLive(i) && isDaily(i) && !waitingOnADate(i, now));

  const byDay: Record<Day, Bucket> = {};
  for (const item of open) {
    if (item.act === null || item.act < from || item.act > horizon) continue;
    const day = item.act;
    const seen = byDay[day] ?? { all: 0, weekdayOnly: 0 };
    byDay[day] = {
      all: seen.all + 1,
      weekdayOnly: seen.weekdayOnly + (item.weekdaysOnly ? 1 : 0),
    };
  }

  return {
    version: DIGEST_VERSION,
    computedFor: from,
    overdue: bucket(open.filter((i) => i.act !== null && i.act < from)),
    byDay,
  };
}

/** True when the two would tell the notifier the same thing, so a write can be skipped. */
export function sameDigest(a: Digest | null, b: Digest): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}
