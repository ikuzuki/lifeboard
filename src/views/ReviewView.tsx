import { useEffect, useRef, useState } from 'react';
import { Chevron, TextButton } from '../components/controls';
import { Confirm } from '../components/Confirm';
import { categoriesOf, categoryLabel } from '../lib/categories';
import { addDays, relative, today } from '../lib/dates';
import { reviewBatch, reviewDue } from './review';
import { useStore } from '../store';
import type { Item } from '../types';

const WHEN = [
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'Next week', days: 7 },
];

const Tick = () => (
  <span
    className="tick-in grid h-8 w-8 flex-none place-items-center rounded-full"
    style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
    aria-hidden="true"
  >
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  </span>
);

/**
 * The pass over overdue work: one item at a time with the decisions the lane already
 * offers, but navigable, so the order is the user's rather than the app's. It renders
 * nothing unless something is overdue, and it finishes visibly rather than fading out.
 */
export function ReviewView({
  onOpen,
  onComplete,
  onShowing,
}: {
  onOpen: (id: string) => void;
  onComplete: (id: string) => void;
  /** Reported so Today can hide the lane this pass is a guided walk through. */
  onShowing: (showing: boolean) => void;
}) {
  const { state, dispatch } = useStore();
  const [active, setActive] = useState(false);
  /** Which one is on screen. Actioning removes it from the batch, so the same index then
   *  lands on the next one, which is why this is not decremented on action. */
  const [cursor, setCursor] = useState(0);
  // Declared with the other hooks, above the early returns. Swiping moves along the batch so
  // the order is the user's; vertical movement wins so the page still scrolls from the card.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [dropping, setDropping] = useState(false);

  const batch = reviewBatch(state.items);
  const due = reviewDue({ deferredOn: state.reviewDeferredOn }, batch.length);

  useEffect(() => {
    if (due && !active) {
      setActive(true);
      setCursor(0);
    }
  }, [due, active]);

  useEffect(() => {
    onShowing(active);
  }, [active, onShowing]);

  // Clearing the batch is what completes the review, not closing the card, so a reload
  // mid-pass cannot make it fire again a moment later.
  useEffect(() => {
    if (active && batch.length === 0 && state.reviewDeferredOn !== null) {
      dispatch({ type: 'deferReview', day: null });
    }
  }, [active, batch.length, state.reviewDeferredOn, dispatch]);

  if (!active) return null;

  const shell = 'rounded-[14px] border px-4 py-3.5';
  const shellStyle = { background: 'var(--card)', borderColor: 'var(--border)' };

  if (batch.length === 0) {
    return (
      <section
        className={`reveal-in mb-3 flex items-center gap-3 ${shell}`}
        style={shellStyle}
        role="status"
      >
        <Tick />
        <span className="flex-1 text-lead font-semibold tracking-[-0.014em]">Review clear</span>
        <div className="-mr-3">
          <TextButton onClick={() => setActive(false)} tone="accent" label="Close the review">
            Close
          </TextButton>
        </div>
      </section>
    );
  }

  // Clamped rather than reset: the batch shrinks as items are dealt with, and the last one
  // being actioned should leave the cursor on the new last, not throw you back to the top.
  const at = Math.min(cursor, batch.length - 1);
  const item: Item = batch[at];
  const size = batch.length;

  const step = (by: number) => setCursor(Math.min(Math.max(at + by, 0), batch.length - 1));

  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const from = touch.current;
    touch.current = null;
    if (!from) return;
    const dx = e.changedTouches[0].clientX - from.x;
    const dy = e.changedTouches[0].clientY - from.y;
    if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx)) return;
    step(dx < 0 ? 1 : -1);
  };

  // An item that never had a date is being scheduled, not pushed back, so it does not
  // earn a slip. A slipped one does.
  const schedule = (days: number) =>
    item.act === null
      ? dispatch({ type: 'patch', id: item.id, patch: { act: addDays(today(), days) } })
      : dispatch({ type: 'snooze', id: item.id, days });

  return (
    <section
      className={`mb-3 ${shell}`}
      style={shellStyle}
      aria-label="What you missed"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="-mr-2 flex items-center justify-between gap-1">
        <span className="flex-1 text-meta font-semibold">What you missed</span>
        {size > 1 && (
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={at === 0}
            aria-label="Previous missed item"
            className="grid h-11 w-8 flex-none place-items-center disabled:opacity-30"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <Chevron dir="left" />
          </button>
        )}
        <span className="mono text-micro" style={{ color: 'var(--muted-foreground)' }}>
          {at + 1} of {size}
        </span>
        {size > 1 && (
          <button
            type="button"
            onClick={() => step(1)}
            disabled={at === size - 1}
            aria-label="Next missed item"
            className="grid h-11 w-8 flex-none place-items-center disabled:opacity-30"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <Chevron dir="right" />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'deferReview', day: today() });
            setActive(false);
          }}
          aria-label="Leave the review until tomorrow"
          className="grid h-11 w-11 flex-none place-items-center"
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

      <button
        type="button"
        onClick={() => onOpen(item.id)}
        className="block w-full text-left"
        aria-label={`${item.title}, ${relative(item.act)}. Open details`}
      >
        <span className="block text-lead font-semibold tracking-[-0.014em]">{item.title}</span>
        <span className="mt-1 flex items-baseline gap-2">
          <span
            className="mono text-meta font-semibold"
            style={{ color: item.act ? 'var(--now)' : 'var(--muted-foreground)' }}
          >
            {relative(item.act)}
          </span>
          <span className="text-micro" style={{ color: 'var(--muted-foreground)' }}>
            <span aria-hidden="true">· </span>
            {categoryLabel(categoriesOf(state), item.category)}
          </span>
        </span>
      </button>

      <div
        className="mt-3 flex overflow-hidden rounded-lg border"
        style={{ borderColor: 'var(--border)' }}
        role="group"
        aria-label={`Move ${item.title}`}
      >
        {WHEN.map((o, n) => (
          <button
            key={o.label}
            type="button"
            onClick={() => schedule(o.days)}
            aria-label={`Move ${item.title} to ${o.label.toLowerCase()}`}
            className="min-h-11 flex-1 text-meta font-medium"
            style={{
              borderLeftWidth: n === 0 ? 0 : 1,
              borderLeftColor: 'var(--border)',
              color: 'var(--muted-foreground)',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="-mx-3 flex items-center justify-between">
        <TextButton
          onClick={() => onComplete(item.id)}
          tone="accent"
          label={`Complete ${item.title}`}
        >
          Done
        </TextButton>
        <TextButton
          onClick={() => setDropping(true)}
          tone="danger"
          label={`Drop ${item.title}, recoverable from the archive`}
        >
          Drop
        </TextButton>
      </div>

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
    </section>
  );
}
