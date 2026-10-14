import type { Item } from '../types';
import {
  blockReason,
  describeRecurrence,
  isBlocked,
  pressure,
  relative,
  relativeStart,
} from './dates';

/**
 * The one-line summary of an item: a named lead date plus the few facts worth showing
 * beside it. The card and the detail screen both render this, so a change to the priority
 * order or the wording lands in both rather than drifting apart.
 */
export interface Fact {
  key: string;
  text: string;
  colour?: string;
}

export interface Summary {
  lead: string;
  leadColour: string;
  facts: Fact[];
}

export function itemSummary(item: Item, now = new Date()): Summary {
  const p = pressure(item, now);
  const done = item.status === 'done' || item.status === 'dropped';
  const blocked = !done && isBlocked(item, now);

  const leadColour =
    done || p === 'later' || p === 'undated'
      ? 'var(--muted-foreground)'
      : p === 'now' || p === 'slipped'
        ? 'var(--now)'
        : 'var(--foreground)';

  // Capped by the caller. Seven facts at one size is a soup, three is a sentence.
  const facts: Fact[] = [];
  // First, because it is the reason the item cannot be picked up yet.
  if (blocked) facts.push({ key: 'opens', text: blockReason(item, now), colour: 'var(--waiting)' });
  if (item.due && item.due !== item.act && !done) {
    facts.push({ key: 'due', text: `due ${relative(item.due, now)}` });
  }
  if (item.slips >= 3 && !done) {
    facts.push({ key: 'slips', text: `moved ${item.slips} times`, colour: 'var(--now)' });
  }
  if (item.recurrence) facts.push({ key: 'rep', text: describeRecurrence(item.recurrence) });
  if (item.cost !== null) facts.push({ key: 'cost', text: `£${item.cost}` });
  // When blocked, the opens fact already says "weekdays only", so this would repeat it.
  if (item.weekdaysOnly && !done && !blocked) facts.push({ key: 'week', text: 'weekdays only' });
  if (item.streak > 0) facts.push({ key: 'streak', text: `${item.streak} done` });
  if (item.notes.length > 0) {
    facts.push({
      key: 'notes',
      text: `${item.notes.length} note${item.notes.length === 1 ? '' : 's'}`,
    });
  }

  return { lead: done ? 'done' : relativeStart(item.act, now), leadColour, facts };
}
