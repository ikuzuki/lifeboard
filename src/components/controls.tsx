import { useId } from 'react';
import { fieldStyle } from './field';
import { UNCATEGORISED_LABEL, categoriesOf, categoryHue } from '../lib/categories';
import { useStore } from '../store';
import type { Category } from '../types';

/**
 * One connected control for an exclusive choice, so it does not read as a row of
 * unrelated pills. Pills are reserved for filters, which are additive and dismissable.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex overflow-hidden rounded-lg border"
      style={{ borderColor: 'var(--border)' }}
    >
      {options.map((o, n) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className="min-h-11 flex-1 border-l text-meta font-medium first:border-l-0"
            style={{
              borderLeftColor: 'var(--border)',
              background: on ? 'var(--accent)' : 'transparent',
              color: on ? 'var(--accent-foreground)' : 'var(--muted-foreground)',
              borderLeftWidth: n === 0 ? 0 : 1,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One select, not a row of chips: ten user-named categories is more than a wrapping set of
 * pills can hold without taking over the sheet. The dot keeps the colour visible, which is
 * how a category reads everywhere else.
 *
 * There were two of these until they were merged. One carried the colour dot and an
 * invisible label, the other a visible label and no dot, and they disagreed about whether
 * uncategorised came back as an empty string or as null. Every caller holds
 * `Category | null`, so null is the one answer and the dot and the label both stay.
 */
export function CategorySelect({
  value,
  onChange,
}: {
  value: Category | null;
  onChange: (c: Category | null) => void;
}) {
  const { state } = useStore();
  const list = categoriesOf(state);
  const id = useId();

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-micro font-medium"
        style={{ color: 'var(--muted-foreground)' }}
      >
        Category
      </label>
      <div className="flex items-center gap-2.5">
        <span
          className="h-3 w-3 flex-none rounded-full"
          style={{ background: categoryHue(list, value) }}
          aria-hidden="true"
        />
        <select
          id={id}
          value={value ?? ''}
          onChange={(e) => onChange((e.target.value || null) as Category | null)}
          className="min-h-11 w-full rounded-lg border px-3 text-body"
          style={fieldStyle}
        >
          <option value="">{UNCATEGORISED_LABEL}</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Dropping something, which is the bin everywhere it appears. A bin is the recoverable
 * action in every app that has one: mail, photos and files all bin to somewhere you can
 * fish it back out of, and permanent removal is a separate, rarer, worded action. So the
 * bin means "off my list, into the archive", and erasing the record for good stays the word
 * `Delete`, offered only from the archive, a closed goal, or a category.
 */
export const Bin = () => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </svg>
);

/** Used by anything that steps through a list one entry at a time. */
export const Chevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
  </svg>
);

/** Tertiary and destructive actions. Deliberately not shaped like anything else. */
export function TextButton({
  children,
  onClick,
  tone = 'muted',
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'muted' | 'accent' | 'danger';
  label?: string;
}) {
  const colour =
    tone === 'danger' ? 'var(--now)' : tone === 'accent' ? 'var(--accent)' : 'var(--muted-foreground)';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="min-h-11 min-w-11 px-3 text-meta font-medium underline-offset-4 hover:underline"
      style={{ color: colour }}
    >
      {children}
    </button>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-12 w-full rounded-lg text-row font-semibold disabled:opacity-40"
      style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
    >
      {children}
    </button>
  );
}
