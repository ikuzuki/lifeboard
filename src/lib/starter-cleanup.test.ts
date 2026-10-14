import { describe, expect, it } from 'vitest';
import { VERSION, migrate, newItem } from '../store';
import type { Goal, Item, State } from '../types';

const goal = (id: string, title: string): Goal => ({
  id,
  title,
  category: 'exercise',
  horizon: '',
  description: '',
  parked: false,
  status: 'live',
  closedAt: null,
});

const at = (item: Item, createdAt: string, updatedAt = createdAt): Item => ({
  ...item,
  createdAt,
  updatedAt,
});

const before = (patch: Partial<State>): State =>
  ({ items: [], goals: [], version: 9, reviewDeferredOn: null, ...patch }) as State;

describe('clearing the starter list from someone who already has it', () => {
  it('removes untouched starter items', () => {
    const state = before({
      items: [at({ ...newItem({ title: 'Sort out the bike' }), id: 'seed-sort-out-the-bike' }, '2026-08-19T09:00:00.000Z')],
    });

    expect(migrate(state).items).toEqual([]);
  });

  it('keeps a starter item the user has touched, because that is a decision they made', () => {
    const edited = at(
      { ...newItem({ title: 'Sort out the bike' }), id: 'seed-sort-out-the-bike' },
      '2026-08-19T09:00:00.000Z',
      '2026-08-19T18:30:00.000Z',
    );

    expect(migrate(before({ items: [edited] })).items.map((i) => i.id)).toEqual([
      'seed-sort-out-the-bike',
    ]);
  });

  it('never touches an item the user created', () => {
    const mine = newItem({ title: 'Ring the dentist' });
    expect(migrate(before({ items: [mine] })).items.map((i) => i.title)).toEqual(['Ring the dentist']);
  });

  it('removes the demo goals', () => {
    const state = before({ goals: [goal('g-swim', 'Swim a long-distance event'), goal('g-role', 'Move to a bigger role')] });
    expect(migrate(state).goals).toEqual([]);
  });

  it('keeps a real goal that happens to share an id with a demo one', () => {
    // A real account can reuse a starter id for a goal of its own. Matching on the id alone
    // would delete it, which is why the match is on id and title together.
    const state = before({ goals: [goal('g-swim', 'Swim the bay')] });
    expect(migrate(state).goals.map((g) => g.title)).toEqual(['Swim the bay']);
  });

  it('detaches a surviving step whose goal has gone rather than orphaning it', () => {
    const step = at(
      { ...newItem({ title: 'Swimming twice a week', goalId: 'g-swim' }), id: 'kept' },
      '2026-08-19T09:00:00.000Z',
      '2026-08-19T19:00:00.000Z',
    );
    const next = migrate(before({ goals: [goal('g-swim', 'Swim a long-distance event')], items: [step] }));

    expect(next.goals).toEqual([]);
    expect(next.items[0].goalId).toBeNull();
  });

  it('leaves the document on the current version', () => {
    expect(migrate(before({})).version).toBe(VERSION);
  });
});
