import { useRef, useState } from 'react';
import { ItemCard } from '../components/ItemCard';
import { Empty, LaneHeading } from '../components/Lane';
import { TextButton } from '../components/controls';
import { useStore } from '../store';
import { categoriesOf, categoryHue } from '../lib/categories';
import { isDaily, isLive, parseDay, toDay, today } from '../lib/dates';
import type { Day, Item } from '../types';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Past this much horizontal travel a drag is a month change, not a day tap. */
const SWIPE = 48;

const Arrow = ({ path, label, onClick }: { path: string; label: string; onClick: () => void }) => (
  <button
    type="button"
    aria-label={label}
    onClick={onClick}
    className="grid h-11 w-11 place-items-center rounded-full"
    style={{ background: 'var(--muted)' }}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  </button>
);

/**
 * Three marks, no caption: a start is a category dot under the numeral, a deadline is a
 * ring around it, today is a filled disc. Swipe left for the next month, right for the
 * previous; the chevrons do the same job for a pointer and a keyboard.
 */
export function CalendarView({
  onOpen,
  onAdd,
}: {
  onOpen: (id: string) => void;
  onAdd?: (day: Day) => void;
}) {
  const { state } = useStore();
  const t = today();
  const anchor = parseDay(t);
  const [cursor, setCursor] = useState(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  // Opens on today, so the panel below the grid is never an empty region.
  const [picked, setPicked] = useState<Day | null>(t);

  const drag = useRef<{ x: number; y: number; locked: boolean } | null>(null);
  // A committed swipe still ends in a click on the day under the finger, so it is swallowed.
  const swiped = useRef(false);

  const live = state.items.filter((i) => isLive(i) && isDaily(i));

  const starts = new Map<Day, Item[]>();
  const dues = new Map<Day, Item[]>();
  live.forEach((i) => {
    if (i.act) starts.set(i.act, [...(starts.get(i.act) ?? []), i]);
    if (i.due) dues.set(i.due, [...(dues.get(i.due) ?? []), i]);
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const total = new Date(year, month + 1, 0).getDate();
  const cells: (Day | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, n) => toDay(new Date(year, month, n + 1))),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const step = (n: number) => {
    setCursor(new Date(year, month + n, 1));
    setPicked(null);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, locked: false };
    swiped.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!drag.current) return;
    const dx = e.touches[0].clientX - drag.current.x;
    const dy = e.touches[0].clientY - drag.current.y;
    if (!drag.current.locked) {
      if (Math.abs(dy) > Math.abs(dx)) {
        drag.current = null;
        return;
      }
      if (Math.abs(dx) > 10) drag.current.locked = true;
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!drag.current?.locked) {
      drag.current = null;
      return;
    }
    const dx = e.changedTouches[0].clientX - drag.current.x;
    if (Math.abs(dx) > SWIPE) {
      step(dx < 0 ? 1 : -1);
      swiped.current = true;
    }
    drag.current = null;
  };

  const monthLabel = cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const pickedStarts = picked ? (starts.get(picked) ?? []) : [];
  const pickedDues = picked ? (dues.get(picked) ?? []).filter((i) => i.act !== picked) : [];

  return (
    <div>
      <div className="flex items-center justify-between">
        <Arrow path="M15 5l-7 7 7 7" label="Previous month" onClick={() => step(-1)} />
        <span className="text-row font-semibold tracking-[-0.008em]" aria-live="polite">
          {monthLabel}
        </span>
        <Arrow path="M9 5l7 7-7 7" label="Next month" onClick={() => step(1)} />
      </div>

      <div
        className="mt-4 grid grid-cols-7 gap-1 text-center text-micro"
        style={{ color: 'var(--muted-foreground)' }}
        aria-hidden="true"
      >
        {WEEKDAYS.map((d, n) => (
          <span key={n}>{d}</span>
        ))}
      </div>

      <div
        key={monthLabel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="reveal-in mt-1 grid grid-cols-7 gap-1"
        style={{ touchAction: 'pan-y' }}
        role="grid"
        aria-label={`${monthLabel} calendar`}
      >
        {cells.map((day, n) => {
          if (!day) return <span key={`pad-${n}`} role="gridcell" />;
          const items = starts.get(day) ?? [];
          const deadlines = dues.get(day) ?? [];
          // An empty day adds on that date; a day with items selects, as it always did.
          const adds = items.length === 0 && deadlines.length === 0 && onAdd !== undefined;
          const isToday = day === t;
          const isPicked = day === picked;
          const d = parseDay(day);
          const label = d.toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          });
          return (
            <button
              key={day}
              type="button"
              role="gridcell"
              aria-label={
                adds
                  ? `${label}. Nothing on this day, add an item`
                  : `${label}. ${items.length} starting, ${deadlines.length} due`
              }
              aria-pressed={adds ? undefined : isPicked}
              onClick={() => {
                if (swiped.current) {
                  swiped.current = false;
                  return;
                }
                if (adds && onAdd) {
                  onAdd(day);
                  return;
                }
                setPicked(isPicked ? null : day);
              }}
              className="flex aspect-square min-h-11 flex-col items-center justify-center gap-1 rounded-lg border"
              style={{
                borderColor: isPicked ? 'var(--accent)' : 'transparent',
                borderWidth: isPicked ? 1.5 : 1,
                background: isPicked ? 'var(--muted)' : 'transparent',
              }}
            >
              <span
                className="mono grid h-[26px] w-[26px] place-items-center rounded-full text-meta"
                style={{
                  background: isToday ? 'var(--foreground)' : 'transparent',
                  color: isToday
                    ? 'var(--background)'
                    : day < t
                      ? 'var(--muted-foreground)'
                      : 'var(--foreground)',
                  fontWeight: isToday ? 700 : 400,
                  boxShadow: deadlines.length
                    ? '0 0 0 2px var(--background), 0 0 0 4px var(--now)'
                    : undefined,
                }}
              >
                {d.getDate()}
              </span>
              <span className="flex h-[6px] items-center gap-[3px]" aria-hidden="true">
                {items.slice(0, 3).map((i) => (
                  <span
                    key={i.id}
                    className="h-[6px] w-[6px] rounded-full"
                    style={{ background: categoryHue(categoriesOf(state), i.category) }}
                  />
                ))}
                {items.length > 3 && (
                  <span className="mono text-[9px]" style={{ color: 'var(--muted-foreground)' }}>
                    +{items.length - 3}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {picked && (
        <div className="reveal-in mt-5">
          <div className="flex items-center justify-between">
            <span className="text-row font-semibold tracking-[-0.008em]">
              {parseDay(picked).toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </span>
            <div className="-mr-2 flex items-center">
              {onAdd && (
                <TextButton
                  onClick={() => onAdd(picked)}
                  tone="accent"
                  label={`Add an item on ${parseDay(picked).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`}
                >
                  Add
                </TextButton>
              )}
              <button
                type="button"
                onClick={() => setPicked(null)}
                aria-label="Close day"
                className="grid h-11 w-11 place-items-center"
                style={{ color: 'var(--muted-foreground)' }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>

          {pickedStarts.length > 0 && (
            <>
              <LaneHeading count={pickedStarts.length}>Starting</LaneHeading>
              <ul className="flex flex-col gap-1.5">
                {pickedStarts.map((i) => (
                  <ItemCard key={i.id} item={i} onOpen={onOpen} />
                ))}
              </ul>
            </>
          )}

          {pickedDues.length > 0 && (
            <>
              <LaneHeading count={pickedDues.length}>Due</LaneHeading>
              <ul className="flex flex-col gap-1.5">
                {pickedDues.map((i) => (
                  <ItemCard key={i.id} item={i} onOpen={onOpen} weight="quiet" />
                ))}
              </ul>
            </>
          )}

          {pickedStarts.length === 0 && pickedDues.length === 0 && (
            <Empty>Nothing on this day.</Empty>
          )}
        </div>
      )}
    </div>
  );
}
