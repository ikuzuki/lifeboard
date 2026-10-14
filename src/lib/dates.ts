import type { Day, Goal, Item, Pressure, Recurrence } from '../types';

/**
 * Everything here works on calendar days as `YYYY-MM-DD`, never on instants.
 * Parsing anchors at local noon so that adding days can never trip over a
 * daylight-saving transition, which is what broke the previous implementation.
 */
export function parseDay(day: Day): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function toDay(date: Date): Day {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const today = (now = new Date()): Day => toDay(now);

export function addDays(day: Day, n: number): Day {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

export function addRecurrence(day: Day, r: Recurrence): Day {
  const d = parseDay(day);
  if (r.unit === 'day') d.setDate(d.getDate() + r.every);
  if (r.unit === 'week') d.setDate(d.getDate() + r.every * 7);
  if (r.unit === 'month') d.setMonth(d.getMonth() + r.every);
  return toDay(d);
}

/** Whole calendar days between today and `day`. Negative means the day has passed. */
export function daysUntil(day: Day | null, now = new Date()): number | null {
  if (!day) return null;
  const a = parseDay(today(now));
  const b = parseDay(day);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function isBlocked(item: Item, now = new Date()): boolean {
  if (item.unblocks) {
    const n = daysUntil(item.unblocks, now);
    if (n !== null && n > 0) return true;
  }
  return !windowOpen(item.weekdaysOnly, now);
}

export function blockReason(item: Item, now = new Date()): string {
  if (!windowOpen(item.weekdaysOnly, now)) return WEEKDAY_LABEL;
  if (item.unblocks) return `opens ${formatShort(item.unblocks)}`;
  return 'waiting';
}

/** Live means it still wants attention. Done and dropped both leave the daily surfaces. */
export const isLive = (item: Item) => item.status === 'todo' || item.status === 'doing';

/** An undated step lives on its goal. Give it a date and it joins the daily list. */
export const isDaily = (item: Item) => item.goalId === null || item.act !== null;

/**
 * Which lane an item belongs in. Status never moves it: starting something is not a lane,
 * and neither is being blocked. A blocked item still lanes by its dates and carries the
 * reason as a fact on the card, because a separate Waiting pile is somewhere work goes to
 * be forgotten.
 */
export function pressure(item: Item, now = new Date()): Pressure {
  if (item.status === 'done' || item.status === 'dropped') return 'done';
  const n = daysUntil(item.act, now);
  if (n === null) return 'undated';
  if (n < 0) return 'slipped';
  // Today only. Spanning tomorrow too made "move to tomorrow" look like it had done
  // nothing, because the card stayed in the lane it was already in.
  if (n === 0) return 'now';
  if (n <= 7) return 'soon';
  return 'later';
}

export function formatShort(day: Day | null): string {
  if (!day) return '';
  return parseDay(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function formatInstant(instant: string): string {
  return new Date(instant).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function relative(day: Day | null, now = new Date()): string {
  const n = daysUntil(day, now);
  if (n === null) return 'no date';
  if (n < 0) return `${Math.abs(n)}d late`;
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n <= 13) return `in ${n}d`;
  if (n <= 60) return `in ${Math.round(n / 7)}w`;
  return `in ${Math.round(n / 30)}mo`;
}

/**
 * The same date, named. An unlabelled bold date sits exactly where every other to-do app
 * puts a deadline, and the only labelled date on the card was `due`, so the pair read
 * backwards. "late" already says the right thing on its own.
 */
export function relativeStart(day: Day | null, now = new Date()): string {
  const text = relative(day, now);
  return text.endsWith('late') || text === 'no date' ? text : `start ${text}`;
}

export type Horizon = 'this-month' | 'next-month' | 'later' | 'wishlist';

/**
 * Which buying horizon a purchase sits in, derived from `act` rather than stored.
 *
 * There used to be a separate `phase` field, which meant a purchase carried two dates'
 * worth of intent and rescheduling one did not move the other. Deriving it means a
 * purchase you push back moves horizon on its own, and there is nothing to keep in step.
 *
 * Calendar months, not day counts: buying thinks in months, and "this month" on the 30th
 * genuinely is nearly over.
 */
export function buyHorizon(item: Item, now = new Date()): Horizon {
  if (!item.act) return 'wishlist';
  const act = parseDay(item.act);
  const months =
    (act.getFullYear() - now.getFullYear()) * 12 + (act.getMonth() - now.getMonth());
  if (months <= 0) return 'this-month';
  if (months === 1) return 'next-month';
  return 'later';
}

export const WEEKDAY_LABEL = 'opens Monday';

/** Hours are the user's business, in the description. The app only knows weekdays. */
export function windowOpen(weekdaysOnly: boolean, now = new Date()): boolean {
  if (!weekdaysOnly) return true;
  const day = now.getDay();
  return day !== 0 && day !== 6;
}

export function describeRecurrence(r: Recurrence): string {
  const every = r.every === 1 ? `every ${r.unit}` : `every ${r.every} ${r.unit}s`;
  if (r.times != null) return `${every}, ${r.times} left`;
  if (r.until) return `${every} until ${formatShort(r.until)}`;
  return every;
}

/** Whether this occurrence is the last one the recurrence allows. */
export function recurrenceEnds(r: Recurrence, next: Day): boolean {
  if (r.times != null && r.times <= 1) return true;
  return r.until != null && next > r.until;
}

/** Steps towards a goal, in the order they were added. */
export function goalSteps(goal: Goal, all: Item[]): Item[] {
  return all
    .filter((i) => i.goalId === goal.id && i.status !== 'dropped')
    .sort((a, b) => a.order - b.order);
}

export interface GoalProgress {
  steps: Item[];
  /** Repeating steps, which are listed but never counted: a habit cannot be finished. */
  habits: number;
  /** One-off steps only. A repeating commitment is never finished, so it cannot count. */
  done: number;
  total: number;
  /** Days since anything linked to the goal was last completed. */
  idle: number | null;
}

export function goalProgress(goal: Goal, all: Item[], now = new Date()): GoalProgress {
  const steps = goalSteps(goal, all);
  const oneOffs = steps.filter((i) => !i.recurrence);
  const last = steps
    .map((i) => i.doneAt)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);
  const idle = last === undefined ? null : -(daysUntil(toDay(new Date(last)), now) ?? 0);
  return {
    steps,
    habits: steps.length - oneOffs.length,
    done: oneOffs.filter((i) => i.status === 'done').length,
    total: oneOffs.length,
    idle,
  };
}

/** Done today, so it belongs in the Done today group rather than the archive. */
export function isDoneToday(item: Item, now = new Date()): boolean {
  if (item.status !== 'done' || !item.doneAt) return false;
  return toDay(new Date(item.doneAt)) === today(now);
}

export function isArchived(item: Item, now = new Date()): boolean {
  // Dropped items go straight to the archive: they are not an achievement to display,
  // but they must stay recoverable. Anything done before today follows them.
  if (item.status === 'dropped') return true;
  if (item.status !== 'done') return false;
  return !isDoneToday(item, now);
}
