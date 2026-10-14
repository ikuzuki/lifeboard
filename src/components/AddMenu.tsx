import { useEffect, useRef } from 'react';
import { useCloseOnBack } from '../lib/back';

export interface AddChoice {
  key: string;
  label: string;
  icon: string;
  onPick: () => void;
}

const Icon = ({ path }: { path: string }) => (
  <svg
    viewBox="0 0 24 24"
    width={20}
    height={20}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={path} />
  </svg>
);

/**
 * The add button, expanded into labelled choices. A single button had to guess from the
 * current tab what the user meant, and the brain dump was reachable only by opening the
 * new-item form and noticing a link inside it.
 */
export function AddMenu({
  open,
  choices,
  onOpen,
  onClose,
  label,
}: {
  open: boolean;
  choices: AddChoice[];
  onOpen: () => void;
  onClose: () => void;
  label: string;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useCloseOnBack(open, onClose);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
  }, [open]);

  // One choice needs no menu: the button just does the thing.
  const single = choices.length === 1;

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close the add menu"
          onClick={onClose}
          // Above the tab bar, which also sits at z-30 and painted later, so the scrim
          // stopped short of the one edge the thumb rests on: the nav kept full contrast
          // and stayed tappable, and tapping a tab through it switched tab.
          className="fixed inset-0 z-40 cursor-default"
          style={{ background: 'color-mix(in oklch, var(--background) 72%, transparent)' }}
        />
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-[86px] z-50 mx-auto flex max-w-[460px] flex-col items-end gap-2 px-4">
        {open &&
          choices.map((c, n) => (
            <button
              key={c.key}
              ref={n === 0 ? first : undefined}
              type="button"
              onClick={() => {
                onClose();
                c.onPick();
              }}
              className="toast-in pointer-events-auto flex min-h-12 items-center gap-2.5 rounded-full border pr-3 pl-4 text-row font-medium"
              style={{
                background: 'var(--card)',
                borderColor: 'var(--border)',
                boxShadow: '0 2px 12px rgb(0 0 0 / 0.14)',
              }}
            >
              <span>{c.label}</span>
              <span
                className="grid h-9 w-9 flex-none place-items-center rounded-full"
                style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
              >
                <Icon path={c.icon} />
              </span>
            </button>
          ))}

        <button
          type="button"
          onClick={() => {
            if (open) onClose();
            else if (single) choices[0].onPick();
            else onOpen();
          }}
          aria-label={open ? 'Close the add menu' : single ? choices[0].label : label}
          aria-expanded={single ? undefined : open}
          className="pointer-events-auto grid h-14 w-14 place-items-center rounded-full"
          style={{
            background: 'var(--accent)',
            color: 'var(--accent-foreground)',
            boxShadow: '0 2px 12px rgb(0 0 0 / 0.18)',
            transform: open ? 'rotate(45deg)' : undefined,
            transition: 'transform 0.18s ease-out',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width={24}
            height={24}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    </>
  );
}
