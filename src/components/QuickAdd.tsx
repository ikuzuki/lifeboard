import { useEffect, useRef, useState } from 'react';
import { CategorySelect, PrimaryButton, Segmented, TextButton } from './controls';
import { fieldStyle } from './field';
import { Screen } from './Screen';
import { newItem, useStore } from '../store';
import { addDays, today } from '../lib/dates';
import type { Category, Day } from '../types';

type When = 'today' | 'tomorrow' | 'week' | 'none';

const WHEN: { id: When; label: string; days: number | null }[] = [
  { id: 'today', label: 'Today', days: 0 },
  { id: 'tomorrow', label: 'Tomorrow', days: 1 },
  { id: 'week', label: 'This week', days: 5 },
  { id: 'none', label: 'No date', days: null },
];

export function QuickAdd({
  onClose,
  defaultCategory = null,
  defaultBuy = false,
  defaultAct,
}: {
  onClose: () => void;
  defaultCategory?: Category | null;
  defaultBuy?: boolean;
  /** Seeded when the add came from tapping a specific calendar day. */
  defaultAct?: Day;
  /** Absent when parsing is not configured, which hides the route entirely. */
}) {
  const { dispatch } = useStore();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<Category | null>(defaultCategory);
  const [when, setWhen] = useState<When>('today');
  // An explicit date wins over the shortcut, so seeding this is all a calendar tap needs.
  const [exact, setExact] = useState<string>(defaultAct ?? '');
  const [due, setDue] = useState('');
  const [deadline, setDeadline] = useState(false);
  const [buy, setBuy] = useState(defaultBuy);
  const [cost, setCost] = useState('');
  const [detail, setDetail] = useState(false);
  const [description, setDescription] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    const days = WHEN.find((w) => w.id === when)?.days ?? null;
    // An explicit date always wins over the shortcut.
    const act = exact || (days === null ? null : addDays(today(), days));
    dispatch({
      type: 'add',
      item: newItem({
        title: t,
        category,
        act,
        due: due || null,
        order: -1,
        description: description.trim(),
        buy,
        cost: buy && cost !== '' ? Number(cost) : null,
      }),
    });
    onClose();
  };

  return (
    <Screen
      title="New item"
      onClose={onClose}
      action={{ label: 'Save', onClick: submit, disabled: !title.trim() }}
    >
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-label="What needs doing"
          placeholder="What needs doing?"
          className="min-h-12 min-w-0 flex-1 rounded-lg border px-3 text-row"
          style={fieldStyle}
        />
      </div>

      <div className="mt-5">
        <span className="mb-1.5 block text-micro font-medium" style={{ color: 'var(--muted-foreground)' }}>
          When to pick this up
        </span>
        <Segmented
          label="When to pick this up"
          options={WHEN.map((w) => ({ id: w.id, label: w.label }))}
          value={exact ? ('' as When) : when}
          onChange={(id) => {
            setWhen(id);
            setExact('');
          }}
        />
        <input
          type="date"
          aria-label="Or pick an exact day to start"
          value={exact}
          onChange={(e) => setExact(e.target.value)}
          className="mono mt-1 min-h-11 rounded-lg border px-3 text-meta"
          style={{
            ...fieldStyle,
            borderColor: exact ? 'var(--accent)' : 'var(--border)',
            color: exact ? 'var(--foreground)' : 'var(--muted-foreground)',
          }}
        />
      </div>

      {/* Most items have one date. A second empty field only implies an omission. */}
      {deadline ? (
        <div className="reveal-in mt-4">
          <label
            className="mb-1.5 block text-micro font-medium"
            style={{ color: 'var(--muted-foreground)' }}
            htmlFor="quickadd-due"
          >
            Deadline
          </label>
          <input
            id="quickadd-due"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="mono min-h-11 rounded-lg border px-3 text-meta"
            style={fieldStyle}
          />
        </div>
      ) : (
        <div className="-ml-3 mt-2">
          <TextButton onClick={() => setDeadline(true)} tone="accent">
            Add a deadline
          </TextButton>
        </div>
      )}

      <div className="mt-4">
        <CategorySelect value={category} onChange={setCategory} />
      </div>

      <label
        className="mt-4 flex min-h-11 cursor-pointer items-center gap-2.5 text-body"
        style={{ color: 'var(--foreground)' }}
      >
        <input
          type="checkbox"
          checked={buy}
          onChange={(e) => setBuy(e.target.checked)}
          className="h-[18px] w-[18px] flex-none accent-[var(--accent)]"
        />
        Something to buy
      </label>

      {detail ? (
        <div className="reveal-in mt-2 flex flex-col gap-2">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-label="Detail"
            placeholder="Anything worth remembering"
            rows={3}
            className="w-full resize-y rounded-lg border px-3 py-2 text-body"
            style={fieldStyle}
          />
          {buy && (
            <input
              type="number"
              inputMode="decimal"
              aria-label="Cost in pounds, optional"
              placeholder="Cost, if you know it"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="min-h-11 w-full rounded-lg border px-3 text-body"
              style={fieldStyle}
            />
          )}
        </div>
      ) : (
        <div className="-ml-3 mt-1">
          <TextButton onClick={() => setDetail(true)} tone="accent">
            Add detail
          </TextButton>
        </div>
      )}

      <div className="mt-6">
        <PrimaryButton onClick={submit} disabled={!title.trim()}>
          Save
        </PrimaryButton>
      </div>
    </Screen>
  );
}
