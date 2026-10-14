import { isBlocked, isDaily, isLive, pressure, today } from '../lib/dates';
import type { Day, Item } from '../types';

export interface ReviewRecord {
  /** The day the pass was pushed to tomorrow. */
  deferredOn: Day | null;
}

export const emptyReview = (): ReviewRecord => ({ deferredOn: null });

/**
 * Overdue work only, most overdue first. Undated items used to lead this batch, and they
 * are the reason the pass needed a weekly clock: nothing about an undated item makes today
 * the day to decide it. Overdue work carries its own timing, so the pass now asks one
 * question and asks it exactly when there is something to answer. Undated items stay
 * visible in their own group on Today.
 *
 * Blocked items are waiting on something rather than being ignored, so they stay out.
 */
export function reviewBatch(items: Item[], now = new Date()): Item[] {
  return items
    .filter((i) => isLive(i) && isDaily(i) && !isBlocked(i, now))
    .filter((i) => i.act !== null && pressure(i, now) === 'slipped')
    .sort((a, b) => (a.act ?? '').localeCompare(b.act ?? ''));
}

/**
 * Whenever something is overdue, unless it was pushed to tomorrow today. There is no
 * period any more: dating the last overdue item empties the batch, which is what makes the
 * pass end, so a clock would only ever have delayed the answer.
 */
export function reviewDue(record: ReviewRecord, size: number, now = new Date()): boolean {
  if (size === 0) return false;
  return record.deferredOn !== today(now);
}
