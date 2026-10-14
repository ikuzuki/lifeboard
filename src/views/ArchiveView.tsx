import { useState } from 'react';
import { Empty, LaneHeading, Lanes } from '../components/Lane';
import { Confirm } from '../components/Confirm';
import { TextButton } from '../components/controls';
import { useStore } from '../store';
import { UNCATEGORISED_LABEL, categoriesOf, categoryHue } from '../lib/categories';
import { formatInstant, isArchived } from '../lib/dates';
import type { Category, Item } from '../types';

const monthKey = (item: Item) =>
  item.doneAt
    ? new Date(item.doneAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : 'Undated';

/**
 * Nothing leaves the app without passing through here first, so a mistaken drop is
 * always recoverable. Permanent deletion exists but is deliberately two taps. Titles
 * read normally: everything here is finished, so struck-through text says nothing.
 */
export function ArchiveView({ onOpen }: { onOpen: (id: string) => void }) {
  const { state, dispatch } = useStore();
  const [confirming, setConfirming] = useState<string | null>(null);
  const pending = confirming === null ? null : state.items.find((i) => i.id === confirming) ?? null;

  const [filter, setFilter] = useState<Category | null | 'all'>('all');

  const all = state.items
    .filter((i) => isArchived(i))
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  const archived =
    filter === 'all' ? all : all.filter((i) => (filter === null ? i.category === null : i.category === filter));

  if (!all.length) {
    return (
      <Empty>
        Nothing archived yet. Completed items move here the next day, dropped ones straight away.
      </Empty>
    );
  }

  const categories = categoriesOf(state);
  const goalOf = (item: Item): string | null =>
    item.goalId === null ? null : (state.goals.find((g) => g.id === item.goalId)?.title ?? null);
  const chip = (id: Category | null | 'all', label: string, count: number) => (
    <button
      key={String(id)}
      type="button"
      onClick={() => setFilter(id)}
      aria-pressed={filter === id}
      className="flex min-h-11 flex-none items-center gap-1.5 rounded-full border px-3 text-meta font-medium"
      style={{
        borderColor: filter === id ? 'var(--foreground)' : 'var(--border)',
        color: filter === id ? 'var(--foreground)' : 'var(--muted-foreground)',
      }}
    >
      {id !== 'all' && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: categoryHue(categories, id) }}
          aria-hidden="true"
        />
      )}
      {label}
      <span className="mono text-micro">{count}</span>
    </button>
  );

  const months = [...new Set(archived.map(monthKey))];

  return (
    <Lanes>
      {/* The archive is where done, dropped and bought all end up, so it is the one list that
          genuinely needs narrowing. Same chip row as Today, and the scrollbar is hidden for
          the same reason. */}
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
        {chip('all', 'All', all.length)}
        {categories
          .map((c) => [c, all.filter((i) => i.category === c.id).length] as const)
          .filter(([, n]) => n > 0)
          .map(([c, n]) => chip(c.id, c.label, n))}
        {all.some((i) => i.category === null) &&
          chip(null, UNCATEGORISED_LABEL, all.filter((i) => i.category === null).length)}
      </div>

      {archived.length === 0 && <Empty>Nothing archived in that category.</Empty>}

      {months.map((m) => (
        <section key={m}>
          <LaneHeading count={archived.filter((i) => monthKey(i) === m).length}>{m}</LaneHeading>
          <ul className="flex flex-col">
            {archived
              .filter((i) => monthKey(i) === m)
              .map((i) => (
                <li
                  key={i.id}
                  className="flex items-center gap-2 border-b py-1.5 last:border-b-0"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span
                    className="h-2.5 w-2.5 flex-none rounded-full"
                    style={{ background: categoryHue(categoriesOf(state), i.category) }}
                    aria-hidden="true"
                  />
                  <button type="button" onClick={() => onOpen(i.id)} className="min-w-0 flex-1 py-1.5 text-left">
                    <span className="block truncate text-body">{i.title}</span>
                    <span className="block text-micro" style={{ color: 'var(--muted-foreground)' }}>
                      {i.status === 'dropped' ? 'dropped' : 'done'}
                      {i.doneAt && (
                        <span className="mono"> · {formatInstant(i.doneAt)}</span>
                      )}
                      {/* Which goal a step belonged to. Closing a goal closes its steps, and
                          without this the only way to rebuild one was to recognise its step
                          titles among everything else in here. */}
                      {goalOf(i) && <span> · {goalOf(i)}</span>}
                    </span>
                  </button>

                  <TextButton
                    onClick={() => dispatch({ type: 'restoreItem', id: i.id })}
                    label={`Restore ${i.title}`}
                  >
                    Restore
                  </TextButton>

                  <TextButton
                    onClick={() => setConfirming(i.id)}
                    label={`Delete ${i.title} permanently`}
                  >
                    Delete
                  </TextButton>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {pending && (
        <Confirm
          title={`Delete ${pending.title}?`}
          detail="This removes it permanently."
          confirmLabel="Delete"
          onConfirm={() => {
            dispatch({ type: 'remove', id: pending.id });
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </Lanes>
  );
}
