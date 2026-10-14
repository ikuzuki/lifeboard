import { describe, expect, it } from 'vitest';
import { DIGEST_VERSION, buildDigest } from './digest';
import { newItem } from '../store';
import { addDays, today } from './dates';
import type { Item, State } from '../types';

const now = new Date(2026, 7, 19, 9);
const t = today(now);
const ago = (n: number) => addDays(t, -n);
const on = (n: number) => addDays(t, n);

const state = (items: Item[]): State =>
  ({ items, goals: [], version: 11, reviewDeferredOn: null }) as State;

describe('the digest', () => {
  it('carries nothing a person typed', () => {
    const doc = buildDigest(state([newItem({ title: 'Ring the dentist about the crown', act: t })]), now);
    const serialised = JSON.stringify(doc);

    expect(serialised).not.toContain('dentist');
    expect(serialised).not.toContain('crown');
    expect(Object.keys(doc).sort()).toEqual(['byDay', 'computedFor', 'overdue', 'version']);
  });

  it('counts overdue work, and the weekday-only subset within it', () => {
    const doc = buildDigest(
      state([
        newItem({ title: 'a', act: ago(4) }),
        newItem({ title: 'b', act: ago(1), weekdaysOnly: true }),
        newItem({ title: 'c', act: t }),
      ]),
      now,
    );

    expect(doc.overdue).toEqual({ all: 2, weekdayOnly: 1 });
  });

  it('groups upcoming work by its start date', () => {
    const doc = buildDigest(
      state([
        newItem({ title: 'a', act: t }),
        newItem({ title: 'b', act: t }),
        newItem({ title: 'c', act: on(2), weekdaysOnly: true }),
      ]),
      now,
    );

    expect(doc.byDay[t]).toEqual({ all: 2, weekdayOnly: 0 });
    expect(doc.byDay[on(2)]).toEqual({ all: 1, weekdayOnly: 1 });
    expect(doc.byDay[on(1)]).toBeUndefined();
  });

  it('stops at three weeks, since past that the staleness is the more interesting fact', () => {
    const doc = buildDigest(
      state([newItem({ title: 'inside', act: on(21) }), newItem({ title: 'outside', act: on(22) })]),
      now,
    );

    expect(doc.byDay[on(21)]).toEqual({ all: 1, weekdayOnly: 0 });
    expect(doc.byDay[on(22)]).toBeUndefined();
  });

  it('leaves out anything the app itself would not act on', () => {
    const doc = buildDigest(
      state([
        newItem({ title: 'done', act: t, status: 'done' }),
        newItem({ title: 'dropped', act: t, status: 'dropped' }),
        newItem({ title: 'undated goal step', act: null, goalId: 'g1' }),
        newItem({ title: 'real', act: t }),
      ]),
      now,
    );

    expect(doc.byDay[t]).toEqual({ all: 1, weekdayOnly: 0 });
    expect(doc.overdue.all).toBe(0);
  });

  it('keeps weekday-only work in, so the notifier can decide about weekends itself', () => {
    // Filtering through `isBlocked` dropped these from a digest written at a weekend, which
    // left the subset almost always zero and the server unable to reproduce `windowOpen`.
    const saturday = new Date(2026, 7, 22, 9);
    const doc = buildDigest(
      state([
        newItem({ title: 'ring the water company', act: today(saturday), weekdaysOnly: true }),
        newItem({ title: 'anything', act: today(saturday) }),
      ]),
      saturday,
    );

    expect(doc.byDay[today(saturday)]).toEqual({ all: 2, weekdayOnly: 1 });
  });

  it('still leaves out work that is genuinely waiting on a date', () => {
    const doc = buildDigest(
      state([newItem({ title: 'opens later', act: ago(1), unblocks: on(3) })]),
      now,
    );

    expect(doc.overdue.all).toBe(0);
  });

  it('records the day it was built for, so staleness is derivable', () => {
    const doc = buildDigest(state([]), now);
    expect(doc.computedFor).toBe(t);
    expect(doc.version).toBe(DIGEST_VERSION);
  });
});
