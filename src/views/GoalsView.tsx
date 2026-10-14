import { useRef, useState } from 'react';
import { ItemCard } from '../components/ItemCard';
import { Empty, LaneHeading } from '../components/Lane';
import { TextButton } from '../components/controls';
import { Confirm } from '../components/Confirm';
import { useStore } from '../store';
import { categoriesOf, categoryHue } from '../lib/categories';
import { formatInstant, goalProgress, isLive } from '../lib/dates';
import { goalHistory, isGoalLive, reopen } from '../lib/goals';
import type { Goal } from '../types';

function activity(idle: number | null): string {
  if (idle === null) return 'nothing done yet';
  if (idle <= 0) return 'moved today';
  if (idle === 1) return 'moved yesterday';
  return `${idle}d since anything moved`;
}

function GoalCard({
  goal,
  onOpen,
  onComplete,
  onEdit,
}: {
  goal: Goal;
  onOpen: (id: string) => void;
  onComplete: (id: string) => void;
  onEdit: (goal: Goal) => void;
}) {
  const { state, dispatch } = useStore();
  const { steps, habits, done, total, idle } = goalProgress(goal, state.items);
  const closed = !isGoalLive(goal);
  const [armed, setArmed] = useState(false);

  // Closed steps still pointing at this goal. `goalProgress` only sees open ones, which is
  // why a revived goal looked empty.
  const recoverable = state.items.filter((i) => i.goalId === goal.id && !isLive(i));

  // Ticked steps stay put until Goals is left and reopened, matching Today. Dropping them
  // out of the list the instant they were ticked read as the card being deleted.
  const held = useRef(new Set<string>());
  const complete = (id: string) => {
    held.current.add(id);
    onComplete(id);
  };
  const live = steps.filter((s) => s.status !== 'done' || held.current.has(s.id));

  return (
    <li className="list-none" style={{ opacity: goal.parked || closed ? 0.6 : 1 }}>
      <div className="flex items-start gap-2.5">
        <span
          className="mt-2 h-2.5 w-2.5 flex-none rounded-full"
          style={{ background: categoryHue(categoriesOf(state), goal.category) }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3
            className={`text-lead font-semibold tracking-[-0.014em] ${goal.status === 'done' ? 'line-through' : ''}`}
          >
            {goal.title}
          </h3>
          <p
            className="mt-1 flex flex-wrap items-baseline gap-x-2 text-micro"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {goal.horizon && <span>{goal.horizon}</span>}
            {total > 0 && (
              <span className="mono">
                {goal.horizon && <span aria-hidden="true">· </span>}
                {done} of {total} steps
              </span>
            )}
            {/* Named, because a repeat is listed and never counted, and it is given more
                weight than the steps that are. Four rows under "0 of 3" read as arithmetic
                gone wrong rather than as a rule. */}
            {habits > 0 && (
              <span>
                {(goal.horizon || total > 0) && <span aria-hidden="true">· </span>}
                {habits === 1 ? '1 habit' : `${habits} habits`}
              </span>
            )}
            <span>
              {(goal.horizon || total > 0) && <span aria-hidden="true">· </span>}
              {closed
                ? `${goal.status === 'done' ? 'completed' : 'dropped'} ${formatInstant(goal.closedAt ?? '')}`
                : goal.parked
                  ? 'parked'
                  : activity(idle)}
            </span>
          </p>
        </div>
        <div className="-mr-2 -mt-2">
          {closed ? (
            <span className="flex items-center gap-1">
              <TextButton
                onClick={() => dispatch({ type: 'reviveGoal', goalId: goal.id })}
                label={`Revive ${goal.title}`}
              >
                Revive
              </TextButton>
              {/* Deletion lives here rather than in the editor, so a goal must be closed
                  before its record can go, which is the rule items already follow. Muted
                  until armed, then red: the same two-tap idiom as the archive, so a red
                  filled control always means the irreversible one. */}
              <TextButton
                onClick={() => setArmed(true)}
                label={`Delete ${goal.title} permanently`}
              >
                Delete
              </TextButton>
            </span>
          ) : (
            <TextButton onClick={() => onEdit(goal)} label={`Edit ${goal.title}`}>
              Edit
            </TextButton>
          )}
        </div>
      </div>

      {goal.description && (
        <p className="mt-2.5 text-body" style={{ color: 'var(--muted-foreground)' }}>
          {goal.description}
        </p>
      )}

      {!closed && live.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {live.map((s) => (
            <ItemCard
              key={s.id}
              item={s}
              onOpen={onOpen}
              onComplete={complete}
              slot="start"
              weight={s.recurrence ? 'normal' : 'quiet'}
            />
          ))}
        </ul>
      )}

      {/* A revived goal whose steps were closed with it used to read "No steps yet", which is
          a goal presented as brand new rather than one whose work is recoverable. Closing a
          goal deliberately does not reopen its steps, so the rule stands and the route back
          is named instead: without this the only way to rebuild the goal was to recognise
          its step titles among everything else in the archive. */}
      {armed && (
        <Confirm
          title={`Delete ${goal.title}?`}
          detail="Deletes the goal only. Its steps stay in your list as ordinary items."
          confirmLabel="Delete"
          onConfirm={() => dispatch({ type: 'removeGoal', goalId: goal.id })}
          onCancel={() => setArmed(false)}
        />
      )}

      {!closed && steps.length === 0 && recoverable.length > 0 && (
        <div className="mt-2">
          <p className="text-body" style={{ color: 'var(--muted-foreground)' }}>
            {recoverable.length === 1
              ? '1 step was closed with this goal.'
              : `${recoverable.length} steps were closed with this goal.`}
          </p>
          <div className="-mx-2">
            <TextButton
              onClick={() => dispatch({ type: 'restoreItems', items: recoverable.map(reopen) })}
              tone="accent"
              label={`Bring back the steps closed with ${goal.title}`}
            >
              Bring them back
            </TextButton>
          </div>
        </div>
      )}

      {!closed && steps.length === 0 && recoverable.length === 0 && (
        <p className="mt-2 text-body" style={{ color: 'var(--muted-foreground)' }}>
          No steps yet. Edit to add one.
        </p>
      )}
    </li>
  );
}

export function GoalsView({
  onOpen,
  onComplete,
  onEdit,
}: {
  onOpen: (id: string) => void;
  onComplete: (id: string) => void;
  onEdit: (goal: Goal) => void;
}) {
  const { state } = useStore();
  const [history, setHistory] = useState(false);
  // A goal closed while this screen is open holds its place until the screen is left and
  // come back to, which is the same settling the daily list does.
  const [settled] = useState(() => new Set(state.goals.filter((g) => !isGoalLive(g)).map((g) => g.id)));

  const closed = goalHistory(state.goals);
  const holding = closed.filter((g) => !settled.has(g.id));
  const past = closed.filter((g) => settled.has(g.id));
  const open = state.goals.filter(isGoalLive);
  const live = [...open.filter((g) => !g.parked), ...holding];
  const parked = open.filter((g) => g.parked);

  const card = (g: Goal) => (
    <GoalCard key={g.id} goal={g} onOpen={onOpen} onComplete={onComplete} onEdit={onEdit} />
  );

  return (
    <div>
      {state.goals.length === 0 && <Empty>No goals yet. The plus button starts one.</Empty>}

      {live.length > 0 && (
        <>
          <LaneHeading count={live.length} weight="lead">
            Live
          </LaneHeading>
          <ul className="flex flex-col gap-8">{live.map(card)}</ul>
        </>
      )}

      {parked.length > 0 && (
        <>
          <LaneHeading count={parked.length} weight="quiet">
            Parked
          </LaneHeading>
          <ul className="flex flex-col gap-8">{parked.map(card)}</ul>
        </>
      )}

      {past.length > 0 && (
        <>
          <LaneHeading count={past.length} weight="quiet">
            Finished
          </LaneHeading>
          {history ? (
            <ul className="flex flex-col gap-8">{past.map(card)}</ul>
          ) : (
            <div className="-mx-3">
              <TextButton onClick={() => setHistory(true)}>Show</TextButton>
            </div>
          )}
        </>
      )}

    </div>
  );
}
