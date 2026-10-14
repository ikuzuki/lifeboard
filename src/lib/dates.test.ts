import { describe, expect, it } from 'vitest';
import {
  addDays,
  addRecurrence,
  blockReason,
  daysUntil,
  goalProgress,
  buyHorizon,
  isArchived,
  isBlocked,
  isDaily,
  isDoneToday,
  pressure,
  recurrenceEnds,
  relative,
  toDay,
  windowOpen,
} from './dates';
import { newItem } from '../store';
import type { Goal, Item, Recurrence } from '../types';

/**
 * These cover the two bugs that shipped in v1.2, both of which came from treating
 * calendar days as instants. Run this suite with TZ=Europe/London to mean anything.
 */
describe('calendar day arithmetic', () => {
  it('crosses the end of BST without losing a day', () => {
    // 25 October 2026 is 25 hours long in Europe/London.
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });

  it('crosses the start of BST without losing a day', () => {
    // 29 March 2026 is 23 hours long.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  });

  it('round-trips a date through a Date object', () => {
    expect(toDay(new Date(2026, 7, 17))).toBe('2026-08-17');
  });

  it('counts whole days across a transition', () => {
    const now = new Date(2026, 9, 24, 9);
    expect(daysUntil('2026-10-25', now)).toBe(1);
    expect(daysUntil('2026-10-26', now)).toBe(2);
    expect(daysUntil('2026-10-23', now)).toBe(-1);
  });

  it('advances a recurrence by calendar units', () => {
    expect(addRecurrence('2026-10-24', { every: 1, unit: 'day' })).toBe('2026-10-25');
    expect(addRecurrence('2026-10-24', { every: 1, unit: 'week' })).toBe('2026-10-31');
    expect(addRecurrence('2026-01-31', { every: 1, unit: 'month' })).toBe('2026-03-03');
  });

  it('labels a past date as late rather than as a countdown', () => {
    const now = new Date(2026, 7, 20, 9);
    expect(relative('2026-08-18', now)).toBe('2d late');
    expect(relative('2026-08-20', now)).toBe('today');
  });
});

describe('pressure', () => {
  const base = (patch: Partial<Item>): Item => newItem({ title: 'x', ...patch });
  const now = new Date(2026, 7, 20, 9);

  it('keeps a started item in the lane its dates put it in', () => {
    expect(pressure(base({ act: '2026-08-06', status: 'doing' }), now)).toBe('slipped');
    expect(pressure(base({ act: '2026-08-20', status: 'doing' }), now)).toBe('now');
  });

  it('lanes a shut item by its dates and reports the block separately', () => {
    // Being blocked is a fact on the card, not a lane. A slipped item that is also shut
    // still reads as slipped, so it cannot hide in a Waiting pile.
    const item = base({ act: '2026-08-01', unblocks: '2026-08-25' });
    expect(pressure(item, now)).toBe('slipped');
    expect(isBlocked(item, now)).toBe(true);
    expect(blockReason(item, now)).toBe('opens 25 Aug');
  });

  it('puts today in Now and tomorrow in This week', () => {
    // The boundary that made the tomorrow swipe look broken: with Now spanning both,
    // moving a today item to tomorrow left it exactly where it was.
    expect(pressure(base({ act: '2026-08-20' }), now)).toBe('now');
    expect(pressure(base({ act: '2026-08-21' }), now)).toBe('soon');
  });

  it('separates undated items from ones dated a long way out', () => {
    expect(pressure(base({ act: null }), now)).toBe('undated');
    expect(pressure(base({ act: '2026-09-30' }), now)).toBe('later');
  });

  it('drops a weekday-only item out of the actionable set at the weekend', () => {
    const item = base({ act: '2026-08-15', weekdaysOnly: true });
    const saturday = new Date(2026, 7, 15, 11);
    const monday = new Date(2026, 7, 17, 11);
    expect(isBlocked(item, saturday)).toBe(true);
    expect(blockReason(item, saturday)).toBe('opens Monday');
    expect(isBlocked(item, monday)).toBe(false);
    expect(pressure(item, monday)).toBe('slipped');
  });
});

describe('recurrence end conditions', () => {
  it('ends on the last of a fixed number of occurrences', () => {
    expect(recurrenceEnds({ every: 1, unit: 'week', times: 1 }, '2026-08-24')).toBe(true);
    expect(recurrenceEnds({ every: 1, unit: 'week', times: 2 }, '2026-08-24')).toBe(false);
  });

  it('ends once the next occurrence would fall past the end date', () => {
    const r: Recurrence = { every: 1, unit: 'week', until: '2026-08-25' };
    expect(recurrenceEnds(r, '2026-08-24')).toBe(false);
    expect(recurrenceEnds(r, '2026-08-26')).toBe(true);
  });

  it('never ends without a condition', () => {
    expect(recurrenceEnds({ every: 1, unit: 'day' }, '2030-01-01')).toBe(false);
  });
});

describe('archiving', () => {
  const now = new Date(2026, 7, 20, 9);

  it('keeps what was done today and archives what was done before it', () => {
    const todays = newItem({ title: 'a', status: 'done', doneAt: '2026-08-20T08:00:00.000Z' });
    const yesterdays = newItem({ title: 'b', status: 'done', doneAt: '2026-08-19T08:00:00.000Z' });
    expect(isArchived(todays, now)).toBe(false);
    expect(isDoneToday(todays, now)).toBe(true);
    expect(isArchived(yesterdays, now)).toBe(true);
  });

  it('archives a dropped item immediately', () => {
    const dropped = newItem({ title: 'c', status: 'dropped', doneAt: '2026-08-20T08:00:00.000Z' });
    expect(isArchived(dropped, now)).toBe(true);
  });
});

describe('goal steps', () => {
  const goal: Goal = {
    id: 'g1',
    title: 'Swim far',
    category: 'exercise',
    horizon: '',
    description: '',
    parked: false,
    status: 'live',
    closedAt: null,
  };
  const now = new Date(2026, 7, 20, 9);

  it('counts one-off steps only, because a repeating commitment never finishes', () => {
    const items = [
      newItem({ title: 'Swim', goalId: 'g1', recurrence: { every: 1, unit: 'week' }, streak: 4 }),
      newItem({ title: 'Entered', goalId: 'g1', status: 'done', doneAt: '2026-08-18T09:00:00.000Z' }),
      newItem({ title: 'Pick a date', goalId: 'g1' }),
      newItem({ title: 'Unrelated' }),
    ];
    const p = goalProgress(goal, items, now);
    expect(p.steps).toHaveLength(3);
    expect(p.done).toBe(1);
    expect(p.total).toBe(2);
    expect(p.idle).toBe(2);
  });

  it('reports no activity when nothing linked has ever been completed', () => {
    const items = [newItem({ title: 'Swim', goalId: 'g1' })];
    expect(goalProgress(goal, items, now).idle).toBeNull();
  });

  it('keeps undated steps off the daily surfaces and dated ones on', () => {
    expect(isDaily(newItem({ title: 'a', goalId: 'g1' }))).toBe(false);
    expect(isDaily(newItem({ title: 'b', goalId: 'g1', act: '2026-08-20' }))).toBe(true);
    expect(isDaily(newItem({ title: 'c' }))).toBe(true);
  });
});

describe('weekday-only items', () => {
  it('is shut at the weekend and open on a weekday, whatever the hour', () => {
    expect(windowOpen(true, new Date(2026, 7, 16, 11))).toBe(false); // Sunday
    expect(windowOpen(true, new Date(2026, 7, 17, 11))).toBe(true); // Monday
    expect(windowOpen(true, new Date(2026, 7, 17, 22))).toBe(true);
  });

  it('is always open when the item carries no weekday rule', () => {
    expect(windowOpen(false, new Date(2026, 7, 16, 11))).toBe(true);
  });
});

describe('buying horizons', () => {
  const buy = (act: string | null): Item => newItem({ title: 'Desk lamp', buy: true, act });
  // Mid-month, so "this month" has room on both sides of it.
  const mid = new Date(2026, 7, 14, 9);

  it('groups by calendar month rather than by a day count', () => {
    expect(buyHorizon(buy('2026-08-31'), mid)).toBe('this-month');
    expect(buyHorizon(buy('2026-09-01'), mid)).toBe('next-month');
    expect(buyHorizon(buy('2026-10-05'), mid)).toBe('later');
  });

  it('treats an overdue purchase as this month rather than inventing a past group', () => {
    expect(buyHorizon(buy('2026-07-02'), mid)).toBe('this-month');
  });

  it('puts an undated purchase on the wishlist', () => {
    expect(buyHorizon(buy(null), mid)).toBe('wishlist');
  });

  it('crosses a year boundary', () => {
    const december = new Date(2026, 11, 20, 9);
    expect(buyHorizon(buy('2027-01-04'), december)).toBe('next-month');
    expect(buyHorizon(buy('2027-03-04'), december)).toBe('later');
  });
});
