import { useEffect, useRef, useState } from 'react';
import { TextButton } from './controls';
import { fieldStyle } from './field';
import { MAX_CATEGORIES, PALETTE, categoriesOf, swatchHue } from '../lib/categories';
import { useStore } from '../store';
import { useCloseOnBack } from '../lib/back';
import { Confirm } from './Confirm';
import type { CategoryDef } from '../types';

function Row({ category }: { category: CategoryDef }) {
  const { state, dispatch } = useStore();
  const list = categoriesOf(state);
  const [label, setLabel] = useState(category.label);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const used = state.items.filter((i) => i.category === category.id).length;

  const rename = (next: string) => {
    setLabel(next);
    const trimmed = next.trim();
    if (trimmed) dispatch({ type: 'patchCategory', id: category.id, patch: { label: trimmed } });
  };

  return (
    <li className="list-none border-b py-2 last:border-b-0" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={`Colour for ${category.label}`}
          className="grid h-11 w-11 flex-none place-items-center"
        >
          <span
            className="h-5 w-5 rounded-full"
            style={{ background: swatchHue(category.colour) }}
          />
        </button>
        <input
          value={label}
          onChange={(e) => rename(e.target.value)}
          onBlur={() => setLabel(category.label)}
          aria-label={`Name of ${category.label}`}
          className="min-h-11 min-w-0 flex-1 rounded-lg border px-3 text-body"
          style={fieldStyle}
        />
        <TextButton
          onClick={() => setConfirming(true)}
          tone="danger"
          label={`Delete ${category.label}`}
        >
          Delete
        </TextButton>
      </div>

      {confirming && (
        <Confirm
          title={`Delete ${category.label}?`}
          detail={
            used === 0
              ? 'Nothing uses it.'
              : `${used} ${used === 1 ? 'item becomes' : 'items become'} uncategorised.`
          }
          confirmLabel="Delete"
          onConfirm={() => dispatch({ type: 'removeCategory', id: category.id })}
          onCancel={() => setConfirming(false)}
        />
      )}

      {open && (
        <>
        <div className="reveal-in mt-1.5 flex flex-wrap gap-1.5">
          {PALETTE.map((s) => {
            const on = s.id === category.colour;
            const holder = list.find((c) => c.colour === s.id && c.id !== category.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                aria-label={holder ? `${s.label}, swaps with ${holder.label}` : s.label}
                onClick={() => {
                  dispatch({ type: 'patchCategory', id: category.id, patch: { colour: s.id } });
                  setOpen(false);
                }}
                className="grid h-11 w-11 place-items-center rounded-lg border"
                style={{ borderColor: on ? 'var(--foreground)' : 'var(--border)' }}
              >
                {/* No dimming. A taken colour used to render at 0.45, which reads as
                    unavailable, when tapping it in fact swaps the two categories. It is
                    marked with the holder's initial instead, which says "in use, by that
                    one" rather than "you cannot have this". */}
                <span
                  className="grid h-5 w-5 place-items-center rounded-full text-[9px] font-semibold"
                  style={{ background: swatchHue(s.id), color: 'var(--accent-foreground)' }}
                >
                  {holder && !on ? holder.label.slice(0, 1).toUpperCase() : ''}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-micro" style={{ color: 'var(--muted-foreground)' }}>
          Picking a colour another category uses swaps them.
        </p>
        </>
      )}
    </li>
  );
}

/** Ten categories and ten colours. Colour is the only encoding, so a slot is the choice. */
export function CategoriesEdit({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const list = categoriesOf(state);
  const sheet = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState('');
  // Registered like every other overlay, so Escape and the back gesture close this sheet and
  // leave Settings underneath it standing.
  useCloseOnBack(true, onClose);

  useEffect(() => {
    sheet.current?.focus();
  }, []);

  const full = list.length >= MAX_CATEGORIES;

  const add = () => {
    const label = adding.trim();
    if (!label || full) return;
    dispatch({ type: 'addCategory', label });
    setAdding('');
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: 'rgb(0 0 0 / 0.35)' }}
      />

      <div
        ref={sheet}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Categories"
        className="sheet-in relative max-h-[88vh] overflow-y-auto rounded-t-2xl border-t px-4 pt-3 pb-8"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <div className="mx-auto mb-4 h-1 w-9 rounded-full" style={{ background: 'var(--border)' }} />

        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lead font-semibold tracking-[-0.014em]">Categories</h2>
          <span className="mono text-micro" style={{ color: 'var(--muted-foreground)' }}>
            {list.length} of {MAX_CATEGORIES}
          </span>
        </div>

        <ul className="mt-3 flex flex-col">
          {list.map((c) => (
            <Row key={c.id} category={c} />
          ))}
        </ul>

        <div className="mt-4 flex gap-2">
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            disabled={full}
            aria-label="New category"
            placeholder={full ? 'Ten is the limit' : 'Add a category'}
            className="min-h-11 min-w-0 flex-1 rounded-lg border px-3 text-body disabled:opacity-50"
            style={fieldStyle}
          />
          <button
            type="button"
            onClick={add}
            disabled={full || !adding.trim()}
            className="min-h-11 rounded-lg px-4 text-body font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            Add
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 min-h-12 w-full rounded-lg border text-row font-semibold"
          style={{ borderColor: 'var(--border)' }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
