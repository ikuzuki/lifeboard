import { createContext, useContext } from 'react';
import type { Category, Colour, Day, Goal, Item, Recurrence, State } from './types';
import { seed } from './seed';
import {
  DEFAULT_CATEGORIES,
  MAX_CATEGORIES,
  PALETTE,
  categoriesOf,
  nextColour,
  uniqueId,
} from './lib/categories';
import { addDays, addRecurrence, isLive, recurrenceEnds, toDay, today } from './lib/dates';

export const KEY = 'lifeboard.state';
export const VERSION = 11;

export class StateCorruptError extends Error {}

export type Action =
  | { type: 'add'; item: Item }
  /** Accepting a whole reviewed batch. One reduction so a batch is one undo, one write. */
  | { type: 'addMany'; items: Item[] }
  | { type: 'patch'; id: string; patch: Partial<Item> }
  | { type: 'complete'; id: string }
  | { type: 'start'; id: string }
  | { type: 'stop'; id: string }
  | { type: 'pullForward'; id: string }
  | { type: 'snooze'; id: string; days: number }
  | { type: 'drop'; id: string }
  | { type: 'restoreItem'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'note'; id: string; text: string }
  | { type: 'addGoal'; goal: Goal }
  | { type: 'patchGoal'; goalId: string; patch: Partial<Goal> }
  | { type: 'parkGoal'; goalId: string }
  | { type: 'completeGoal'; goalId: string }
  | { type: 'dropGoal'; goalId: string }
  | { type: 'reviveGoal'; goalId: string }
  | { type: 'removeGoal'; goalId: string }
  | { type: 'addCategory'; label: string }
  | { type: 'patchCategory'; id: Category; patch: { label?: string; colour?: Colour } }
  | { type: 'removeCategory'; id: Category }
  | { type: 'restore'; state: State }
  | { type: 'restoreItems'; items: Item[] }
  | { type: 'deferReview'; day: Day | null }
  | { type: 'reset' };

export function uid(): string {
  // randomUUID is undefined on non-secure origins, which includes testing over the LAN.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isState(value: unknown): value is State {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<State>;
  return (
    Array.isArray(v.items) &&
    Array.isArray(v.goals) &&
    typeof v.version === 'number' &&
    v.items.every((i) => typeof i?.id === 'string' && typeof i?.title === 'string')
  );
}

/**
 * Migrations run in order from the stored version. Never reseed over existing data:
 * losing the user's list to a schema bump is worse than any migration bug.
 */
export function migrate(raw: State): State {
  let s = raw;
  if (s.version < 4) {
    s = {
      ...s,
      version: 4,
      items: s.items.map((i) => {
        const legacy = i as Item & { kind?: string; cadence?: string | null };
        // v3 stored instants. Slicing the string would read back a day early under BST,
        // which was the original bug, so convert through a Date to the local day.
        const day = (v: unknown) => {
          if (typeof v !== 'string' || v.length < 10) return null;
          return v.includes('T') ? toDay(new Date(v)) : v.slice(0, 10);
        };
        return {
          ...i,
          act: day(i.act),
          due: day(i.due),
          unblocks: day(i.unblocks),
          buy: legacy.buy ?? legacy.kind === 'buy',
          recurrence: i.recurrence ?? null,
          slips: i.slips ?? 0,
          streak: i.streak ?? 0,
        };
      }),
    };
  }
  if (s.version < 5) {
    // Milestones become real items, so a goal can own a repeating commitment and
    // report activity from the same place everything else reports it.
    const at = new Date().toISOString();
    const promoted: Item[] = [];
    const goals = s.goals.map((g) => {
      const legacy = g as Goal & {
        why?: string;
        milestones?: { id: string; text: string; done: boolean }[];
      };
      (legacy.milestones ?? []).forEach((m, n) =>
        promoted.push(
          newItem({
            title: m.text,
            category: g.category,
            order: n,
            goalId: g.id,
            status: m.done ? 'done' : 'todo',
            doneAt: m.done ? at : null,
          }),
        ),
      );
      return {
        id: g.id,
        title: g.title,
        category: g.category,
        horizon: g.horizon,
        description: legacy.description ?? legacy.why ?? '',
        parked: g.parked,
        status: g.status ?? 'live',
        closedAt: g.closedAt ?? null,
      };
    });
    s = {
      ...s,
      version: 5,
      goals,
      items: [...s.items.map((i) => ({ ...i, goalId: i.goalId ?? null })), ...promoted],
    };
  }
  if (s.version < 6) {
    // Two independent changes landed on the same version, so this one step does both.
    //
    // Categories become user data. The built-in ids are unchanged, so every existing item
    // still resolves; anything pointing at an id the list does not hold goes uncategorised.
    //
    // `blockedBy` was never settable from the UI, and contact hours are description
    // material. Both go; the weekday rule is the only part that changed behaviour.
    const categories = s.categories ?? DEFAULT_CATEGORIES;
    const known = new Set(categories.map((c) => c.id));
    const keep = (id: Category | null) => (id && known.has(id) ? id : null);
    s = {
      ...s,
      version: 6,
      categories,
      items: s.items.map((i) => {
        const legacy = i as Item & {
          blockedBy?: string | null;
          contact?: { weekdaysOnly?: boolean } | null;
        };
        const { blockedBy: _b, contact: _c, ...rest } = legacy;
        return {
          ...rest,
          category: keep(legacy.category),
          weekdaysOnly: legacy.contact?.weekdaysOnly ?? false,
        };
      }),
      // Rebuilt rather than spread, which is what drops the icon a goal could hold but
      // never set.
      goals: s.goals.map((g) => ({
        id: g.id,
        title: g.title,
        category: keep(g.category),
        horizon: g.horizon ?? '',
        description: g.description ?? '',
        parked: g.parked ?? false,
        status: g.status ?? 'live',
        closedAt: g.closedAt ?? null,
      })),
    };
  }

  if (s.version < 7) {
    // `phase` held the buying horizon, which `act` already implies. Two fields for one
    // intent meant rescheduling a purchase left its horizon behind, and nothing but the
    // seed could set it above 1 anyway. The horizon is derived now.
    s = {
      ...s,
      version: 7,
      items: s.items.map((i) => {
        const { phase: _p, ...rest } = i as Item & { phase?: number | null };
        return rest as Item;
      }),
    };
  }

  if (s.version < 8) {
    // `slips` counted taps, so pushing something on by five days in one go read as five
    // separate slips. Existing counts are kept as they are: they are not recoverable into
    // occasions, and they are honest about the number of pushes.
    s = {
      ...s,
      version: 8,
      items: s.items.map((i) => ({ ...i, slippedOn: (i as Item).slippedOn ?? null })),
    };
  }

  if (s.version < 9) {
    // The deferral lived in its own localStorage key, which made it the one piece of
    // user-visible state that silently differed per device. Lifted into the document so it
    // syncs like everything else.
    let lifted: Day | null = null;
    try {
      const raw = localStorage.getItem('lifeboard.review');
      if (raw) {
        const parsed = JSON.parse(raw) as { deferredOn?: unknown };
        if (typeof parsed.deferredOn === 'string') lifted = parsed.deferredOn;
      }
      localStorage.removeItem('lifeboard.review');
    } catch {
      /* unreadable or unavailable; a missing deferral just means the pass shows */
    }
    s = { ...s, version: 9, reviewDeferredOn: lifted };
  }

  if (s.version < 10) {
    // Clears the starter list out of anyone who already has it. A new install starts empty
    // now, but whoever signed in before that change is holding two dozen example tasks with
    // nothing marking them as examples, and the first person shared with reasonably concluded
    // she was looking at someone else's data.
    //
    // Only untouched items go. An example that was edited, completed or dropped is a decision
    // somebody made and stops being an example. Goals are matched on id *and* title, because
    // the seed's `g-swim` is "Swim a long-distance event" while a real account can hold its
    // own goal under the same id: the id alone would delete real work.
    const demoGoals = [
      { id: 'g-swim', title: 'Swim a long-distance event' },
      { id: 'g-role', title: 'Move to a bigger role' },
    ];
    const goals = s.goals.filter(
      (g) => !demoGoals.some((demo) => demo.id === g.id && demo.title === g.title),
    );
    const kept = new Set(goals.map((g) => g.id));
    s = {
      ...s,
      version: 10,
      goals,
      items: s.items
        .filter((i) => !(i.id.startsWith('seed-') && i.updatedAt === i.createdAt))
        // A survivor whose goal has gone becomes an ordinary item rather than an orphan.
        .map((i) => (i.goalId !== null && !kept.has(i.goalId) ? { ...i, goalId: null } : i)),
    };
  }

  if (s.version < 11) {
    // `People` joins the defaults, so a list that already exists gets it too. Deliberately
    // narrow: the new defaults also move three colours, and doing that here would collide,
    // because `Home` moves onto the orange `Events` still holds while `People` wants the violet
    // `Home` still holds. A colour already in a list is the user's own, and the picker in
    // Settings swaps them safely. `Events` stays put: dropping a category with items in it is
    // not a migration's call to make.
    // Only for a list that still carries `Events`, which is what `People` replaces. Someone
    // who has already curated their categories has made their own choices, and appending to
    // that is not an upgrade, it is an intrusion.
    const list = s.categories ?? DEFAULT_CATEGORIES;
    const replaceable = list.some((c) => c.id === 'events');
    if (replaceable && !list.some((c) => c.id === 'people') && list.length < MAX_CATEGORIES) {
      const taken = new Set(list.map((c) => c.colour));
      const free = PALETTE.map((swatch) => swatch.id).find((id) => !taken.has(id));
      s = {
        ...s,
        categories: [...list, { id: 'people', label: 'People', colour: free ?? 'violet' }],
      };
    }
    s = { ...s, version: 11 };
  }

  // Backfill for data written before per-item timestamps existed. Runs on shape rather
  // than version, so it also catches items promoted above. Nothing else can date these,
  // so the creation instant is the honest answer.
  if (s.items.some((i) => typeof i.updatedAt !== 'string')) {
    s = {
      ...s,
      items: s.items.map((i) =>
        typeof i.updatedAt === 'string'
          ? i
          : { ...i, updatedAt: i.doneAt ?? i.createdAt ?? new Date(0).toISOString() },
      ),
    };
  }
  return s;
}

export function load(): State {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return seed();
  }
  if (raw === null) return seed();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A key existed and we could not read it. Halt rather than silently overwrite.
    throw new StateCorruptError('Saved data could not be read.');
  }
  if (!isState(parsed)) throw new StateCorruptError('Saved data is not in the expected shape.');
  return migrate(parsed);
}

export function persist(state: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota or private browsing; the app still works for this session */
  }
}

export function exportState(): string {
  try {
    return localStorage.getItem(KEY) ?? '{}';
  } catch {
    return '{}';
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing useful to do */
  }
}

/** Ask the browser not to evict the store under storage pressure. */
export function requestPersistence(): void {
  void navigator.storage?.persist?.().catch(() => undefined);
}

/**
 * Closing a goal closes the steps still open under it. They are dropped rather than
 * completed: leftover steps were not done, and dropped keeps them out of the daily
 * surfaces while staying recoverable from the archive.
 */
function closeGoal(state: State, goalId: string, status: 'done' | 'dropped'): State {
  const at = new Date().toISOString();
  return {
    ...state,
    goals: state.goals.map((g) =>
      g.id === goalId ? { ...g, status, closedAt: at, parked: false } : g,
    ),
    items: state.items.map((i) =>
      i.goalId === goalId && isLive(i) ? { ...i, status: 'dropped', doneAt: at } : i,
    ),
  };
}

/**
 * Completing a recurring item schedules the next one instead of closing it, unless the
 * recurrence has run out of occurrences or run past its end date.
 */
function completeItem(item: Item): Item {
  return { ...item, status: 'done', doneAt: new Date().toISOString() };
}

/**
 * Finishing a repeat closes the occurrence you did and schedules the next one as its own
 * record. The occurrence used to be mutated in place, kept at `todo` with its date pushed
 * on, so ticking a daily habit struck nothing through, collected nothing in Done today, and
 * on Today it did not even move: the lane holds a card where it was at the moment you
 * tapped it, so the screen answered a tap with nothing at all.
 *
 * The cost is one archived record per occurrence, which is the honest price of a history.
 */
function completeRecurring(item: Item, rule: Recurrence, at: string): Item[] {
  const closed: Item = {
    ...item,
    status: 'done',
    doneAt: at,
    streak: item.streak + 1,
  };
  const next = addRecurrence(item.act ?? today(), rule);
  if (recurrenceEnds(rule, next)) return [closed];

  const { times } = rule;
  const upcoming: Item = {
    ...item,
    id: uid(),
    status: 'todo',
    act: next,
    doneAt: null,
    recurrence: times == null ? rule : { ...rule, times: times - 1 },
    streak: item.streak + 1,
    // A fresh occurrence has not been put off yet.
    slips: 0,
    slippedOn: null,
    createdAt: at,
    updatedAt: at,
  };
  return [closed, upcoming];
}

/**
 * Sync merges per item on `updatedAt`, so every item a reduction actually replaced has
 * to carry a fresh instant. Identity comparison is enough because every case below
 * rebuilds the items it changes.
 */
function stamp(before: State, after: State): State {
  if (before.items === after.items) return after;
  const at = new Date().toISOString();
  const previous = new Map(before.items.map((i) => [i.id, i]));
  return {
    ...after,
    items: after.items.map((i) => (previous.get(i.id) === i ? i : { ...i, updatedAt: at })),
  };
}

export function reducer(state: State, action: Action): State {
  // A restore swaps in a whole document that carries its own per-item timestamps. Running
  // it through `stamp` would re-date every item, making this device look authoritative
  // over edits it never made and letting a three-week-old import beat a recent change on
  // another device. Per-item last-write-wins only works if the timestamps are honest.
  if (action.type === 'restore') return action.state;
  return stamp(state, reduce(state, action));
}

/** The category picker reports uncategorised as an empty string. Storage keeps null. */
const normalise = (item: Item): Item => (item.category ? item : { ...item, category: null });

function reduce(state: State, action: Action): State {
  const mapItem = (id: string, fn: (i: Item) => Item): State => ({
    ...state,
    items: state.items.map((i) => (i.id === id ? fn(i) : i)),
  });

  switch (action.type) {
    case 'add':
      return { ...state, items: [normalise(action.item), ...state.items] };

    case 'addMany':
      if (action.items.length === 0) return state;
      return { ...state, items: [...action.items, ...state.items] };

    case 'patch':
      return mapItem(action.id, (i) => normalise({ ...i, ...action.patch }));

    case 'complete': {
      const item = state.items.find((i) => i.id === action.id);
      if (!item) return state;
      if (!item.recurrence) return mapItem(action.id, completeItem);
      const at = new Date().toISOString();
      const [closed, upcoming] = completeRecurring(item, item.recurrence, at);
      const items = state.items.map((i) => (i.id === item.id ? closed : i));
      return { ...state, items: upcoming ? [...items, upcoming] : items };
    }

    case 'start':
      return mapItem(action.id, (i) => ({ ...i, status: 'doing' }));

    case 'stop':
      return mapItem(action.id, (i) => ({ ...i, status: 'todo' }));

    // Pulling forward is not a slip: the user chose to do it sooner, not later.
    case 'pullForward':
      return mapItem(action.id, (i) => ({ ...i, act: today() }));

    // Ends the repeat and closes the item, so a habit can finish without being dropped.
    case 'snooze':
      return mapItem(action.id, (i) => {
        const from = i.act && i.act >= today() ? i.act : today();
        // Counted per day, not per tap. Five swipes in one sitting is one decision to put
        // something off, and "moved 5 times" should mean five days you chose not to start
        // it, which is the signal worth seeing on the card.
        const day = today();
        return {
          ...i,
          act: addDays(from, action.days),
          slips: i.slippedOn === day ? i.slips : i.slips + 1,
          slippedOn: day,
        };
      });

    case 'drop':
      return mapItem(action.id, (i) => ({
        ...i,
        status: 'dropped',
        doneAt: new Date().toISOString(),
      }));

    case 'restoreItem':
      return mapItem(action.id, (i) => ({ ...i, status: 'todo', doneAt: null }));

    // Permanent. Only reachable from the archive, behind a confirmation.
    case 'remove':
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };

    case 'restore':
      return action.state;

    /**
     * Undo puts back only the items the action actually touched. Rolling the whole
     * document back to a snapshot silently discarded anything else changed while the
     * toast was still up, which is how a started item could quietly un-start.
     */
    case 'restoreItems': {
      const before = new Map(action.items.map((i) => [i.id, i]));
      const seen = new Set<string>();
      const items = state.items.map((i) => {
        const original = before.get(i.id);
        if (!original) return i;
        seen.add(i.id);
        return original;
      });
      // An item that has since been removed outright comes back rather than vanishing.
      const gone = action.items.filter((i) => !seen.has(i.id));
      return { ...state, items: [...gone, ...items] };
    }

    case 'note':
      return mapItem(action.id, (i) => ({
        ...i,
        notes: [...i.notes, { at: new Date().toISOString(), text: action.text }],
      }));

    case 'addGoal':
      return { ...state, goals: [action.goal, ...state.goals] };

    case 'patchGoal':
      return {
        ...state,
        goals: state.goals.map((g) => (g.id === action.goalId ? { ...g, ...action.patch } : g)),
      };

    case 'parkGoal':
      return {
        ...state,
        goals: state.goals.map((g) => (g.id === action.goalId ? { ...g, parked: !g.parked } : g)),
      };

    case 'completeGoal':
      return closeGoal(state, action.goalId, 'done');

    case 'dropGoal':
      return closeGoal(state, action.goalId, 'dropped');

    // Steps closed with the goal stay closed. Reviving the goal does not undo work.
    case 'reviveGoal':
      return {
        ...state,
        goals: state.goals.map((g) =>
          g.id === action.goalId ? { ...g, status: 'live', closedAt: null } : g,
        ),
      };

    // Steps outlive the goal they were attached to. Deleting a goal must not delete work.
    case 'removeGoal':
      return {
        ...state,
        goals: state.goals.filter((g) => g.id !== action.goalId),
        items: state.items.map((i) => (i.goalId === action.goalId ? { ...i, goalId: null } : i)),
      };

    case 'addCategory': {
      const list = categoriesOf(state);
      const label = action.label.trim();
      if (!label || list.length >= MAX_CATEGORIES) return state;
      return {
        ...state,
        categories: [...list, { id: uniqueId(list, label), label, colour: nextColour(list) }],
      };
    }

    // Colours stay one to one. Taking a colour another category holds hands that one the
    // colour being vacated, so recolouring still works with all ten slots in use.
    case 'patchCategory': {
      const list = categoriesOf(state);
      const target = list.find((c) => c.id === action.id);
      if (!target) return state;
      const { colour } = action.patch;
      return {
        ...state,
        categories: list.map((c) => {
          if (c.id === target.id) return { ...c, ...action.patch };
          if (colour && c.colour === colour) return { ...c, colour: target.colour };
          return c;
        }),
      };
    }

    // Whatever used it becomes uncategorised. Deleting a category never deletes work.
    case 'removeCategory':
      return {
        ...state,
        categories: categoriesOf(state).filter((c) => c.id !== action.id),
        items: state.items.map((i) => (i.category === action.id ? { ...i, category: null } : i)),
        goals: state.goals.map((g) => (g.category === action.id ? { ...g, category: null } : g)),
      };

    case 'deferReview':
      return { ...state, reviewDeferredOn: action.day };

    // Empty, not seeded. Reset used to return the starter list, which is right for a first
    // run and wrong for a reset: someone clearing the app out is not asking for a demo, and
    // starter items reappearing then merged themselves back up through sync.
    case 'reset':
      return {
        items: [],
        goals: [],
        categories: DEFAULT_CATEGORIES,
        version: VERSION,
        reviewDeferredOn: null,
      };

    default:
      return state;
  }
}

export function newItem(partial: Partial<Item> & { title: string }): Item {
  return {
    id: uid(),
    category: null,
    status: 'todo',
    order: 0,
    act: null,
    due: null,
    unblocks: null,
    goalId: null,
    recurrence: null,
    weekdaysOnly: false,
    description: '',
    notes: [],
    buy: false,
    cost: null,
    slips: 0,
    slippedOn: null,
    streak: 0,
    createdAt: new Date().toISOString(),
    doneAt: null,
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

export function newGoal(partial: Partial<Goal> & { title: string }): Goal {
  return {
    id: uid(),
    category: null,
    horizon: '',
    description: '',
    parked: false,
    status: 'live',
    closedAt: null,
    ...partial,
  };
}

export interface Store {
  state: State;
  dispatch: (a: Action) => void;
}

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreContext');
  return ctx;
}
