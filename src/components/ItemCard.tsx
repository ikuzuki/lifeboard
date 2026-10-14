import { useRef, useState } from 'react';
import { Confirm } from './Confirm';
import { Bin } from './controls';
import { StatusButton } from './StatusButton';
import { useStore } from '../store';
import { categoriesOf, categoryHue } from '../lib/categories';
import type { Item, Weight } from '../types';
import { itemSummary } from '../lib/summary';
import { buzz } from '../lib/feedback';

const THRESHOLD = 64;

/** The one right-hand slot per card. Which action it holds comes from the lane. */
export type Slot = 'start' | 'today';

// `bleed` pushes the title button out to the card's own padding, so the tap target is
// the whole card without the card growing to meet the 44px guidance.
const SHAPE: Record<Weight, { pad: string; bleed: string; radius: number; edge: number; gap: string }> = {
  lead: { pad: 'px-4 py-3.5', bleed: '-my-3.5 py-3.5', radius: 14, edge: 4, gap: 'mt-1.5' },
  normal: { pad: 'px-3.5 py-3', bleed: '-my-3 py-3', radius: 12, edge: 3, gap: 'mt-1' },
  quiet: { pad: 'px-3.5 py-2.5', bleed: '-my-2.5 py-2.5', radius: 10, edge: 3, gap: 'mt-0.5' },
};

const TITLE: Record<Weight, string> = {
  lead: 'text-lead font-semibold tracking-[-0.014em]',
  normal: 'text-row font-medium tracking-[-0.008em]',
  quiet: 'text-body',
};

const LEAD_TEXT: Record<Weight, string> = {
  lead: 'text-meta font-semibold',
  normal: 'text-micro font-semibold',
  quiet: 'text-micro',
};

/**
 * Weight is set by the lane the card sits in, never by the item. A card in the
 * pressing lane is physically bigger than one in Later; that difference is the whole
 * point, so the list stops reading as one flat column.
 */
export function ItemCard({
  item,
  onOpen,
  onComplete,
  onSnooze,
  onPullForward,
  slot,
  weight = 'normal',
}: {
  item: Item;
  onOpen: (id: string) => void;
  onComplete?: (id: string) => void;
  onSnooze?: (id: string) => void;
  onPullForward?: (id: string) => void;
  slot?: Slot;
  weight?: Weight;
}) {
  const { state, dispatch } = useStore();
  const done = item.status === 'done' || item.status === 'dropped';
  const started = item.status === 'doing';

  const [dropping, setDropping] = useState(false);
  const [dx, setDx] = useState(0);
  // The offset also lives in a ref, because `onTouchEnd` used to read it from state: a last
  // move and the release in one task meant React had not committed `setDx`, so the release
  // saw 0, fired nothing, and left the card translated with its reveal panel showing.
  const offset = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const locked = useRef(false);

  // The host owns the undo toast, so route through it wherever one exists.
  const complete = () =>
    onComplete ? onComplete(item.id) : dispatch({ type: 'complete', id: item.id });

  const toggle = () =>
    done ? dispatch({ type: 'restoreItem', id: item.id }) : complete();

  // Routed through the host where one exists, so a push gets the same undo as a completion.
  // It was the only status change with no way back, and it also bumps the slip count.
  const push = () =>
    onSnooze ? onSnooze(item.id) : dispatch({ type: 'snooze', id: item.id, days: 1 });

  const onTouchStart = (e: React.TouchEvent) => {
    if (done) return;
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    locked.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current) return;
    const mx = e.touches[0].clientX - start.current.x;
    const my = e.touches[0].clientY - start.current.y;
    if (!locked.current) {
      if (Math.abs(my) > Math.abs(mx)) {
        start.current = null;
        return;
      }
      if (Math.abs(mx) > 8) locked.current = true;
    }
    if (locked.current) {
      const next = Math.max(-110, Math.min(110, mx));
      offset.current = next;
      setDx(next);
    }
  };

  const settle = () => {
    offset.current = 0;
    setDx(0);
    start.current = null;
    locked.current = false;
  };

  const onTouchEnd = () => {
    const travelled = offset.current;
    if (travelled > THRESHOLD) {
      buzz();
      complete();
    } else if (travelled < -THRESHOLD) {
      buzz();
      push();
    }
    settle();
  };

  const { lead, leadColour, facts } = itemSummary(item);

  const shape = SHAPE[weight];
  // Interpolating the id only ever worked for the built-in seven, which index.css
  // aliases. A user-created id has no token, so read the colour off the list instead.
  const hue = categoryHue(categoriesOf(state), item.category);
  const flat = weight === 'quiet';
  const ring = started ? 'var(--doing)' : 'var(--border)';

  return (
    <li className="relative list-none overflow-hidden" style={{ borderRadius: shape.radius }}>
      {dx !== 0 && (
        <div
          className="absolute inset-0 flex items-center justify-between px-4 text-micro font-medium"
          style={{ background: dx > 0 ? 'var(--accent)' : 'var(--muted)' }}
          aria-hidden="true"
        >
          <span style={{ color: 'var(--accent-foreground)', opacity: dx > THRESHOLD ? 1 : 0.6 }}>
            {dx > 0 ? 'Done' : ''}
          </span>
          <span style={{ color: 'var(--muted-foreground)', opacity: dx < -THRESHOLD ? 1 : 0.6 }}>
            {dx < 0 ? '+1 day' : ''}
          </span>
        </div>
      )}

      {dropping && (
        <Confirm
          title={`Drop ${item.title}?`}
          detail="Goes to the archive, where you can restore it or delete it for good."
          confirmLabel="Drop"
          onConfirm={() => {
            setDropping(false);
            dispatch({ type: 'drop', id: item.id });
          }}
          onCancel={() => setDropping(false)}
        />
      )}

      <div
        onTouchCancel={settle}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={`relative flex items-center gap-3 border ${shape.pad} ${done ? 'opacity-50' : ''}`}
        style={{
          background: flat && !started ? 'transparent' : 'var(--card)',
          // A started card carries an amber edge, the same token as the half-filled box.
          // Set side by side rather than through the shorthand, which the category edge
          // shares and would otherwise be reset by on every rerender.
          borderTopColor: ring,
          borderRightColor: ring,
          borderBottomColor: ring,
          borderLeftWidth: shape.edge,
          borderLeftColor: flat ? `color-mix(in oklch, ${hue} 55%, var(--border))` : hue,
          borderRadius: shape.radius,
          touchAction: 'pan-y',
          transform: dx ? `translateX(${dx}px)` : undefined,
          transition: dx ? 'none' : 'transform 0.18s ease-out',
        }}
      >
        <StatusButton
          status={item.status}
          label={item.title}
          size={weight === 'lead' ? 22 : 19}
          onToggle={toggle}
        />

        <button
          type="button"
          onClick={() => onOpen(item.id)}
          className={`block min-w-0 flex-1 text-left ${shape.bleed}`}
          aria-label={`${item.title}, ${lead}. Open details`}
        >
          <span className={`block ${TITLE[weight]} ${done ? 'line-through' : ''}`}>{item.title}</span>

          <span className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 ${shape.gap}`}>
            <span className={`mono ${LEAD_TEXT[weight]}`} style={{ color: leadColour }}>
              {lead}
            </span>
            {facts.slice(0, flat ? 2 : 3).map((f, n) => (
              <span
                key={f.key}
                className="text-micro"
                style={{ color: f.colour ?? 'var(--muted-foreground)' }}
              >
                {n > 0 && <span aria-hidden="true">· </span>}
                {f.text}
              </span>
            ))}
          </span>
        </button>

        {!done && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setDropping(true);
            }}
            aria-label={`Drop ${item.title}`}
            className="-my-2 ml-1 grid min-h-11 w-8 flex-none place-items-center"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <Bin />
          </button>
        )}

        {slot && !done && (
          <SlotButton
            item={item}
            slot={slot}
            onStart={() => dispatch({ type: started ? 'stop' : 'start', id: item.id })}
            onPullForward={() =>
              onPullForward
                ? onPullForward(item.id)
                : dispatch({ type: 'pullForward', id: item.id })
            }
          />
        )}
      </div>
    </li>
  );
}

/** One button, one position, meaning from the lane: begin it, or pull it into today. */
function SlotButton({
  item,
  slot,
  onStart,
  onPullForward,
}: {
  item: Item;
  slot: Slot;
  onStart: () => void;
  onPullForward: () => void;
}) {
  const started = item.status === 'doing';
  const label =
    slot === 'start' ? (started ? 'Stop' : 'Start') : 'Today';
  const description =
    slot === 'start'
      ? started
        ? `Stop ${item.title}`
        : `Start ${item.title}`
      : `Move ${item.title} to today`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (slot === 'start') onStart();
        else onPullForward();
      }}
      aria-label={description}
      aria-pressed={slot === 'start' ? started : undefined}
      className="-my-2 ml-1 min-h-11 flex-none rounded-lg border px-3 text-meta font-medium"
      style={{
        borderColor: started ? 'var(--doing)' : 'var(--border)',
        color: started ? 'var(--doing)' : 'var(--muted-foreground)',
      }}
    >
      {label}
    </button>
  );
}
