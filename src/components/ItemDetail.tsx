import { useEffect, useId, useRef, useState } from 'react';
import { CategorySelect, Segmented, TextButton } from './controls';
import { fieldStyle } from './field';
import { Screen } from './Screen';
import { StatusButton } from './StatusButton';
import { useStore } from '../store';
import { addDays, formatInstant, relative, today } from '../lib/dates';
import { itemSummary } from '../lib/summary';
import type { Item, Recurrence } from '../types';

type RepeatId = 'never' | 'daily' | 'weekly' | 'monthly';
type EndId = 'forever' | 'times' | 'until';

const REPEATS: { id: RepeatId; label: string; value: Recurrence | null }[] = [
  { id: 'never', label: 'Never', value: null },
  { id: 'daily', label: 'Daily', value: { every: 1, unit: 'day' } },
  { id: 'weekly', label: 'Weekly', value: { every: 1, unit: 'week' } },
  { id: 'monthly', label: 'Monthly', value: { every: 1, unit: 'month' } },
];

const ENDS: { id: EndId; label: string }[] = [
  { id: 'forever', label: 'No end' },
  { id: 'times', label: 'A number of times' },
  { id: 'until', label: 'Until a date' },
];

const repeatId = (r: Recurrence | null): RepeatId => {
  const hit = REPEATS.find(
    (o) => o.value && r && o.value.every === r.every && o.value.unit === r.unit,
  );
  return hit?.id ?? (r ? 'daily' : 'never');
};

const endId = (r: Recurrence): EndId =>
  r.times != null ? 'times' : r.until ? 'until' : 'forever';

const Field = ({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) => (
  <div className="py-2.5">
    <span className="mb-1.5 block text-micro font-medium" style={{ color: 'var(--muted-foreground)' }}>
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
    </span>
    <div className="text-body">{children}</div>
  </div>
);

/** A recurrence with no end condition is a chore you cannot finish, only delete. */
function RepeatEnd({
  item,
  patch,
}: {
  item: Item;
  patch: (p: Partial<Item>) => void;
}) {
  const r = item.recurrence;
  if (!r) return null;
  const { every, unit } = r;

  const setEnd = (id: EndId) => {
    if (id === 'times') patch({ recurrence: { every, unit, times: 5, until: null } });
    else if (id === 'until')
      patch({
        recurrence: { every, unit, times: null, until: addDays(item.act ?? today(), 30) },
      });
    else patch({ recurrence: { every, unit, times: null, until: null } });
  };

  return (
    <Field label="Repeat ends">
      <Segmented label="Repeat ends" options={ENDS} value={endId(r)} onChange={setEnd} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {r.times != null && (
          <input
            type="number"
            min={1}
            inputMode="numeric"
            aria-label="Times left to repeat"
            value={r.times}
            onChange={(e) =>
              patch({ recurrence: { ...r, times: Math.max(1, Number(e.target.value) || 1) } })
            }
            className="mono min-h-11 w-24 rounded-lg border px-3 text-meta"
            style={fieldStyle}
          />
        )}
        {r.until != null && (
          <input
            type="date"
            aria-label="Repeat until"
            value={r.until}
            onChange={(e) => patch({ recurrence: { ...r, until: e.target.value || null } })}
            className="mono min-h-11 rounded-lg border px-3 text-meta"
            style={fieldStyle}
          />
        )}
        {/* Ends the repeat and nothing else. It used to complete and archive the item as
            well, with no confirmation and only the aria-label admitting it. To finish a
            commitment for good, stop it repeating and then tick it: two obvious steps
            instead of one button doing a thing it did not say. */}
        <TextButton
          onClick={() => patch({ recurrence: null })}
          label={`Stop ${item.title} repeating`}
        >
          Stop repeating
        </TextButton>
      </div>
    </Field>
  );
}

export function ItemDetail({ item, onClose }: { item: Item; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [note, setNote] = useState('');
  const [title, setTitle] = useState(item.title);
  const [desc, setDesc] = useState(item.description);
  const [deadline, setDeadline] = useState(item.due !== null);
  const ids = useId();
  const titleBox = useRef<HTMLTextAreaElement>(null);

  const patch = (p: Partial<Item>) => dispatch({ type: 'patch', id: item.id, patch: p });
  const live = item.status === 'todo' || item.status === 'doing';
  const { lead, leadColour, facts } = itemSummary(item);

  /** A blank title reverts: a nameless card is worse than the one you were fixing. */
  const rename = () => {
    const next = title.trim();
    if (!next) return setTitle(item.title);
    setTitle(next);
    if (next !== item.title) patch({ title: next });
  };

  // Titles wrap, so the box grows with them rather than scrolling inside two lines.
  useEffect(() => {
    const box = titleBox.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight}px`;
  }, [title]);

  const addNote = () => {
    const text = note.trim();
    if (!text) return;
    dispatch({ type: 'note', id: item.id, text });
    setNote('');
  };

  return (
    <Screen title={item.title} onClose={onClose}>
      <div className="flex items-start gap-3">
        <StatusButton
          status={item.status}
          label={item.title}
          size={22}
          onToggle={() =>
            dispatch(live ? { type: 'complete', id: item.id } : { type: 'restoreItem', id: item.id })
          }
        />
        {/* Editable in place. Fixing a title typed in a hurry, or dictated and misheard,
            otherwise meant recreating the item and losing its log, slips and streak. */}
        <textarea
          ref={titleBox}
          aria-label="Name"
          value={title}
          rows={1}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            // One line of meaning, whatever it wraps to: Enter commits rather than breaks.
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="min-w-0 flex-1 resize-none overflow-hidden rounded-lg border px-2.5 py-1 text-lead font-semibold tracking-[-0.014em]"
          style={fieldStyle}
        />
        {live && (
          <button
            type="button"
            onClick={() =>
              dispatch({ type: item.status === 'doing' ? 'stop' : 'start', id: item.id })
            }
            aria-pressed={item.status === 'doing'}
            className="min-h-11 flex-none rounded-lg border px-3 text-meta font-medium"
            style={{
              borderColor: item.status === 'doing' ? 'var(--doing)' : 'var(--border)',
              color: item.status === 'doing' ? 'var(--doing)' : 'var(--muted-foreground)',
            }}
          >
            {item.status === 'doing' ? 'Stop' : 'Start'}
          </button>
        )}
      </div>

      {/* The same summary the card carries. Opening a card used to drop it, so you lost the
          one-line answer to "when and why" exactly when you went looking for the detail. */}
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-micro">
        <span className="mono font-semibold" style={{ color: leadColour }}>
          {lead}
        </span>
        {facts.slice(0, 3).map((f) => (
          <span key={f.key} style={{ color: f.colour ?? 'var(--muted-foreground)' }}>
            {f.text}
          </span>
        ))}
      </p>

      <div className="mt-4 border-t" style={{ borderColor: 'var(--border)' }}>
        <Field label="When to pick this up" htmlFor={`${ids}-act`}>
          <span className="flex flex-wrap items-center gap-2">
            <input
              id={`${ids}-act`}
              type="date"
              value={item.act ?? ''}
              onChange={(e) => patch({ act: e.target.value || null })}
              className="mono min-h-11 rounded-lg border px-3 text-meta"
              style={fieldStyle}
            />
            {item.act && (
              <span className="mono text-micro" style={{ color: 'var(--muted-foreground)' }}>
                {relative(item.act)}
              </span>
            )}
            <TextButton
              onClick={() => dispatch({ type: 'snooze', id: item.id, days: 1 })}
              label={`Push ${item.title} back a day`}
            >
              Push a day
            </TextButton>
          </span>
        </Field>

        {deadline ? (
          <Field label="Deadline" htmlFor={`${ids}-due`}>
            <span className="flex flex-wrap items-center gap-2">
              <input
                id={`${ids}-due`}
                type="date"
                value={item.due ?? ''}
                onChange={(e) => patch({ due: e.target.value || null })}
                className="mono min-h-11 rounded-lg border px-3 text-meta"
                style={fieldStyle}
              />
              <TextButton
                onClick={() => {
                  patch({ due: null });
                  setDeadline(false);
                }}
                label={`Remove the deadline on ${item.title}`}
              >
                Remove
              </TextButton>
            </span>
          </Field>
        ) : (
          <div className="-ml-3 py-1.5">
            <TextButton onClick={() => setDeadline(true)} tone="accent">
              Add a deadline
            </TextButton>
          </div>
        )}

        <Field label="Repeats">
          <Segmented
            label="Repeats"
            options={REPEATS.map((r) => ({ id: r.id, label: r.label }))}
            value={repeatId(item.recurrence)}
            onChange={(id) => patch({ recurrence: REPEATS.find((r) => r.id === id)?.value ?? null })}
          />
        </Field>

        <RepeatEnd item={item} patch={patch} />

        <div className="py-2.5">
          <CategorySelect value={item.category} onChange={(c) => patch({ category: c })} />
        </div>

        {state.goals.length > 0 && (
          <Field label="Towards" htmlFor={`${ids}-goal`}>
            <select
              id={`${ids}-goal`}
              value={item.goalId ?? ''}
              onChange={(e) => patch({ goalId: e.target.value || null })}
              className="min-h-11 w-full rounded-lg border px-3 text-body"
              style={fieldStyle}
            >
              <option value="">None</option>
              {state.goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Reachable">
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={item.weekdaysOnly}
              onChange={(e) => patch({ weekdaysOnly: e.target.checked })}
              className="h-[18px] w-[18px] flex-none accent-[var(--accent)]"
            />
            Weekdays only
          </label>
        </Field>

        <Field label="Purchase">
          <span className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={item.buy}
                onChange={(e) => patch({ buy: e.target.checked })}
                className="h-[18px] w-[18px] flex-none accent-[var(--accent)]"
              />
              On the buy list
            </label>
            {item.buy && (
              <input
                type="number"
                inputMode="decimal"
                aria-label="Cost in pounds, optional"
                placeholder="Cost, optional"
                value={item.cost ?? ''}
                onChange={(e) => patch({ cost: e.target.value === '' ? null : Number(e.target.value) })}
                className="min-h-11 w-40 rounded-lg border px-3 text-body"
                style={fieldStyle}
              />
            )}
          </span>
        </Field>

        {item.streak > 0 && <Field label="Completed">{item.streak} times</Field>}

        <Field label="Detail" htmlFor={`${ids}-desc`}>
          <textarea
            id={`${ids}-desc`}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => patch({ description: desc })}
            rows={3}
            className="w-full resize-y rounded-lg border px-3 py-2 text-body"
            style={fieldStyle}
          />
        </Field>
      </div>

      <div className="mt-3 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        <span className="text-micro font-medium" style={{ color: 'var(--muted-foreground)' }}>
          Log {item.notes.length > 0 && `· ${item.notes.length}`}
        </span>

        {item.notes.length > 0 && (
          <ol className="mt-2 flex flex-col gap-2">
            {item.notes.map((n) => (
              <li
                key={n.at}
                className="rounded-lg px-3 py-2 text-body"
                style={{ background: 'var(--muted)' }}
              >
                <span className="mono block text-micro" style={{ color: 'var(--muted-foreground)' }}>
                  {formatInstant(n.at)}
                </span>
                {n.text}
              </li>
            ))}
          </ol>
        )}

        <div className="mt-2 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addNote()}
            aria-label="Add a log entry"
            placeholder="What you found out"
            className="min-h-11 min-w-0 flex-1 rounded-lg border px-3 text-body"
            style={fieldStyle}
          />
          <button
            type="button"
            onClick={addNote}
            className="min-h-11 rounded-lg px-4 text-body font-medium"
            style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            Add
          </button>
        </div>
      </div>

      <div className="mt-6 -ml-3">
        <TextButton
          onClick={() => {
            dispatch({ type: 'drop', id: item.id });
            onClose();
          }}
          tone="danger"
        >
          Drop
        </TextButton>
      </div>
    </Screen>
  );
}
