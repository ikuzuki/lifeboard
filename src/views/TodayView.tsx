import { useRef, useState } from 'react';
import { ItemCard, type Slot } from '../components/ItemCard';
import { Empty, LaneHeading, Lanes } from '../components/Lane';
import { UNCATEGORISED, UNCATEGORISED_LABEL, categoriesOf, swatchHue } from '../lib/categories';
import { ReviewView } from './ReviewView';
import { useStore } from '../store';
import { isArchived, isDaily, isLive, pressure } from '../lib/dates';
import type { Category, Item, Pressure, Weight } from '../types';

/**
 * Overdue work gets its own heading again, but only a heading. The lane it used to have
 * carried the same five decisions as the weekly review, directly above it, in a different
 * order; the cards keep their own slot action and swipes, and the ritual stays in the
 * review card. So a slip is visible the very next morning without being asked about twice.
 */
const LANES: { p: Pressure; title: string; weight: Weight; slot: Slot }[] = [
  { p: 'slipped', title: 'What you missed', weight: 'lead', slot: 'start' },
  { p: 'now', title: 'Start today', weight: 'lead', slot: 'start' },
  // Flat, not a card. `normal` differs from `lead` by 2.5px of type and 2px of padding while
  // drawing the same background and border, so the two lanes read as equally substantial and
  // the hierarchy the lanes exist to express was invisible. Only what is actionable now gets
  // a card; what is coming gets a list.
  { p: 'soon', title: 'Start this week', weight: 'quiet', slot: 'today' },
];

const FOLDED: { p: Pressure; title: string; slot?: Slot }[] = [
  { p: 'later', title: 'Later', slot: 'today' },
  { p: 'undated', title: 'No date', slot: 'today' },
];

export function TodayView({
  onOpen,
  onComplete,
  onPullForward,
  onSnooze,
  filter,
  onFilter,
}: {
  onOpen: (id: string) => void;
  onComplete: (id: string) => void;
  onPullForward: (id: string) => void;
  onSnooze: (id: string) => void;
  filter: Category | null;
  onFilter: (c: Category | null) => void;
}) {
  const { state } = useStore();
  const [expanded, setExpanded] = useState<Pressure | null>(null);
  /** True while the What you missed pass is up, which walks the same overdue items. */
  const [passShowing, setPassShowing] = useState(false);

  // The lane an item was in when it was ticked. Nothing may move under the thumb at the
  // moment of tapping, so a completion holds its position until Today is left and
  // reopened, which is when done items collect at the bottom instead.
  const held = useRef(new Map<string, Pressure>());

  const scope = state.items.filter(isDaily);
  const visible = filter
    ? scope.filter((i) => (filter === UNCATEGORISED ? i.category === null : i.category === filter))
    : scope;
  const uncategorised = scope.filter((i) => i.category === null && isLive(i)).length;
  const byOrder = (a: Item, b: Item) => a.order - b.order;

  const laneOf = (i: Item): Pressure => held.current.get(i.id) ?? pressure(i);
  const onScreen = visible.filter(
    (i) => isLive(i) || (i.status === 'done' && held.current.has(i.id)),
  );
  const inLane = (p: Pressure) => onScreen.filter((i) => laneOf(i) === p).sort(byOrder);

  const complete = (id: string) => {
    const item = state.items.find((i) => i.id === id);
    if (item) held.current.set(id, laneOf(item));
    onComplete(id);
  };

  const doneToday = visible
    .filter((i) => i.status === 'done' && !isArchived(i) && !held.current.has(i.id))
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));

  const card = (i: Item, weight: Weight, slot?: Slot) => (
    <ItemCard
      key={i.id}
      item={i}
      onOpen={onOpen}
      onComplete={complete}
      onPullForward={onPullForward}
      onSnooze={onSnooze}
      slot={slot}
      weight={weight}
    />
  );

  // Weight is fixed per lane rather than per position, so the screen does not reshuffle
  // its own hierarchy every time something is ticked.
  const lane = (p: Pressure, title: string, weight: Weight, slot: Slot) => {
    const list = inLane(p);
    if (!list.length) return null;
    return (
      <section key={p} aria-labelledby={`lane-${p}`}>
        <LaneHeading id={`lane-${p}`} count={list.length} weight={weight}>
          {title}
        </LaneHeading>
        <ul className={`flex flex-col ${weight === 'lead' ? 'gap-2' : 'gap-1.5'}`}>
          {list.map((i) => card(i, weight, slot))}
        </ul>
      </section>
    );
  };

  return (
    <div>
      {/* Gates itself on whether a review is due, so it is absent most days. */}
      <ReviewView onOpen={onOpen} onComplete={onComplete} onShowing={setPassShowing} />

      <div
        className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1"
        role="group"
        aria-label="Filter by category"
      >
        <button
          type="button"
          onClick={() => onFilter(null)}
          aria-pressed={filter === null}
          className="min-h-11 flex-none rounded-full px-4 text-meta font-medium"
          style={{
            background: filter === null ? 'var(--foreground)' : 'transparent',
            color: filter === null ? 'var(--background)' : 'var(--muted-foreground)',
          }}
        >
          All
        </button>
        {categoriesOf(state).map((def) => {
          const c = def.id;
          const on = filter === c;
          const count = scope.filter((i) => i.category === c && isLive(i)).length;
          if (!count) return null;
          const hue = swatchHue(def.colour);
          return (
            <button
              key={c}
              type="button"
              onClick={() => onFilter(on ? null : c)}
              aria-pressed={on}
              className="flex min-h-11 flex-none items-center gap-2 rounded-full px-3.5 text-meta font-medium"
              style={{
                color: on ? 'var(--accent-foreground)' : 'var(--muted-foreground)',
                background: on ? hue : 'var(--muted)',
              }}
            >
              {!on && (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: hue }}
                  aria-hidden="true"
                />
              )}
              {def.label}
              <span className="mono text-micro" aria-hidden="true">
                {count}
              </span>
            </button>
          );
        })}
        {uncategorised > 0 && (
          <button
            type="button"
            onClick={() => onFilter(filter === UNCATEGORISED ? null : UNCATEGORISED)}
            aria-pressed={filter === UNCATEGORISED}
            className="flex min-h-11 flex-none items-center gap-2 rounded-full px-3.5 text-meta font-medium"
            style={{
              color:
                filter === UNCATEGORISED ? 'var(--accent-foreground)' : 'var(--muted-foreground)',
              background: filter === UNCATEGORISED ? 'var(--muted-foreground)' : 'var(--muted)',
            }}
          >
            {UNCATEGORISED_LABEL}
            <span className="mono text-micro" aria-hidden="true">
              {uncategorised}
            </span>
          </button>
        )}
      </div>

      <Lanes>

        {/* The pass above is a guided walk through the overdue items, so showing the lane
            underneath printed the same heading twice and the same cards twice. Whichever is
            on screen owns them. */}
        {LANES.filter((l) => !(passShowing && l.p === 'slipped')).map((l) =>
          lane(l.p, l.title, l.weight, l.slot),
        )}

        {doneToday.length > 0 && (
          <section aria-labelledby="lane-done">
            <LaneHeading id="lane-done" count={doneToday.length} weight="quiet">
              Done today
            </LaneHeading>
            <ul className="flex flex-col gap-1.5">{doneToday.map((i) => card(i, 'quiet'))}</ul>
          </section>
        )}

        <div>
          {FOLDED.map(({ p, title, slot }) => {
            const list = inLane(p);
            if (!list.length) return null;
            const showing = expanded === p;
            return (
              <section key={p}>
                <button
                  type="button"
                  onClick={() => setExpanded(showing ? null : p)}
                  aria-expanded={showing}
                  className="flex min-h-11 w-full items-center justify-between border-b text-body"
                  style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
                >
                  <span>{title}</span>
                  <span className="mono text-micro">
                    {list.length} {showing ? '−' : '+'}
                  </span>
                </button>
                {showing && (
                  <ul className="reveal-in mt-1.5 mb-2 flex flex-col gap-1.5">
                    {list.map((i) => card(i, 'quiet', slot))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </Lanes>

      {/* A list that has never held anything points at the button. One you have emptied
          yourself, or whose items are all later, is a different sentence. */}
      {onScreen.length === 0 && doneToday.length === 0 && (
        <Empty>
          {state.items.length === 0
            ? 'Nothing here yet. Add something below.'
            : 'Nothing live.'}
        </Empty>
      )}
    </div>
  );
}
