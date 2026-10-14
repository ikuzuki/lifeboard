import { useEffect, useMemo, useRef, useState } from 'react';
import { CategorySelect, Chevron, PrimaryButton, TextButton } from './controls';
import { fieldStyle } from './field';
import { newItem, useStore } from '../store';
import { parseCapture, type Draft } from '../lib/capture';
import { categoriesOf } from '../lib/categories';
import { SPEECH_BLOCKED_MESSAGE, listen, speechState } from '../lib/speech';
import { formatShort } from '../lib/dates';
import type { Item } from '../types';

type Phase = 'dump' | 'parsing' | 'review';

/**
 * One free-text box that takes a whole brain dump, however it gets filled. Speech and
 * the keyboard feed the same text and the same parse, so there is one code path, it
 * works where recognition does not, and a pasted block of notes is a first-class input.
 *
 * Nothing here commits. Parsing produces drafts, the user works through them one at a
 * time, and only accepted drafts reach the store.
 */
/**
 * A restart that follows hard on the last one is a failure repeating, not a pause. Five
 * inside two seconds means give up rather than spin.
 */
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 2000;

export function BrainDump({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [phase, setPhase] = useState<Phase>('dump');
  const [text, setText] = useState('');
  // Mirrors `text` so a restart can fold what has been heard so far into the next session.
  const textRef = useRef('');
  textRef.current = text;
  /** What the user asked for, as opposed to whether the engine happens to be running. */
  const wantMic = useRef(false);
  const restarts = useRef(0);
  const lastRestart = useRef(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [cursor, setCursor] = useState(0);
  const [accepted, setAccepted] = useState<Item[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const stopRef = useRef<(() => void) | null>(null);
  const beforeSpeech = useRef('');
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const speech = useMemo(speechState, []);

  // Accepted drafts land in one reduction, on the way out. Closing mid-review keeps
  // what was already accepted rather than discarding the work.
  const finish = (items: Item[]) => {
    if (items.length > 0) dispatch({ type: 'addMany', items });
    onClose();
  };

  useEffect(() => {
    boxRef.current?.focus();
    return () => {
      wantMic.current = false;
      stopRef.current?.();
    };
  }, []);

  // Only these mean dictation genuinely cannot continue. Everything else, including a
  // silent pause, is treated as the engine stopping early rather than as the user
  // finishing.
  const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'unsupported']);

  const beginSession = () => {
    // Append, so dictating after typing adds to the dump instead of replacing it. Read from
    // the ref, because a restart happens inside a callback where `text` would be stale.
    beforeSpeech.current = textRef.current ? `${textRef.current.trimEnd()} ` : '';
    stopRef.current = listen(
      (spoken) => setText(beforeSpeech.current + spoken),
      (error) => {
        // Chrome on Android ends the session at the first real pause even with `continuous`
        // set, so without this the microphone switches itself off while the user is still
        // thinking and the button quietly flips back to Dictate. Press to start and press to
        // stop only holds if a pause does not count as stopping.
        const fatal = error !== undefined && FATAL.has(error);
        if (wantMic.current && !fatal) {
          const now = Date.now();
          restarts.current = now - lastRestart.current < RESTART_WINDOW_MS ? restarts.current + 1 : 0;
          lastRestart.current = now;
          // A failure that repeats instantly would otherwise spin here forever.
          if (restarts.current < MAX_RESTARTS) {
            beginSession();
            return;
          }
        }
        wantMic.current = false;
        setRecording(false);
        setNotice(
          fatal
            ? 'Dictation stopped. Carry on typing, or try again.'
            : 'Dictation keeps dropping out. Carry on typing, or try again.',
        );
      },
    );
  };

  const toggleMic = () => {
    if (wantMic.current) {
      wantMic.current = false;
      stopRef.current?.();
      setRecording(false);
      return;
    }
    wantMic.current = true;
    restarts.current = 0;
    setRecording(true);
    beginSession();
  };

  const sort = async () => {
    wantMic.current = false;
    stopRef.current?.();
    setRecording(false);
    setPhase('parsing');
    setNotice(null);
    const outcome = await parseCapture(text, state.items, {
      categories: categoriesOf(state).map((c) => c.id),
    });
    if (outcome.drafts.length === 0) {
      setPhase('dump');
      setNotice('Nothing to add yet.');
      return;
    }
    if (outcome.kind === 'fallback') setNotice(outcome.reason);
    setDrafts(outcome.drafts);
    setCursor(0);
    setPhase('review');
  };

  const patch = (change: Partial<Draft>) =>
    setDrafts((all) => all.map((d, n) => (n === cursor ? { ...d, ...change } : d)));

  const toItem = (d: Draft): Item =>
    newItem({
      title: d.title.trim(),
      category: d.category,
      description: d.description.trim(),
      act: d.act,
      due: d.due,
      order: -1,
      buy: d.buy,
      cost: d.buy ? d.cost : null,
    });

  /**
   * Decided drafts leave the list rather than being stepped past, so what remains is always
   * what is still undecided and the two arrows can move freely through it. Discarding the last
   * one returns to the dump box with the transcript intact instead of closing: in the
   * fallback there is a single draft and it *is* the transcript, and `Discard` is the obvious tap
   * for "not like that, let me try again".
   */
  const settle = (index: number, next: Item[]) => {
    const rest = drafts.filter((_, n) => n !== index);
    setAccepted(next);
    if (rest.length > 0) {
      setDrafts(rest);
      setCursor(Math.min(index, rest.length - 1));
      return;
    }
    if (next.length > 0) finish(next);
    else {
      setDrafts([]);
      setPhase('dump');
      setNotice('Nothing kept. The text is still here, edit it and sort again.');
    }
  };

  const acceptOne = () => {
    const draft = drafts[cursor];
    if (!draft.title.trim()) return;
    settle(cursor, [...accepted, toItem(draft)]);
  };

  const step = (by: number) =>
    setCursor((c) => Math.min(Math.max(c + by, 0), drafts.length - 1));

  const acceptAll = () => finish([...accepted, ...drafts.filter((d) => d.title.trim()).map(toItem)]);

  const draft = drafts[cursor];

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={() => finish(accepted)}
        className="absolute inset-0"
        style={{ background: 'rgb(0 0 0 / 0.35)' }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Brain dump"
        className="sheet-in relative max-h-[92vh] overflow-y-auto rounded-t-2xl border-t px-4 pt-3 pb-7"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        onKeyDown={(e) => e.key === 'Escape' && finish(accepted)}
      >
        <div className="mx-auto mb-4 h-1 w-9 rounded-full" style={{ background: 'var(--border)' }} />

        {phase === 'review' && draft ? (
          <ReviewStack
            draft={draft}
            position={cursor + 1}
            total={drafts.length}
            upcoming={drafts.slice(cursor + 1)}
            notice={notice}
            onPatch={patch}
            onAccept={acceptOne}
            onDiscard={() => settle(cursor, accepted)}
            onStep={step}
            onAcceptAll={acceptAll}
          />
        ) : (
          <>
            <p className="text-meta" style={{ color: 'var(--muted-foreground)' }}>
              Say or write everything on your mind. One thing or ten.
            </p>

            <textarea
              ref={boxRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Brain dump"
              placeholder="Ring the dentist next Tuesday, MOT due by the end of the month, buy a desk lamp for about 40 quid, start running today..."
              rows={8}
              disabled={phase === 'parsing'}
              className="mt-2 w-full resize-y rounded-lg border px-3 py-2 text-body"
              style={fieldStyle}
            />

            <div className="mt-2 flex items-center gap-2">
              {speech !== 'unsupported' && (
                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={speech === 'insecure-context' || phase === 'parsing'}
                  aria-label={recording ? 'Stop dictating' : 'Dictate'}
                  aria-pressed={recording}
                  className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-meta font-medium disabled:opacity-40"
                  style={{
                    borderColor: recording ? 'var(--now)' : 'var(--border)',
                    background: recording ? 'var(--muted)' : 'var(--background)',
                    color: recording ? 'var(--now)' : 'var(--muted-foreground)',
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </svg>
                  {recording ? 'Stop' : 'Dictate'}
                </button>
              )}
              {text.trim() !== '' && (
                <TextButton onClick={() => setText('')}>Clear</TextButton>
              )}
            </div>

            {/* Shown, not only announced. "Is it hearing me" is the only question there is in
                the seconds before the first words land, and the one visible answer used to be
                the button relabelling itself. `aria-live` on the same line replaces the
                sr-only duplicate. */}
            <p className="mt-2 flex items-center gap-2 text-meta" aria-live="polite">
              {recording && (
                <>
                  <span
                    className="listening-dot h-2 w-2 rounded-full"
                    style={{ background: 'var(--now)' }}
                    aria-hidden="true"
                  />
                  <span style={{ color: 'var(--now)' }}>Listening</span>
                </>
              )}
            </p>

            {speech === 'insecure-context' && (
              <p className="mt-2 text-meta" style={{ color: 'var(--muted-foreground)' }}>
                {SPEECH_BLOCKED_MESSAGE}
              </p>
            )}
            {notice && (
              <p className="mt-2 text-meta" style={{ color: 'var(--muted-foreground)' }}>
                {notice}
              </p>
            )}

            <div className="mt-5">
              <PrimaryButton onClick={() => void sort()} disabled={!text.trim() || phase === 'parsing'}>
                {phase === 'parsing' ? 'Sorting...' : 'Sort into items'}
              </PrimaryButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One draft at a time, fully editable, with accept and bin per card. Empty fields are
 * labelled rather than left looking broken: the model is told not to invent dates, so
 * a blank date is the restraint working, not a gap in the output.
 */
function ReviewStack({
  draft,
  position,
  total,
  upcoming,
  notice,
  onPatch,
  onAccept,
  onDiscard,
  onAcceptAll,
  onStep,
}: {
  draft: Draft;
  position: number;
  total: number;
  upcoming: Draft[];
  notice: string | null;
  onPatch: (change: Partial<Draft>) => void;
  onAccept: () => void;
  onDiscard: () => void;
  onAcceptAll: () => void;
  onStep: (by: number) => void;
}) {
  // Swipe between drafts, so a set of proposals can be looked over before any of them is
  // decided. Vertical movement wins, or the sheet could not be scrolled.
  const touch = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      onTouchStart={(e) => {
        touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchEnd={(e) => {
        const from = touch.current;
        touch.current = null;
        if (!from) return;
        const dx = e.changedTouches[0].clientX - from.x;
        const dy = e.changedTouches[0].clientY - from.y;
        if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx)) return;
        onStep(dx < 0 ? 1 : -1);
      }}
    >
      {/* One count, not two. `Draft 1 of 3` and `3 left` said the same thing twice. */}
      <div className="flex items-center justify-between gap-1">
        <h2 className="flex-1 text-row font-semibold" style={{ color: 'var(--foreground)' }}>
          Draft {position} of {total}
        </h2>
        {total > 1 && (
          <>
            <button
              type="button"
              onClick={() => onStep(-1)}
              disabled={position === 1}
              aria-label="Previous draft"
              className="grid h-11 w-8 flex-none place-items-center disabled:opacity-30"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <Chevron dir="left" />
            </button>
            <button
              type="button"
              onClick={() => onStep(1)}
              disabled={position === total}
              aria-label="Next draft"
              className="grid h-11 w-8 flex-none place-items-center disabled:opacity-30"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <Chevron dir="right" />
            </button>
          </>
        )}
      </div>
      {notice && (
        <p className="mt-1 text-meta" style={{ color: 'var(--muted-foreground)' }}>
          {notice} Edit this into shape, or bin it.
        </p>
      )}

      {/* A textarea, not an input: the fallback draft's title is the entire transcript, and
          a single line showed under half of it with no way to read the rest back. */}
      <textarea
        value={draft.title}
        onChange={(e) => onPatch({ title: e.target.value })}
        aria-label="Title"
        placeholder="What needs doing?"
        rows={2}
        className="mt-3 w-full resize-y rounded-lg border px-3 py-2.5 text-row"
        style={fieldStyle}
      />

      <div className="mt-4">
        <CategorySelect value={draft.category} onChange={(category) => onPatch({ category })} />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <DateField
          label="Start by"
          value={draft.act}
          onChange={(act) => onPatch({ act })}
        />
        <DateField label="Deadline" value={draft.due} onChange={(due) => onPatch({ due })} />
      </div>

      <label
        className="mt-4 flex min-h-11 cursor-pointer items-center gap-2.5 text-body"
        style={{ color: 'var(--foreground)' }}
      >
        <input
          type="checkbox"
          checked={draft.buy}
          onChange={(e) => onPatch({ buy: e.target.checked })}
          className="h-[18px] w-[18px] flex-none accent-[var(--accent)]"
        />
        Something to buy
      </label>

      {draft.buy && (
        <input
          type="number"
          inputMode="decimal"
          aria-label="Cost in pounds, optional"
          placeholder="Cost, if you know it"
          value={draft.cost === null ? '' : String(draft.cost)}
          onChange={(e) => onPatch({ cost: e.target.value === '' ? null : Number(e.target.value) })}
          className="min-h-11 w-full rounded-lg border px-3 text-body"
          style={fieldStyle}
        />
      )}

      <textarea
        value={draft.description}
        onChange={(e) => onPatch({ description: e.target.value })}
        aria-label="Detail"
        placeholder="Anything worth remembering"
        rows={2}
        className="mt-2 w-full resize-y rounded-lg border px-3 py-2 text-body"
        style={fieldStyle}
      />

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onDiscard}
          className="min-h-12 flex-none rounded-lg border px-4 text-row font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
        >
          Discard
        </button>
        <div className="min-w-0 flex-1">
          <PrimaryButton onClick={onAccept} disabled={!draft.title.trim()}>
            {total > 1 ? 'Accept and next' : 'Accept'}
          </PrimaryButton>
        </div>
      </div>

      {total > 1 && (
        <div className="mt-3 -ml-2">
          <TextButton onClick={onAcceptAll} tone="accent">
            Accept all {total}
          </TextButton>
        </div>
      )}

      {upcoming.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {upcoming.map((d, n) => (
            <li
              key={`${d.title}-${n}`}
              className="truncate text-meta"
              style={{ color: 'var(--muted-foreground)' }}
            >
              {d.title}
              {d.act && <span className="mono"> · {formatShort(d.act)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A date the model either inferred or deliberately left to the user. */
function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (day: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className="mono min-h-11 rounded-lg border px-3 text-meta"
        style={{
          ...fieldStyle,
          borderColor: value ? 'var(--accent)' : 'var(--border)',
          color: value ? 'var(--foreground)' : 'var(--muted-foreground)',
        }}
      />
      <span className="text-meta" style={{ color: 'var(--muted-foreground)' }}>
        {label}
        {value ? '' : ' · you decide'}
      </span>
    </div>
  );
}
