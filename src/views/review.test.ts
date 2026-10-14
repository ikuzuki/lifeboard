import { describe, expect, it } from 'vitest';
import { emptyReview, reviewBatch, reviewDue } from './review';
import { newItem } from '../store';
import { addDays, today } from '../lib/dates';

const now = new Date(2026, 7, 17, 9);
const t = today(now);
const ago = (n: number) => addDays(t, -n);

describe('reviewBatch', () => {
  it('takes overdue items only, and leaves undated ones alone', () => {
    // Undated items used to lead this batch. Nothing about them makes today the day to
    // decide, which is what forced the old weekly clock; they stay visible in their own
    // group on Today instead.
    const items = [
      newItem({ title: 'Slipped', act: ago(4) }),
      newItem({ title: 'Undated', act: null }),
      newItem({ title: 'Later', act: addDays(t, 9) }),
      newItem({ title: 'Today', act: t }),
    ];
    expect(reviewBatch(items, now).map((i) => i.title)).toEqual(['Slipped']);
  });

  it('leaves out items that are not live', () => {
    const items = [
      newItem({ title: 'Done', act: ago(3), status: 'done' }),
      newItem({ title: 'Dropped', act: null, status: 'dropped' }),
      newItem({ title: 'Doing and late', act: ago(1), status: 'doing' }),
    ];
    expect(reviewBatch(items, now).map((i) => i.title)).toEqual(['Doing and late']);
  });

  it('leaves out date-blocked items, which are waiting rather than ignored', () => {
    // Item-to-item blocking no longer exists, so `unblocks` and the weekday rule are the
    // only two things that can hold an item back.
    const items = [
      newItem({ title: 'Time blocked', act: ago(2), unblocks: addDays(t, 3) }),
      newItem({ title: 'Free', act: ago(2) }),
    ];
    expect(reviewBatch(items, now).map((i) => i.title)).toEqual(['Free']);
  });

  it('holds a weekdays-only item back at the weekend but not midweek', () => {
    const items = [newItem({ title: 'Ring the water company', act: ago(2), weekdaysOnly: true })];
    // `now` is Monday 17 August 2026; the 22nd is the Saturday of the same week.
    const saturday = new Date(2026, 7, 22, 9);
    expect(reviewBatch(items, now).map((i) => i.title)).toEqual(['Ring the water company']);
    expect(reviewBatch(items, saturday)).toEqual([]);
  });

  it('leaves out an undated purchase, which is a wishlist entry', () => {
    const items = [
      newItem({ title: 'Kit bag', act: null, buy: true }),
      newItem({ title: 'Late purchase', act: ago(2), buy: true }),
    ];
    expect(reviewBatch(items, now).map((i) => i.title)).toEqual(['Late purchase']);
  });

  it('leaves out an undated goal step, which lives on its goal', () => {
    const items = [
      newItem({ title: 'Step', act: null, goalId: 'g1' }),
      newItem({ title: 'Dated step', act: ago(1), goalId: 'g1' }),
    ];
    expect(reviewBatch(items, now).map((i) => i.title)).toEqual(['Dated step']);
  });

  it('puts the most overdue first', () => {
    const items = [
      newItem({ title: 'Late by one', act: ago(1) }),
      newItem({ title: 'Late by nine', act: ago(9) }),
      newItem({ title: 'Late by four', act: ago(4) }),
    ];
    expect(reviewBatch(items, now).map((i) => i.title)).toEqual([
      'Late by nine',
      'Late by four',
      'Late by one',
    ]);
  });
});

describe('reviewDue', () => {
  it('does not fire when nothing is overdue', () => {
    expect(reviewDue(emptyReview(), 0, now)).toBe(false);
  });

  it('fires as soon as something is overdue', () => {
    // No clock. Overdue work is its own trigger, so the pass appears the day after
    // something slips rather than whenever a week happens to be up.
    expect(reviewDue(emptyReview(), 1, now)).toBe(true);
  });

  it('holds off for the rest of the day once deferred, and returns tomorrow', () => {
    expect(reviewDue({ deferredOn: t }, 3, now)).toBe(false);
    expect(reviewDue({ deferredOn: ago(1) }, 3, now)).toBe(true);
  });
});
