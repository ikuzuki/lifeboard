import { useId, useState } from 'react';
import { CategorySelect, Segmented, TextButton } from './controls';
import { Confirm } from './Confirm';
import { fieldStyle } from './field';
import { Screen } from './Screen';
import { newGoal, newItem, useStore, type Action } from '../store';
import { goalSteps } from '../lib/dates';
import type { Category, Goal, Recurrence } from '../types';

type RepeatId = 'once' | 'daily' | 'weekly';

const REPEATS: { id: RepeatId; label: string; value: Recurrence | null }[] = [
  { id: 'once', label: 'One-off', value: null },
  { id: 'daily', label: 'Daily', value: { every: 1, unit: 'day' } },
  { id: 'weekly', label: 'Weekly', value: { every: 1, unit: 'week' } },
];

/**
 * Steps are ordinary items carrying a `goalId`, so a goal can hold a repeating
 * commitment as easily as a one-off, and its activity comes from the same place
 * everything else in the app gets its activity.
 */
const CONSEQUENCE: Record<'complete' | 'drop', (open: number, titles: string[]) => string> = {
  complete: (open, titles) =>
    open === 0
      ? 'Marks the goal done. It has no open steps.'
      : `Marks the goal done and closes ${open === 1 ? 'its one open step' : `its ${open} open steps`}: ${titles.join(', ')}.`,
  drop: (open, titles) =>
    open === 0
      ? 'Sets the goal aside as abandoned. It has no open steps.'
      : `Sets the goal aside as abandoned and closes ${open === 1 ? 'its one open step' : `its ${open} open steps`}: ${titles.join(', ')}.`,
};

export function GoalEdit({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const ids = useId();

  const [title, setTitle] = useState(goal?.title ?? '');
  const [category, setCategory] = useState<Category | null>(goal?.category ?? null);
  const [horizon, setHorizon] = useState(goal?.horizon ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  const [step, setStep] = useState('');
  const [repeat, setRepeat] = useState<RepeatId>('once');
  const [confirming, setConfirming] = useState<'complete' | 'drop' | null>(null);

  // The caller hands over a snapshot, so read park state back out of the store.
  const current = goal ? (state.goals.find((g) => g.id === goal.id) ?? goal) : null;
  const steps = goal ? goalSteps(goal, state.items) : [];

  /**
   * An existing goal commits per field, the way `ItemDetail` does: two edit screens reached
   * the same way used to disagree about it, and closing this one silently threw the edit
   * away. A goal that does not exist yet still needs Save, because there is nothing to
   * patch until it does.
   */
  const editing = current !== null;
  const patch = (change: Partial<Goal>) => {
    if (current) dispatch({ type: 'patchGoal', goalId: current.id, patch: change });
  };

  const create = () => {
    const t = title.trim();
    if (!t) return;
    dispatch({
      type: 'addGoal',
      goal: newGoal({ title: t, category, horizon: horizon.trim(), description: description.trim() }),
    });
    onClose();
  };

  const open = steps.filter((s) => s.status !== 'done');
  const openSteps = open.length;

  const close = (action: Action) => {
    dispatch(action);
    onClose();
  };

  const addStep = () => {
    const t = step.trim();
    if (!t || !goal) return;
    dispatch({
      type: 'add',
      item: newItem({
        title: t,
        category,
        goalId: goal.id,
        order: steps.length,
        recurrence: REPEATS.find((r) => r.id === repeat)?.value ?? null,
      }),
    });
    setStep('');
    setRepeat('once');
  };

  return (
    <Screen
      title={goal ? 'Edit goal' : 'New goal'}
      onClose={onClose}
      action={editing ? undefined : { label: 'Save', onClick: create, disabled: !title.trim() }}
    >
      <div className="flex flex-col gap-4">
          <div>
            <label
              htmlFor={`${ids}-title`}
              className="mb-1.5 block text-micro font-medium"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Goal
            </label>
            <input
              id={`${ids}-title`}
              value={editing ? (current?.title ?? '') : title}
              onChange={(e) => (editing ? patch({ title: e.target.value }) : setTitle(e.target.value))}
              placeholder="What are you actually after?"
              className="min-h-12 w-full rounded-lg border px-3 text-row"
              style={fieldStyle}
            />
          </div>

          <div>
            <label
              htmlFor={`${ids}-horizon`}
              className="mb-1.5 block text-micro font-medium"
              style={{ color: 'var(--muted-foreground)' }}
            >
              By when
            </label>
            <input
              id={`${ids}-horizon`}
              value={editing ? (current?.horizon ?? '') : horizon}
              onChange={(e) => (editing ? patch({ horizon: e.target.value }) : setHorizon(e.target.value))}
              placeholder="next summer"
              className="min-h-11 w-full rounded-lg border px-3 text-body"
              style={fieldStyle}
            />
          </div>

          <div>
            <span
              className="mb-1.5 block text-micro font-medium"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Category
            </span>
            <CategorySelect
              value={editing ? (current?.category ?? null) : category}
              onChange={(c) => (editing ? patch({ category: c }) : setCategory(c))}
            />
          </div>

          <div>
            <label
              htmlFor={`${ids}-desc`}
              className="mb-1.5 block text-micro font-medium"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Detail
            </label>
            <textarea
              id={`${ids}-desc`}
              value={editing ? (current?.description ?? '') : description}
              onChange={(e) => (editing ? patch({ description: e.target.value }) : setDescription(e.target.value))}
              rows={2}
              className="w-full resize-y rounded-lg border px-3 py-2 text-body"
              style={fieldStyle}
            />
          </div>
        </div>

        {goal && (
          <div className="mt-6 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <span className="text-micro font-medium" style={{ color: 'var(--muted-foreground)' }}>
              Steps
            </span>

            {steps.length > 0 && (
              <ul className="mt-2 flex flex-col">
                {steps.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 border-b py-1 last:border-b-0"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <span className="min-w-0 flex-1 truncate text-body">{s.title}</span>
                    {s.recurrence && (
                      <span className="text-micro" style={{ color: 'var(--muted-foreground)' }}>
                        repeats
                      </span>
                    )}
                    <TextButton
                      onClick={() => dispatch({ type: 'drop', id: s.id })}
                      tone="danger"
                      label={`Drop ${s.title}`}
                    >
                      Drop
                    </TextButton>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3">
              <Segmented
                label="How often the step repeats"
                options={REPEATS.map((r) => ({ id: r.id, label: r.label }))}
                value={repeat}
                onChange={setRepeat}
              />
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={step}
                onChange={(e) => setStep(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addStep()}
                aria-label="New step"
                placeholder="Add a step"
                className="min-h-11 min-w-0 flex-1 rounded-lg border px-3 text-body"
                style={fieldStyle}
              />
              <button
                type="button"
                onClick={addStep}
                disabled={!step.trim()}
                className="min-h-11 rounded-lg px-4 text-body font-medium disabled:opacity-40"
                style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
              >
                Add
              </button>
            </div>
          </div>
        )}


        {goal && (
          <>
            {/* Three tiers, because these actions sit on three axes and used to render as
                four peers in a grid. Status is the state of a live goal, closing it is a
                pair of genuine alternatives, and deleting the record now lives on the
                closed-goal card in Goals, next to Revive, so a live goal cannot be deleted
                at all. That is the rule items already follow. */}
            <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <Segmented
                label="Status"
                options={[
                  { id: 'live', label: 'Live' },
                  { id: 'parked', label: 'Parked' },
                ]}
                value={current?.parked ? 'parked' : 'live'}
                onChange={(next) => {
                  const parked = next === 'parked';
                  if (parked !== Boolean(current?.parked)) {
                    dispatch({ type: 'parkGoal', goalId: goal.id });
                  }
                }}
              />
            </div>

            <p className="mt-4 text-micro font-medium" style={{ color: 'var(--muted-foreground)' }}>
              Close this goal
            </p>
            <div className="-mx-2 flex items-center justify-between">
              <TextButton onClick={() => setConfirming('complete')} tone="accent">
                Complete
              </TextButton>
              <TextButton onClick={() => setConfirming('drop')} tone="danger">
                Drop
              </TextButton>
            </div>
            {/* Always visible, rather than appearing only once a button is armed. The
                consequence is needed before the first tap, not after it. */}
            <p className="text-micro" style={{ color: 'var(--muted-foreground)' }}>
              {openSteps === 0
                ? 'No open steps.'
                : `Either closes ${openSteps === 1 ? 'its one open step' : `its ${openSteps} open steps`}.`}
            </p>

            {confirming && (
              <Confirm
                title={confirming === 'complete' ? `Complete ${goal.title}?` : `Drop ${goal.title}?`}
                detail={CONSEQUENCE[confirming](openSteps, open.map((sp) => sp.title))}
                confirmLabel={confirming === 'complete' ? 'Complete' : 'Drop'}
                tone={confirming === 'complete' ? 'accent' : 'danger'}
                onConfirm={() =>
                  close(
                    confirming === 'complete'
                      ? { type: 'completeGoal', goalId: goal.id }
                      : { type: 'dropGoal', goalId: goal.id },
                  )
                }
                onCancel={() => setConfirming(null)}
              />
            )}
          </>
        )}
    </Screen>
  );
}
