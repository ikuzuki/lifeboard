/**
 * Prints a demo state as JSON, dated relative to today. The README screenshots are taken
 * on this, never on real data. Load it by writing the output to the `lifeboard.state`
 * localStorage key in a fresh browser profile; the app migrates it into IndexedDB on boot.
 *
 *   npx tsx scripts/demo-state.ts > demo-state.json
 */
import type { Goal, Item, State } from '../src/types';
import { VERSION, newItem } from '../src/store';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import { addDays, today } from '../src/lib/dates';

const t = today();
const at = (days: number) => `${addDays(t, days)}T09:00:00.000Z`;

const goals: Goal[] = [
  { id: 'demo-10k', title: 'Run a sub-50 10k', category: 'exercise', horizon: 'by spring', description: '', parked: false, status: 'live', closedAt: null },
  { id: 'demo-spanish', title: 'Hold a conversation in Spanish', category: 'learning', horizon: 'by the summer', description: '', parked: false, status: 'live', closedAt: null },
  { id: 'demo-kitchen', title: 'Refit the kitchen', category: 'home', horizon: 'this year', description: '', parked: false, status: 'live', closedAt: null },
  { id: 'demo-books', title: 'Read twelve books', category: 'learning', horizon: 'this year', description: '', parked: false, status: 'done', closedAt: at(-20) },
];

let n = 0;
const item = (partial: Partial<Item> & { title: string }): Item =>
  newItem({ id: `demo-${++n}`, createdAt: at(-30), updatedAt: at(-1), ...partial });

const items: Item[] = [
  // Running
  item({ title: 'Run', category: 'exercise', goalId: 'demo-10k', act: t, recurrence: { every: 2, unit: 'day' }, streak: 6 }),
  item({ title: 'Enter the March 10k', category: 'exercise', goalId: 'demo-10k', act: addDays(t, 5), due: addDays(t, 21) }),
  item({ title: 'New running shoes', category: 'exercise', goalId: 'demo-10k', buy: true, cost: 95, act: addDays(t, 3) }),

  // Spanish
  item({ title: 'Spanish lesson', category: 'learning', goalId: 'demo-spanish', act: t, recurrence: { every: 1, unit: 'day' }, streak: 12 }),
  item({ title: 'Book a conversation class', category: 'learning', goalId: 'demo-spanish', act: addDays(t, 2), weekdaysOnly: true }),
  item({ title: 'Watch a film without subtitles', category: 'learning', goalId: 'demo-spanish' }),

  // Kitchen
  item({ title: 'Get three quotes', category: 'home', goalId: 'demo-kitchen', status: 'doing', act: addDays(t, -3), slips: 2 }),
  item({ title: 'Measure the units', category: 'home', goalId: 'demo-kitchen', status: 'done', doneAt: at(-4) }),
  item({ title: 'Pick worktop samples', category: 'home', goalId: 'demo-kitchen', act: addDays(t, 10) }),
  item({ title: 'Extractor fan', category: 'home', goalId: 'demo-kitchen', buy: true, cost: 240, act: addDays(t, 30) }),
  item({ title: 'Mixer tap', category: 'home', goalId: 'demo-kitchen', buy: true, cost: 120, act: addDays(t, 30) }),

  // Life admin and people
  item({ title: "Book a table for Mum's birthday", category: 'people', act: t, due: addDays(t, 18) }),
  item({ title: 'Ring the bank about the new card', category: 'admin', act: t, weekdaysOnly: true }),
  item({ title: 'Renew the passport', category: 'admin', act: addDays(t, 6), due: addDays(t, 60) }),
  item({ title: 'Claim the parcel refund', category: 'admin', act: addDays(t, 2), unblocks: addDays(t, 2) }),
  item({ title: 'Dentist check-up', category: 'health', act: addDays(t, -1), due: addDays(t, 14) }),
  item({ title: 'Birthday present for Alex', category: 'people', buy: true, cost: 40, act: addDays(t, 12) }),
  item({ title: 'Desk lamp', category: 'home', buy: true, cost: 35 }),
  item({ title: 'Read the saved article on sleep', category: 'learning' }),

  // History
  item({ title: 'Pay the council tax', category: 'admin', status: 'done', act: t, doneAt: `${t}T08:30:00.000Z`, updatedAt: `${t}T08:30:00.000Z` }),
  item({ title: 'Return the library books', category: 'admin', status: 'done', act: addDays(t, -2), doneAt: at(-2) }),
  item({ title: 'Cancel the unused subscription', category: 'admin', status: 'done', act: addDays(t, -5), doneAt: at(-5) }),
  item({ title: 'Learn to juggle', category: 'learning', status: 'dropped', doneAt: at(-10) }),
];

const state: State = { items, goals, categories: DEFAULT_CATEGORIES, version: VERSION, reviewDeferredOn: t };
process.stdout.write(JSON.stringify(state));
