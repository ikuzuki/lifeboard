import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StateCorruptError, VERSION, load, newGoal, newItem, reducer } from './store';
import { DEFAULT_CATEGORIES } from './lib/categories';
import { addDays, today } from './lib/dates';
import type { State } from './types';

const KEY = 'lifeboard.state';
const empty = (): State => ({
  items: [],
  goals: [],
  categories: DEFAULT_CATEGORIES,
  version: VERSION,
  reviewDeferredOn: null,
});

/** Minimal in-memory store, so these tests do not need a browser environment. */
function stubStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  });
}

describe('load', () => {
  beforeEach(stubStorage);

  it('seeds when nothing has ever been stored', () => {
    expect(load().items.length).toBeGreaterThan(0);
  });

  it('refuses to silently replace unreadable data with the seed', () => {
    localStorage.setItem(KEY, '{ not json');
    expect(() => load()).toThrow(StateCorruptError);
  });

  it('refuses data of the wrong shape', () => {
    localStorage.setItem(KEY, JSON.stringify({ items: 'nope', goals: [], version: 6 }));
    expect(() => load()).toThrow(StateCorruptError);
  });

  it('migrates an older version instead of discarding it', () => {
    const legacy = {
      version: 3,
      goals: [],
      items: [
        {
          id: 'a',
          title: 'Kept',
          kind: 'buy',
          cadence: '3 a week',
          // An instant written at local midnight under BST, which is the previous day in UTC.
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
    localStorage.setItem(KEY, JSON.stringify(legacy));
    const state = load();
    expect(state.version).toBe(VERSION);
    expect(state.items[0].title).toBe('Kept');
    expect(state.items[0].buy).toBe(true);
    // The whole point: the instant reads back as the 17th, not the 16th.
    expect(state.items[0].act).toBe('2026-08-17');
  });

  it('drops blockedBy and reduces contact to a weekday flag', () => {
    const v5 = {
      version: 5,
      goals: [],
      items: [
        {
          ...newItem({ title: 'Ring them' }),
          blockedBy: 'some-other-id',
          contact: { weekdaysOnly: true, from: '09:00', to: '17:30' },
        },
        { ...newItem({ title: 'No window' }), blockedBy: null, contact: null },
      ],
    };
    localStorage.setItem(KEY, JSON.stringify(v5));
    const state = load();
    expect(state.version).toBe(VERSION);
    expect(state.items[0].weekdaysOnly).toBe(true);
    expect(state.items[1].weekdaysOnly).toBe(false);
    expect(state.items.every((i) => !('blockedBy' in i) && !('contact' in i))).toBe(true);
    expect(state.items.map((i) => i.title)).toEqual(['Ring them', 'No window']);
  });

  it('promotes milestones to items and keeps the goal', () => {
    const v4 = {
      version: 4,
      items: [],
      goals: [
        {
          id: 'g1',
          title: 'Swim',
          category: 'exercise',
          horizon: 'next summer',
          why: 'leftover aftertext',
          parked: false,
          milestones: [
            { id: 'm1', text: 'Pool membership active', done: true },
            { id: 'm2', text: 'Entered', done: false },
          ],
        },
      ],
    };
    localStorage.setItem(KEY, JSON.stringify(v4));
    const state = load();
    expect(state.version).toBe(VERSION);
    expect(state.goals[0].description).toBe('leftover aftertext');
    const steps = state.items.filter((i) => i.goalId === 'g1');
    expect(steps.map((s) => s.title)).toEqual(['Pool membership active', 'Entered']);
    expect(steps[0].status).toBe('done');
    expect(steps[1].status).toBe('todo');
  });
});

describe('goals', () => {
  const withGoal = (extra: Partial<State> = {}) => {
    const step = newItem({ title: 'Swim', goalId: 'g1' });
    const done = newItem({ title: 'Entered', goalId: 'g1', status: 'done' });
    const other = newItem({ title: 'Unrelated' });
    const goal = newGoal({ id: 'g1', title: 'Swim far', category: 'exercise' });
    return { ...empty(), items: [step, done, other], goals: [goal], ...extra };
  };

  it('keeps the steps when the goal is deleted', () => {
    const next = reducer(withGoal(), { type: 'removeGoal', goalId: 'g1' });
    expect(next.goals).toHaveLength(0);
    expect(next.items[0].goalId).toBeNull();
  });

  it('completing a goal archives it and closes the steps still open', () => {
    const next = reducer(withGoal(), { type: 'completeGoal', goalId: 'g1' });
    expect(next.goals[0].status).toBe('done');
    expect(next.goals[0].closedAt).not.toBeNull();
    expect(next.items[0].status).toBe('dropped');
    // Already done, and nothing to do with the goal: both untouched.
    expect(next.items[1].status).toBe('done');
    expect(next.items[2].status).toBe('todo');
  });

  it('dropping a goal leaves the same trail as completing one', () => {
    const next = reducer(withGoal(), { type: 'dropGoal', goalId: 'g1' });
    expect(next.goals[0].status).toBe('dropped');
    expect(next.items[0].status).toBe('dropped');
  });

  it('reviving a closed goal does not reopen its steps', () => {
    const closed = reducer(withGoal(), { type: 'completeGoal', goalId: 'g1' });
    const next = reducer(closed, { type: 'reviveGoal', goalId: 'g1' });
    expect(next.goals[0].status).toBe('live');
    expect(next.goals[0].closedAt).toBeNull();
    expect(next.items[0].status).toBe('dropped');
  });
});

describe('categories', () => {
  beforeEach(stubStorage);

  it('gives stored data the default seven rather than none', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 5,
        goals: [{ id: 'g1', title: 'Swim far', category: 'exercise', horizon: '', description: '', parked: false, icon: 'M12' }],
        items: [newItem({ title: 'Kept', category: 'health' })],
      }),
    );
    const state = load();
    expect(state.version).toBe(VERSION);
    expect(state.categories).toEqual(DEFAULT_CATEGORIES);
    // The seven ids are unchanged, so nothing loses its colour on the way through.
    expect(state.items[0].category).toBe('health');
    expect(state.goals[0].category).toBe('exercise');
    expect('icon' in state.goals[0]).toBe(false);
    expect(state.goals[0].status).toBe('live');
  });

  it('keeps a category list the user has already edited', () => {
    const mine = [{ id: 'money', label: 'Money', colour: 'yellow' }];
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: 5, goals: [], items: [newItem({ title: 'x', category: 'health' })], categories: mine }),
    );
    const state = load();
    expect(state.categories).toEqual(mine);
    // 'health' is not in that list, so it cannot be shown. Uncategorised, not orphaned.
    expect(state.items[0].category).toBeNull();
  });

  it('reassigns items to uncategorised when their category is deleted', () => {
    const kept = newItem({ title: 'Swim', category: 'exercise' });
    const orphaned = newItem({ title: 'GP', category: 'health' });
    const goal = newGoal({ title: 'Swim far', category: 'health' });
    const next = reducer(
      { ...empty(), items: [kept, orphaned], goals: [goal] },
      { type: 'removeCategory', id: 'health' },
    );
    expect(next.categories?.map((c) => c.id)).not.toContain('health');
    expect(next.items.map((i) => i.title)).toEqual(['Swim', 'GP']);
    expect(next.items[0].category).toBe('exercise');
    expect(next.items[1].category).toBeNull();
    expect(next.goals[0].category).toBeNull();
  });

  it('adds up to ten and no further, each on its own colour', () => {
    let state = empty();
    for (const label of ['Money', 'Family', 'Side project', 'Travel']) {
      state = reducer(state, { type: 'addCategory', label });
    }
    expect(state.categories).toHaveLength(10);
    const colours = state.categories?.map((c) => c.colour) ?? [];
    expect(new Set(colours).size).toBe(10);

    const full = reducer(state, { type: 'addCategory', label: 'Eleventh' });
    expect(full.categories).toHaveLength(10);
  });

  it('renames and recolours without touching the items that point at it', () => {
    const item = newItem({ title: 'Swim', category: 'exercise' });
    const renamed = reducer(
      { ...empty(), items: [item] },
      { type: 'patchCategory', id: 'exercise', patch: { label: 'Training', colour: 'pink' } },
    );
    expect(renamed.categories?.find((c) => c.id === 'exercise')).toEqual({
      id: 'exercise',
      label: 'Training',
      colour: 'pink',
    });
    expect(renamed.items[0].category).toBe('exercise');
  });

  it('swaps colours rather than letting two categories share one', () => {
    const next = reducer(empty(), {
      type: 'patchCategory',
      id: 'exercise',
      patch: { colour: 'red' },
    });
    expect(next.categories?.find((c) => c.id === 'exercise')?.colour).toBe('red');
    expect(next.categories?.find((c) => c.id === 'health')?.colour).toBe('green');
  });

  it('takes the empty string from the picker as uncategorised', () => {
    const item = newItem({ title: 'Swim', category: 'exercise' });
    const next = reducer(
      { ...empty(), items: [item] },
      { type: 'patch', id: item.id, patch: { category: '' } },
    );
    expect(next.items[0].category).toBeNull();
  });
});

describe('snooze', () => {
  it('moves by whole calendar days', () => {
    const item = newItem({ title: 'x', act: '2026-10-24' });
    const next = reducer({ ...empty(), items: [item] }, { type: 'snooze', id: item.id, days: 1 });
    expect(next.items[0].act).toBe('2026-10-25');
    expect(next.items[0].slips).toBe(1);
  });

  it('rebases a past date on today rather than the stale date', () => {
    const item = newItem({ title: 'x', act: '2020-01-01' });
    const next = reducer({ ...empty(), items: [item] }, { type: 'snooze', id: item.id, days: 1 });
    expect(next.items[0].act).toBe(addDays(today(), 1));
  });
});

describe('completing a recurring item', () => {
  it('closes the occurrence you did and schedules the next as its own record', () => {
    // The occurrence used to be mutated in place and left at `todo`, so ticking a repeat
    // struck nothing through and collected nothing in Done today. On Today it did not even
    // appear to move, because the lane holds a card where it was when you tapped it.
    const item = newItem({
      title: 'Swim',
      act: '2026-08-17',
      recurrence: { every: 2, unit: 'day' },
    });
    const next = reducer({ ...empty(), items: [item] }, { type: 'complete', id: item.id });

    expect(next.items).toHaveLength(2);
    const [closed, upcoming] = next.items;
    expect(closed.id).toBe(item.id);
    expect(closed.status).toBe('done');
    expect(closed.doneAt).not.toBeNull();
    // The closed occurrence keeps its rule. Clearing it would turn every completion into a
    // one-off, and a goal's "done of total" counts one-offs, so ticking a habit would push
    // both sides of that fraction up for ever.
    expect(closed.recurrence).toEqual({ every: 2, unit: 'day' });

    expect(upcoming.id).not.toBe(item.id);
    expect(upcoming.status).toBe('todo');
    expect(upcoming.act).toBe('2026-08-19');
    expect(upcoming.doneAt).toBeNull();
    expect(upcoming.recurrence).toEqual({ every: 2, unit: 'day' });
    expect(upcoming.streak).toBe(1);
  });

  it('closes a one-off item', () => {
    const item = newItem({ title: 'Once', act: '2026-08-17' });
    const next = reducer({ ...empty(), items: [item] }, { type: 'complete', id: item.id });
    expect(next.items[0].status).toBe('done');
    expect(next.items[0].doneAt).not.toBeNull();
  });

  it('counts down a fixed number of repeats and stops scheduling after the last', () => {
    const item = newItem({
      title: 'Piano lesson',
      act: '2026-08-17',
      recurrence: { every: 1, unit: 'week', times: 2 },
    });
    const once = reducer({ ...empty(), items: [item] }, { type: 'complete', id: item.id });
    const upcoming = once.items[1];
    expect(once.items[0].status).toBe('done');
    expect(upcoming.recurrence?.times).toBe(1);

    // Completing the last occurrence leaves nothing scheduled behind it.
    const twice = reducer(once, { type: 'complete', id: upcoming.id });
    expect(twice.items).toHaveLength(2);
    expect(twice.items.every((i) => i.status === 'done')).toBe(true);
    // Nothing new was scheduled: the series had two occurrences and both are done.
    expect(twice.items.some((i) => i.status !== 'done')).toBe(false);
  });

  it('closes a repeat that would run past its end date', () => {
    const item = newItem({
      title: 'Water the plants',
      act: '2026-08-17',
      recurrence: { every: 1, unit: 'week', until: '2026-08-20' },
    });
    const next = reducer({ ...empty(), items: [item] }, { type: 'complete', id: item.id });
    expect(next.items[0].status).toBe('done');
    expect(next.items[0].act).toBe('2026-08-17');
  });
});

describe('starting and pulling forward', () => {
  it('starts and stops without touching the date or the completion', () => {
    const item = newItem({ title: 'Long job', act: '2026-08-17' });
    const started = reducer({ ...empty(), items: [item] }, { type: 'start', id: item.id });
    expect(started.items[0].status).toBe('doing');
    expect(started.items[0].act).toBe('2026-08-17');

    const stopped = reducer(started, { type: 'stop', id: item.id });
    expect(stopped.items[0].status).toBe('todo');
    expect(stopped.items[0].doneAt).toBeNull();
  });

  it('pulls an item into today without counting it as a slip', () => {
    const item = newItem({ title: 'Later thing', act: addDays(today(), 30) });
    const next = reducer({ ...empty(), items: [item] }, { type: 'pullForward', id: item.id });
    expect(next.items[0].act).toBe(today());
    expect(next.items[0].slips).toBe(0);
  });
});

describe('ending a recurrence', () => {

  it('counts down a fixed number of repeats and stops scheduling after the last', () => {
    const item = newItem({
      title: 'Piano lesson',
      act: '2026-08-17',
      recurrence: { every: 1, unit: 'week', times: 2 },
    });
    const once = reducer({ ...empty(), items: [item] }, { type: 'complete', id: item.id });
    const upcoming = once.items[1];
    expect(once.items[0].status).toBe('done');
    expect(upcoming.recurrence?.times).toBe(1);

    // Completing the last occurrence leaves nothing scheduled behind it.
    const twice = reducer(once, { type: 'complete', id: upcoming.id });
    expect(twice.items).toHaveLength(2);
    expect(twice.items.every((i) => i.status === 'done')).toBe(true);
    // Nothing new was scheduled: the series had two occurrences and both are done.
    expect(twice.items.some((i) => i.status !== 'done')).toBe(false);
  });

  it('closes a repeat that would run past its end date', () => {
    const item = newItem({
      title: 'Water the plants',
      act: '2026-08-17',
      recurrence: { every: 1, unit: 'week', until: '2026-08-20' },
    });
    const next = reducer({ ...empty(), items: [item] }, { type: 'complete', id: item.id });
    expect(next.items[0].status).toBe('done');
    expect(next.items[0].act).toBe('2026-08-17');
  });
});

describe('starting and pulling forward', () => {
  it('starts and stops without touching the date or the completion', () => {
    const item = newItem({ title: 'Long job', act: '2026-08-17' });
    const started = reducer({ ...empty(), items: [item] }, { type: 'start', id: item.id });
    expect(started.items[0].status).toBe('doing');
    expect(started.items[0].act).toBe('2026-08-17');

    const stopped = reducer(started, { type: 'stop', id: item.id });
    expect(stopped.items[0].status).toBe('todo');
    expect(stopped.items[0].doneAt).toBeNull();
  });

  it('pulls an item into today without counting it as a slip', () => {
    const item = newItem({ title: 'Later thing', act: addDays(today(), 30) });
    const next = reducer({ ...empty(), items: [item] }, { type: 'pullForward', id: item.id });
    expect(next.items[0].act).toBe(today());
    expect(next.items[0].slips).toBe(0);
  });
});

describe('ending a recurrence', () => {
  it('leaves the item live, because stopping a repeat is not finishing the work', () => {
    // There used to be an `endRecurrence` action that cleared the repeat and completed the
    // item in one go, behind a button reading "End the repeat". Clearing the recurrence is
    // an ordinary patch; ticking it afterwards is the user's separate decision.
    const item = newItem({
      title: 'Swim',
      act: today(),
      recurrence: { every: 2, unit: 'day' },
    });
    const next = reducer(
      { ...empty(), items: [item] },
      { type: 'patch', id: item.id, patch: { recurrence: null } },
    );
    expect(next.items[0].recurrence).toBeNull();
    expect(next.items[0].status).toBe('todo');
    expect(next.items[0].doneAt).toBeNull();
  });
});

describe('undo is scoped to what the action touched', () => {
  /**
   * The observed-once, never-reproduced defect: complete something, start something
   * else while the toast is still up, then undo. A whole-document rollback threw the
   * start away.
   */
  it('does not discard an unrelated edit made while the toast was up', () => {
    const done = newItem({ title: 'Ring the water company', act: '2026-08-17' });
    const other = newItem({ title: 'Register with a GP', act: '2026-08-17' });
    let state = { ...empty(), items: [done, other] };

    // The toast captures only the item being completed.
    const before = [state.items[0]];
    state = reducer(state, { type: 'complete', id: done.id });
    // Meanwhile the other item is started.
    state = reducer(state, { type: 'patch', id: other.id, patch: { status: 'doing' } });

    state = reducer(state, { type: 'restoreItems', items: before });

    const back = state.items.find((i) => i.id === done.id);
    const kept = state.items.find((i) => i.id === other.id);
    expect(back?.status).toBe('todo');
    expect(back?.doneAt).toBeNull();
    // The whole point: starting the other item survives the undo.
    expect(kept?.status).toBe('doing');
  });

  it('brings back an item that was removed outright', () => {
    const item = newItem({ title: 'Buy bed slats' });
    let state = { ...empty(), items: [item] };
    const before = [item];
    state = reducer(state, { type: 'remove', id: item.id });
    expect(state.items).toHaveLength(0);
    state = reducer(state, { type: 'restoreItems', items: before });
    expect(state.items.map((i) => i.title)).toEqual(['Buy bed slats']);
  });
});

describe('timestamps stay honest for per-item merge', () => {
  it('does not re-date an imported document', () => {
    // An import carries its own timestamps. Re-dating them would let a stale backup
    // beat a recent edit made on another device.
    const old = '2026-07-01T09:00:00.000Z';
    const imported: State = {
      ...empty(),
      items: [{ ...newItem({ title: 'From a backup' }), updatedAt: old }],
    };
    const next = reducer(empty(), { type: 'restore', state: imported });
    expect(next.items[0].updatedAt).toBe(old);
  });

  it('still re-dates an item an ordinary action actually changed', () => {
    const item = { ...newItem({ title: 'Swim' }), updatedAt: '2026-07-01T09:00:00.000Z' };
    const next = reducer({ ...empty(), items: [item] }, { type: 'complete', id: item.id });
    expect(next.items[0].updatedAt).not.toBe('2026-07-01T09:00:00.000Z');
  });

  it('leaves untouched items alone', () => {
    const a = { ...newItem({ title: 'A' }), updatedAt: '2026-07-01T09:00:00.000Z' };
    const b = { ...newItem({ title: 'B' }), updatedAt: '2026-07-02T09:00:00.000Z' };
    const next = reducer({ ...empty(), items: [a, b] }, { type: 'complete', id: a.id });
    expect(next.items[1].updatedAt).toBe('2026-07-02T09:00:00.000Z');
  });
});

describe('dropping the buy phase', () => {
  it('removes the field and keeps everything else about the purchase', () => {
    const legacy = {
      version: 6,
      goals: [],
      categories: DEFAULT_CATEGORIES,
      items: [{ ...newItem({ title: 'Desk lamp', buy: true, cost: 45, act: '2026-09-10' }), phase: 2 }],
    };
    localStorage.setItem(KEY, JSON.stringify(legacy));
    const state = load();
    expect(state.version).toBe(VERSION);
    expect('phase' in state.items[0]).toBe(false);
    // The horizon it used to store is now implied by the date, which survived.
    expect(state.items[0].act).toBe('2026-09-10');
    expect(state.items[0].cost).toBe(45);
    expect(state.items[0].buy).toBe(true);
  });
});
