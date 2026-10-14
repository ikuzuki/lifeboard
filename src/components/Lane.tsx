import type { Weight } from '../types';

/**
 * The gap between lanes is what makes each one read as a group, so the container owns it
 * and no heading carries a top margin. Margins on the heading could not do this job: every
 * lane wraps its heading in its own section, so a first-child rule matched every time.
 */
export function Lanes({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 flex flex-col gap-7">{children}</div>;
}

/** Lanes carry different weight, so their headings do too. No rule under a heading. */
export function LaneHeading({
  children,
  count,
  id,
  weight = 'normal',
}: {
  children: React.ReactNode;
  count?: number;
  id?: string;
  weight?: Weight;
}) {
  const size =
    weight === 'lead' ? 'text-meta font-semibold' : weight === 'normal' ? 'text-meta font-medium' : 'text-micro';
  return (
    <h2
      id={id}
      className={`mb-2 flex items-baseline justify-between gap-3 ${size}`}
      style={{ color: weight === 'lead' ? 'var(--foreground)' : 'var(--muted-foreground)' }}
    >
      <span className="tracking-[0.01em]">{children}</span>
      {count !== undefined && (
        <span className="mono text-micro" style={{ color: 'var(--muted-foreground)' }}>
          {count}
        </span>
      )}
    </h2>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-2 text-body" style={{ color: 'var(--muted-foreground)' }}>
      {children}
    </p>
  );
}
