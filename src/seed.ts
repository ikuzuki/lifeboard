import type { Goal, Item, State } from './types';
import { VERSION, newItem } from './store';
import { DEFAULT_CATEGORIES } from './lib/categories';
import { addDays, today } from './lib/dates';

/**
 * Generic starter data. Deliberately impersonal: this file is committed, so it must
 * never carry real medical, financial or booking details, and nothing here narrates
 * the interface back at the reader.
 */
/**
 * A stable id per starter item, so the same one on two devices is the same record. Random ids
 * meant every install contributed its own copy: signing in on a fourth browser left the
 * account holding four of everything, because the merge unions on id and had no way to know
 * they were the same thing.
 */
const seeded = (title: string): string =>
  `seed-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

/** What a new install starts with: nothing. */
export function empty(): State {
  return { items: [], goals: [], categories: DEFAULT_CATEGORIES, version: VERSION, reviewDeferredOn: null };
}

export function seed(): State {
  const t = today();
  const instant = (days: number) => `${addDays(t, days)}T09:00:00.000Z`;

  const goals: Goal[] = [
    {
      id: 'g-swim',
      title: 'Swim a long-distance event',
      category: 'exercise',
      horizon: 'next summer',
      description: '',
      parked: false,
      status: 'live',
      closedAt: null,
    },
    {
      id: 'g-role',
      title: 'Move to a bigger role',
      category: 'career',
      horizon: 'within six months',
      description: '',
      parked: false,
      status: 'live',
      closedAt: null,
    },
  ];

  const items: Item[] = [
    newItem({ id: seeded('Book the restaurant'), title: 'Book the restaurant', category: 'events', order: 0, act: t, due: addDays(t, 48) }),
    newItem({ id: seeded('Renew the insurance'), title: 'Renew the insurance', category: 'admin', order: 1, act: addDays(t, 1), due: addDays(t, 14) }),
    newItem({ id: seeded('Register with a local GP'), title: 'Register with a local GP', category: 'health', order: 2, act: addDays(t, 1), due: addDays(t, 12) }),
    newItem({ id: seeded('Book the follow-up appointment'), title: 'Book the follow-up appointment', category: 'health', order: 3, act: addDays(t, 8) }),
    newItem({ id: seeded('Claim the delayed flight'), title: 'Claim the delayed flight', category: 'admin', order: 4, act: addDays(t, 2), unblocks: addDays(t, 2) }),
    newItem({ id: seeded('Ring the water company'), title: 'Ring the water company', category: 'admin', order: 5, act: addDays(t, 3), weekdaysOnly: true }),
    newItem({ id: seeded('Standing desk'), title: 'Standing desk', category: 'home', order: 6, act: addDays(t, 1), buy: true, cost: 81 }),
    newItem({ id: seeded('Desk lamp'), title: 'Desk lamp', category: 'home', order: 7, act: addDays(t, 20), buy: true }),
    newItem({ id: seeded('Waterproof kit bag'), title: 'Waterproof kit bag', category: 'exercise', order: 8, buy: true }),
    newItem({ id: seeded('Sort out the bike'), title: 'Sort out the bike', category: 'exercise', order: 9, act: addDays(t, -4), slips: 3 }),
    newItem({ id: seeded('Chase the water bill'), title: 'Chase the water bill', category: 'admin', order: 12, act: addDays(t, -1), weekdaysOnly: true }),
    newItem({ id: seeded('Book the dental hygienist'), title: 'Book the dental hygienist', category: 'health', order: 13, act: addDays(t, -9), due: addDays(t, 30) }),
    newItem({ id: seeded('Read the thing you saved'), title: 'Read the thing you saved', category: 'learning', order: 10, act: null }),
    newItem({ id: seeded('Find the passport'), title: 'Find the passport', order: 11, act: null }),

    newItem({ id: seeded('Swim'),
      title: 'Swim',
      category: 'exercise',
      order: 0,
      act: t,
      goalId: 'g-swim',
      recurrence: { every: 2, unit: 'day' },
    }),
    newItem({ id: seeded('Pool membership active'), title: 'Pool membership active', category: 'exercise', order: 1, goalId: 'g-swim' }),
    newItem({ id: seeded('First open-water session'), title: 'First open-water session', category: 'exercise', order: 2, act: addDays(t, 30), goalId: 'g-swim' }),
    newItem({ id: seeded('Entered'), title: 'Entered', category: 'exercise', order: 3, goalId: 'g-swim' }),

    newItem({ id: seeded('Refresh the CV'), title: 'Refresh the CV', category: 'career', order: 0, act: addDays(t, 4), goalId: 'g-role' }),
    newItem({ id: seeded('Write up recent work'), title: 'Write up recent work', category: 'career', order: 1, goalId: 'g-role' }),
    newItem({ id: seeded('First applications out'), title: 'First applications out', category: 'career', order: 2, act: addDays(t, 40), goalId: 'g-role' }),

    // Already archived, so the archive is not empty on a first run.
    newItem({ id: seeded('Return the parcel'),
      title: 'Return the parcel',
      category: 'admin',
      order: 12,
      act: addDays(t, -6),
      status: 'done',
      doneAt: instant(-6),
    }),
    newItem({ id: seeded('Cancel the old gym membership'),
      title: 'Cancel the old gym membership',
      category: 'exercise',
      order: 13,
      act: addDays(t, -9),
      status: 'done',
      doneAt: instant(-9),
    }),
    newItem({ id: seeded('Learn a second instrument'),
      title: 'Learn a second instrument',
      category: 'learning',
      order: 14,
      status: 'dropped',
      doneAt: instant(-12),
    }),
  ];

  return { items, goals, categories: DEFAULT_CATEGORIES, version: 6, reviewDeferredOn: null };
}
