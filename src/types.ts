/** The id of a user-defined category, or `null` where something is uncategorised. */
export type Category = string;

/** One of the ten fixed palette slots. */
export type Colour = string;

export interface CategoryDef {
  id: Category;
  label: string;
  colour: Colour;
}

/** `dropped` is a soft delete. Nothing in the app removes an item permanently. */
export type Status = 'todo' | 'doing' | 'done' | 'dropped';

/** Calendar day, `YYYY-MM-DD`. Never an instant: these are days, not moments. */
export type Day = string;

export interface Recurrence {
  every: number;
  unit: 'day' | 'week' | 'month';
  /** Occurrences left after the current one, or null to repeat with no end. */
  times?: number | null;
  /** Last day it may recur, or null to repeat with no end. */
  until?: Day | null;
}

export interface Note {
  at: string; // ISO instant, these are real moments
  text: string;
}

export interface Item {
  id: string;
  title: string;
  /** Null is a real answer: an item can be captured without one. */
  category: Category | null;
  status: Status;
  /** Manual priority within a lane. Lower sorts first. */
  order: number;
  /** Last responsible moment. All sorting and grouping derives from this. */
  act: Day | null;
  /** The real-world deadline, for display only. */
  due: Day | null;
  /** When a time-blocked item becomes actionable. */
  unblocks: Day | null;
  /** The goal this is a step towards. Goals have no steps of their own. */
  goalId: string | null;
  /** Set means completing it schedules the next occurrence instead of closing it. */
  recurrence: Recurrence | null;
  /** Phone calls mostly: at the weekend these drop out of the actionable set. */
  weekdaysOnly: boolean;
  description: string;
  notes: Note[];
  /** Marks the item as a purchase, which puts it on the Buy tab. */
  buy: boolean;
  cost: number | null;
  /** Times the start date has been pushed back. Three or more is a signal, not a failure. */
  slips: number;
  /** The last day a push happened, so a run of taps in one sitting counts once. */
  slippedOn: Day | null;
  /** Completions of a recurring item. */
  streak: number;
  createdAt: string;
  doneAt: string | null;
  /** ISO instant of the last change. Sync merges per item on this, not per document. */
  updatedAt: string;
}

/** A goal is live until it is finished or abandoned. Parked is a live goal on hold. */
export type GoalStatus = 'live' | 'done' | 'dropped';

export interface Goal {
  id: string;
  title: string;
  category: Category | null;
  horizon: string;
  /** Free text the user writes, or nothing. */
  description: string;
  /** Set when the goal is deliberately parked rather than quietly ignored. */
  parked: boolean;
  status: GoalStatus;
  /** ISO instant the goal was completed or dropped. */
  closedAt: string | null;
}

export interface State {
  /** The day the What you missed pass was pushed to tomorrow, if it was. */
  reviewDeferredOn: Day | null;
  items: Item[];
  goals: Goal[];
  /**
   * Optional because `mergeStates` in `lib/sync.ts` rebuilds a state without it. Read it
   * through `categoriesOf` in `lib/categories.ts`, never directly.
   */
  categories?: CategoryDef[];
  version: number;
}

export type Pressure =
  | 'slipped'
  | 'now'
  | 'soon'
  | 'later'
  | 'undated'
  | 'waiting'
  | 'done';

/** How much of the screen a card is entitled to. Derived from its lane, never stored. */
export type Weight = 'lead' | 'normal' | 'quiet';
