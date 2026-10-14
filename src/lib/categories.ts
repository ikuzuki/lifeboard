import type { Category, CategoryDef, Colour, State } from '../types';

/**
 * Categories are user data. Ten is the ceiling because the palette is ten fixed slots:
 * beyond that the colours stop being distinguishable and the encoding stops carrying
 * meaning, so a limit is kinder than a colour picker.
 */
export const MAX_CATEGORIES = 10;

export interface Swatch {
  id: Colour;
  label: string;
}

export const PALETTE: Swatch[] = [
  { id: 'red', label: 'Red' },
  { id: 'orange', label: 'Orange' },
  { id: 'yellow', label: 'Yellow' },
  { id: 'green', label: 'Green' },
  { id: 'teal', label: 'Teal' },
  { id: 'blue', label: 'Blue' },
  { id: 'indigo', label: 'Indigo' },
  { id: 'violet', label: 'Violet' },
  { id: 'pink', label: 'Pink' },
  { id: 'slate', label: 'Slate' },
];

/**
 * Seven, and seven is the palette's answer rather than a taxonomy's: six chromatic hues plus
 * achromatic slate is the largest set clearing a 40 degree minimum hue separation, and a
 * seventh chromatic hue drops that to 35. The previous set paid that penalty for nothing, by
 * having both green at 160 and teal at 195 in play.
 *
 * `Events` is gone because it named an item shape rather than a part of life, and the app
 * already says shape three times over: in `act` against `due`, in `buy`, and in the calendar.
 * `People` replaces it. Every life-domain taxonomy has a relationships domain and the old set
 * named no one, and social obligation is the most window-shaped work there is, which suits an
 * app built on the last day you can start something.
 *
 * Orange and yellow go to the two lowest-traffic categories on purpose: `--now` sits at hue 42
 * and `--doing` at 75, so the warm arc is already spoken for, and a started card swaps its
 * category edge for the amber `--doing` token.
 */
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { id: 'health', label: 'Health', colour: 'red' },
  { id: 'exercise', label: 'Exercise', colour: 'green' },
  { id: 'career', label: 'Career', colour: 'blue' },
  { id: 'people', label: 'People', colour: 'violet' },
  { id: 'home', label: 'Home', colour: 'orange' },
  { id: 'admin', label: 'Admin', colour: 'slate' },
  { id: 'learning', label: 'Learning', colour: 'yellow' },
];

/**
 * One word for "no category", used by the filter chip and both dropdowns. It was
 * "Uncategorised" in the dropdowns and "Other" on the chip, which is the same idea named
 * twice; the chip is the space-constrained surface, so the short one won.
 */
export const UNCATEGORISED_LABEL = 'Other';

/** The edge and dot colour for anything with no category. Reads as absence, not as a hue. */
export const UNCATEGORISED_HUE = 'var(--border)';

/**
 * Filter sentinel meaning "has no category", distinct from null, which means "no filter".
 * Collision-proof: `slug` strips everything but a-z0-9 and hyphens, so no real id can
 * contain a colon.
 */
export const UNCATEGORISED: Category = ':none';

export function categoriesOf(state: Pick<State, 'categories'>): CategoryDef[] {
  return state.categories ?? DEFAULT_CATEGORIES;
}

export function swatchHue(colour: Colour): string {
  return `var(--cat-${colour})`;
}

export function findCategory(list: CategoryDef[], id: Category | null): CategoryDef | null {
  if (!id) return null;
  return list.find((c) => c.id === id) ?? null;
}

/** An id the list does not know about is uncategorised, same as a null one. */
export function categoryHue(list: CategoryDef[], id: Category | null): string {
  const found = findCategory(list, id);
  return found ? swatchHue(found.colour) : UNCATEGORISED_HUE;
}

export function categoryLabel(list: CategoryDef[], id: Category | null): string {
  return findCategory(list, id)?.label ?? UNCATEGORISED_LABEL;
}

/** The first palette slot nothing is using, so a new category never arrives a duplicate. */
export function nextColour(list: CategoryDef[]): Colour {
  const taken = new Set(list.map((c) => c.colour));
  return (PALETTE.find((s) => !taken.has(s.id)) ?? PALETTE[0]).id;
}

export function slug(label: string): Category {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'category';
}

export function uniqueId(list: CategoryDef[], label: string): Category {
  const base = slug(label);
  if (!list.some((c) => c.id === base)) return base;
  let n = 2;
  while (list.some((c) => c.id === `${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * The built-in seven, keyed by id. Surfaces that have not moved to `state.categories`
 * read this, so they show the defaults rather than what the user actually has.
 */
export const CATEGORIES: Record<Category, { label: string; hue: string }> = Object.fromEntries(
  DEFAULT_CATEGORIES.map((c) => [c.id, { label: c.label, hue: swatchHue(c.colour) }]),
);

export const CATEGORY_KEYS: Category[] = DEFAULT_CATEGORIES.map((c) => c.id);
