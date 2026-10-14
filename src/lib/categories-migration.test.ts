import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from './categories';
import { VERSION, migrate } from '../store';
import type { CategoryDef, State } from '../types';

const before = (categories?: CategoryDef[]): State =>
  ({ items: [], goals: [], version: 10, reviewDeferredOn: null, categories }) as State;

/** The seven a new install gets, which is the palette's answer as much as a taxonomy's. */
describe('the default set', () => {
  it('is the recommended seven, in order', () => {
    expect(DEFAULT_CATEGORIES.map((c) => c.label)).toEqual([
      'Health',
      'Exercise',
      'Career',
      'People',
      'Home',
      'Admin',
      'Learning',
    ]);
  });

  it('gives every category its own colour', () => {
    const colours = DEFAULT_CATEGORIES.map((c) => c.colour);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it('keeps the warm arc clear of the busiest categories, since --now and --doing live there', () => {
    // A started card swaps its category edge for the amber --doing token, so orange and yellow
    // go to the two lowest-traffic categories rather than to Health or Career.
    const warm = DEFAULT_CATEGORIES.filter((c) => c.colour === 'orange' || c.colour === 'yellow');
    expect(warm.map((c) => c.label).sort()).toEqual(['Home', 'Learning']);
  });
});

describe('adding People to a list that already exists', () => {
  it('adds it when it is missing', () => {
    const old: CategoryDef[] = [
      { id: 'health', label: 'Health', colour: 'red' },
      { id: 'events', label: 'Events', colour: 'orange' },
    ];
    const next = migrate(before(old));

    expect(next.categories?.map((c) => c.id)).toEqual(['health', 'events', 'people']);
  });

  it('gives it a colour nothing else is using', () => {
    const old: CategoryDef[] = [
      { id: 'events', label: 'Events', colour: 'red' },
      { id: 'b', label: 'B', colour: 'violet' },
    ];
    const people = migrate(before(old)).categories?.find((c) => c.id === 'people');

    expect(people?.colour).not.toBe('red');
    expect(people?.colour).not.toBe('violet');
  });

  it('leaves Events alone, because deleting a category with items in it is not its call', () => {
    const old: CategoryDef[] = [{ id: 'events', label: 'Events', colour: 'orange' }];
    expect(migrate(before(old)).categories?.map((c) => c.id)).toContain('events');
  });

  it('does not recolour what the user already chose', () => {
    const old: CategoryDef[] = [
      { id: 'career', label: 'Career', colour: 'pink' },
      { id: 'events', label: 'Events', colour: 'orange' },
    ];
    const career = migrate(before(old)).categories?.find((c) => c.id === 'career');

    expect(career?.colour).toBe('pink');
  });

  it('adds nothing when People is already there', () => {
    const old: CategoryDef[] = [
      { id: 'people', label: 'Mates', colour: 'teal' },
      { id: 'events', label: 'Events', colour: 'orange' },
    ];
    const next = migrate(before(old));

    expect(next.categories).toHaveLength(2);
    expect(next.categories?.find((c) => c.id === 'people')?.label).toBe('Mates');
  });

  it('leaves a curated list alone, because those are choices rather than defaults', () => {
    // Someone who has cut their categories down to one is not waiting for a new one.
    const curated: CategoryDef[] = [{ id: 'money', label: 'Money', colour: 'yellow' }];
    expect(migrate(before(curated)).categories).toEqual(curated);
  });

  it('leaves the document on the current version', () => {
    expect(migrate(before()).version).toBe(VERSION);
  });
});
