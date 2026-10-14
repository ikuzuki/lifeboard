import { useEffect, useRef, useState } from 'react';
import { useCloseOnBack } from '../lib/back';
import { fieldStyle } from './field';

/**
 * The one way the app asks "are you sure". There were three: a two-tap label swap in the
 * archive, a second two-tap swap on category rows, and an inline panel in the goal editor.
 * The label swap is the worst of them, because the confirm string is longer than the word it
 * replaces, so the row reflows and moves the neighbouring control under the thumb.
 *
 * A dialogue instead: it cannot reflow anything, it puts the confirm somewhere the finger was
 * not already resting, and it has room to say what will happen.
 */
export function Confirm({
  title,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
  tone = 'danger',
  typeToConfirm,
}: {
  title: string;
  /** What the action will do, where that is not obvious from the title. */
  detail?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  tone?: 'danger' | 'accent';
  /**
   * A word the user must type before the action unlocks. For the few things that cannot be
   * undone at all, where a single tap is too small a gesture for the consequence.
   */
  typeToConfirm?: string;
}) {
  const confirm = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState('');
  const locked = typeToConfirm !== undefined && typed.trim().toLowerCase() !== typeToConfirm.toLowerCase();
  useCloseOnBack(true, onCancel);

  useEffect(() => {
    // Focus lands on the dialogue rather than the destructive button, so a stray Enter
    // carried over from the control behind cannot commit the thing being asked about.
    confirm.current?.parentElement?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center px-6">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 cursor-default"
        style={{ background: 'rgb(0 0 0 / 0.45)' }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="reveal-in relative w-full max-w-[340px] rounded-2xl border p-4"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <p className="text-lead font-semibold tracking-[-0.014em]">{title}</p>
        {detail && (
          <p className="mt-1.5 text-body" style={{ color: 'var(--muted-foreground)' }}>
            {detail}
          </p>
        )}

        {typeToConfirm !== undefined && (
          <label className="mt-3 block">
            <span className="text-micro" style={{ color: 'var(--muted-foreground)' }}>
              Type {typeToConfirm} to confirm
            </span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label={`Type ${typeToConfirm} to confirm`}
              className="mono mt-1 min-h-11 w-full rounded-lg border px-3 text-body"
              style={fieldStyle}
            />
          </label>
        )}

        <div className="mt-4 flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-lg px-4 text-row font-medium"
            style={{ color: 'var(--muted-foreground)' }}
          >
            Cancel
          </button>
          <button
            ref={confirm}
            type="button"
            onClick={onConfirm}
            disabled={locked}
            className="min-h-11 rounded-lg px-4 text-row font-semibold disabled:opacity-40"
            style={{ color: tone === 'danger' ? 'var(--now)' : 'var(--accent)' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
