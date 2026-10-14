import { useEffect, useRef } from 'react';
import { useCloseOnBack } from '../lib/back';

const Cross = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/**
 * A full screen surface rather than a sheet. A sheet clips the native Android date
 * picker and leaves no obvious way out; a screen has room and a visible exit.
 */
export function Screen({
  title,
  onClose,
  action,
  children,
}: {
  title: string;
  onClose: () => void;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  children: React.ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  useCloseOnBack(true, onClose);

  useEffect(() => {
    // Mount only. `onClose` is a fresh arrow on every parent render, so depending on it moved
    // focus back to this container on each keystroke and the keyboard closed with it.
    surface.current?.focus();
  }, []);

  return (
    <div
      ref={surface}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 mx-auto flex max-w-[460px] flex-col"
      style={{ background: 'var(--background)' }}
    >
      <header
        className="flex flex-none items-center justify-between gap-2 border-b px-2 py-1.5"
        style={{ borderColor: 'var(--border)' }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-11 w-11 place-items-center rounded-lg"
          style={{ color: 'var(--muted-foreground)' }}
        >
          <Cross />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-center text-row font-semibold">{title}</h2>
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className="min-h-11 rounded-lg px-3 text-row font-semibold disabled:opacity-40"
            style={{ color: 'var(--accent)' }}
          >
            {action.label}
          </button>
        ) : (
          <span className="h-11 w-11" />
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-10">{children}</div>
    </div>
  );
}

/**
 * For the surfaces that stay a sheet. A visible cross in the top right and a downward
 * drag both dismiss it, so neither the discoverable nor the fast route is missing.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const from = useRef<number | null>(null);
  useCloseOnBack(true, onClose);


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
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={scroller}
        onTouchStart={(e) => {
          // Only from the top of the scroll, so a drag inside a scrolled list still scrolls.
          from.current = scroller.current?.scrollTop === 0 ? e.touches[0].clientY : null;
        }}
        onTouchMove={(e) => {
          if (from.current !== null && e.touches[0].clientY - from.current > 80) {
            from.current = null;
            onClose();
          }
        }}
        className="sheet-in relative max-h-[85vh] overflow-y-auto rounded-t-2xl border-t px-4 pt-2 pb-8"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <div className="relative mb-1 flex h-11 items-center justify-center">
          <div className="h-1 w-9 rounded-full" style={{ background: 'var(--border)' }} />
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
            className="absolute top-0 -right-2 grid h-11 w-11 place-items-center"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <Cross />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
