import type { Status } from '../types';

const LABEL: Record<Status, string> = {
  todo: 'not done, activate to complete',
  doing: 'started, activate to complete',
  done: 'done, activate to reopen',
  dropped: 'dropped, activate to restore',
};

/**
 * A checkbox, not a cycle: it completes, and completing it again reopens it. Starting
 * something is the card's own button, so a misplaced tap here costs one tap to undo.
 * The visible box sits inside a 44px hit area, so the target is honest at any size.
 */
export function StatusButton({
  status,
  onToggle,
  label,
  size = 19,
}: {
  status: Status;
  onToggle: () => void;
  label: string;
  size?: number;
}) {
  const done = status === 'done';
  const doing = status === 'doing';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={`${label}: ${LABEL[status]}`}
      className="-m-3 grid h-11 w-11 flex-none cursor-pointer place-items-center p-3"
    >
      <span
        className="grid place-items-center overflow-hidden rounded-[6px] border-[1.5px]"
        style={{
          width: size,
          height: size,
          ...(done
            ? { background: 'var(--accent)', borderColor: 'var(--accent)' }
            : doing
              ? { borderColor: 'var(--doing)', background: 'var(--doing-bg)' }
              : { borderColor: 'var(--muted-foreground)' }),
        }}
      >
        {done && (
          <svg
            className="tick-in"
            width={size * 0.62}
            height={size * 0.62}
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent-foreground)"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 12.5l5 5L20 6.5" />
          </svg>
        )}
        {doing && (
          // Half filled, so started reads as part-way rather than as a different tick.
          <span
            className="block self-stretch justify-self-start"
            style={{ width: size / 2, background: 'var(--doing)' }}
            aria-hidden="true"
          />
        )}
      </span>
    </button>
  );
}
