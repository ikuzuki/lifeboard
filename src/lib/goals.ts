import type { Goal, Item } from '../types';

export const isGoalLive = (goal: Goal): boolean => goal.status === 'live';

/** The goal an item is a step towards. Null when it has none, or the goal is gone. */
export function goalOf(goals: Goal[], item: Item): Goal | null {
  if (!item.goalId) return null;
  return goals.find((g) => g.id === item.goalId) ?? null;
}

/** Closed goals, most recently closed first. */
export function goalHistory(goals: Goal[]): Goal[] {
  return goals
    .filter((g) => !isGoalLive(g))
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''));
}

/** Undoes a closure without touching anything else the item carries. */
export const reopen = (item: Item): Item => ({ ...item, status: 'todo', doneAt: null });
