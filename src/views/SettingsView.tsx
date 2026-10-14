import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { PrimaryButton, Segmented, TextButton } from '../components/controls';
import { CategoriesEdit } from '../components/CategoriesEdit';
import { Confirm } from '../components/Confirm';
import { Setup } from '../components/Setup';
import { fieldStyle } from '../components/field';
import { useStore } from '../store';
import { useAuth, isConfigured } from '../lib/auth';
import { useSync, type SyncStatus } from '../lib/sync';
import { clearState, exportState, parseImport } from '../lib/storage';
import { isMuted, setMuted } from '../lib/feedback';
import { readTheme, setTheme, type Theme } from '../lib/theme';
import { askForNotifications, notifyState, preview } from '../lib/notify';
import { isSubscribed, pushConfigured, subscribe, unsubscribe } from '../lib/push';
import { isDaily, isLive, pressure } from '../lib/dates';

/**
 * Self-contained on purpose: account, sync and the data escape hatches in one place,
 * with nothing here reaching into the daily surfaces.
 *
 * Four groups, one card each, rows divided inside. A row states its setting and shows
 * its control; a sentence of explanation is the exception, reserved for the sign-in and
 * the reset, and never the rhythm.
 */

const STATUS_LABEL: Record<SyncStatus, string> = {
  idle: 'Up to date',
  syncing: 'Syncing',
  offline: 'Offline, queued',
  conflict: 'Conflict, retrying',
};

const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

const secondary = 'min-h-11 rounded-lg border px-4 text-body font-medium disabled:opacity-40';
const destructive = 'min-h-11 rounded-lg px-4 text-body font-semibold';

const fieldLabel = 'mb-1.5 block text-micro font-medium';

const Chevron = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/** A quiet heading over one card. The rows inside carry the dividers, so the card is bare. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 px-1 text-micro font-medium" style={{ color: 'var(--muted-foreground)' }}>
        {title}
      </h2>
      <div
        className="rounded-lg border"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        {children}
      </div>
    </section>
  );
}

const rowStyle = 'border-b px-3.5 py-2.5 last:border-b-0';

function Row({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`${rowStyle} ${className}`} style={{ borderColor: 'var(--border)' }}>
      {children}
    </div>
  );
}

/** A whole row that acts. Trailing content says where it goes or what comes out. */
function RowButton({
  children,
  hint,
  trailing,
  tone = 'normal',
  ariaLabel,
  onClick,
}: {
  children: ReactNode;
  hint?: string;
  trailing?: ReactNode;
  tone?: 'normal' | 'danger';
  ariaLabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`${rowStyle} flex w-full min-h-11 items-center gap-3 text-left`}
      style={{ borderColor: 'var(--border)' }}
    >
      <span className="min-w-0 flex-1">
        <span
          className="block text-body"
          style={tone === 'danger' ? { color: 'var(--now)' } : undefined}
        >
          {children}
        </span>
        {hint && (
          <span className="block text-micro" style={{ color: 'var(--muted-foreground)' }}>
            {hint}
          </span>
        )}
      </span>
      <span className="flex-none" style={{ color: 'var(--muted-foreground)' }}>
        {trailing}
      </span>
    </button>
  );
}

function Toggle({
  children,
  on,
  onChange,
}: {
  children: ReactNode;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`${rowStyle} flex w-full min-h-11 items-center justify-between gap-3 text-left`}
      style={{ borderColor: 'var(--border)' }}
    >
      <span className="text-body">{children}</span>
      <span
        className="relative h-6 w-10 flex-none rounded-full transition-colors"
        style={{ background: on ? 'var(--accent)' : 'var(--border)' }}
        aria-hidden="true"
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full transition-all"
          style={{ background: 'var(--background)', left: on ? '18px' : '2px' }}
        />
      </span>
    </button>
  );
}

function formatSynced(at: string | null): string {
  if (!at) return 'never';
  const when = new Date(at);
  const mins = Math.round((Date.now() - when.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return when.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SettingsView() {
  const { state, dispatch } = useStore();
  const [notify, setNotify] = useState(notifyState);
  const [subscribed, setSubscribed] = useState(false);
  // Asked once on open: the toggle should show what this device actually holds, not what it
  // was last told, since a subscription can be revoked by the browser without the app knowing.
  useEffect(() => {
    let live = true;
    void isSubscribed().then((on) => {
      if (live) setSubscribed(on);
    });
    return () => {
      live = false;
    };
  }, []);
  // Real counts, so a preview reads like the notification you would actually get.
  const missed = state.items.filter((i) => isLive(i) && isDaily(i) && pressure(i) === 'slipped').length;
  const startingToday = state.items.filter((i) => isLive(i) && isDaily(i) && pressure(i) === 'now').length;
  const thisWeek = state.items.filter((i) => isLive(i) && isDaily(i) && pressure(i) === 'soon').length;
  const auth = useAuth();
  const sync = useSync();
  const fileId = useId();
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState<'reset' | 'import' | null>(null);
  const [categories, setCategories] = useState(false);
  const [guide, setGuide] = useState(false);
  const [muted, setMutedState] = useState(isMuted);
  const [theme, setThemeState] = useState(readTheme);
  const staged = useRef<string | null>(null);

  const download = () => {
    const blob = new Blob([exportState()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lifeboard-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage(`Exported ${state.items.length} items.`);
  };

  const stage = async (file: File | undefined) => {
    setConfirming(null);
    staged.current = null;
    if (!file) return;
    const text = await file.text();
    try {
      const incoming = parseImport(text);
      staged.current = text;
      setConfirming('import');
      setMessage(
        `${file.name} holds ${incoming.items.length} items and ${incoming.goals.length} goals.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That file could not be read.');
    }
  };

  const applyImport = () => {
    if (!staged.current) return;
    dispatch({ type: 'restore', state: parseImport(staged.current) });
    staged.current = null;
    setConfirming(null);
    setMessage('Imported. Your previous data has been replaced.');
  };

  return (
    <div className="flex flex-col gap-5">
      <Group title="Your list">
        <RowButton
          onClick={() => setCategories(true)}
          ariaLabel="Edit categories"
          trailing={<Chevron />}
        >
          Categories
        </RowButton>
        <RowButton
          onClick={() => setGuide(true)}
          ariaLabel="Read the guide again"
          trailing={<Chevron />}
        >
          Guide
        </RowButton>
      </Group>

      <Group title="Display and sound">
        <Row>
          <span className={fieldLabel} style={{ color: 'var(--muted-foreground)' }}>
            Theme
          </span>
          <Segmented
            label="Theme"
            options={THEMES}
            value={theme}
            onChange={(next) => {
              setTheme(next);
              setThemeState(next);
            }}
          />
        </Row>
        <Toggle
          on={!muted}
          onChange={(next) => {
            setMuted(!next);
            setMutedState(!next);
          }}
        >
          Completion sound
        </Toggle>
      </Group>

      <Group title="Notifications">
        {notify === 'unsupported' || notify === 'insecure-context' ? (
          <Row>
            <span className="text-body" style={{ color: 'var(--muted-foreground)' }}>
              {notify === 'insecure-context'
                ? 'Notifications need a secure connection.'
                : 'This browser cannot show notifications.'}
            </span>
          </Row>
        ) : notify !== 'granted' ? (
          <RowButton
            onClick={() => {
              void askForNotifications().then((next) => {
                setNotify(next);
                setMessage(next === 'granted' ? 'Allowed.' : 'Not allowed.');
              });
            }}
            hint={
              notify === 'denied'
                ? 'Refused. Turn it back on in the browser site settings.'
                : 'Two a day at most, and only when something is overdue or due.'
            }
          >
            Allow notifications
          </RowButton>
        ) : (
          <>
            {pushConfigured() && (
              <Toggle
                on={subscribed}
                onChange={(next) => {
                  setSubscribed(next);
                  if (next) {
                    void subscribe().then((r) => {
                      setSubscribed(r === 'subscribed');
                      setMessage(
                        r === 'subscribed'
                          ? 'On. A morning and an evening summary, when there is something to say.'
                          : 'Could not turn them on.',
                      );
                    });
                  } else {
                    void unsubscribe().then(() => setMessage('Off on this device.'));
                  }
                }}
              >
                Daily summaries
              </Toggle>
            )}
            <RowButton
              onClick={() => {
                void preview({ missed, today: startingToday, thisWeek }, missed + startingToday).then(
                  (r) => setMessage(r === 'shown' ? 'Sent. Check your notification shade.' : 'Could not show it.'),
                );
              }}
              hint="Draws both summaries on this device now, using your real counts."
            >
              Preview a notification
            </RowButton>
          </>
        )}
      </Group>

      <Group title="Sync">
        {!isConfigured() ? (
          <Row>
            <p className="text-body" style={{ color: 'var(--muted-foreground)' }}>
              Not configured in this build. Everything works, it just stays on this device.
            </p>
          </Row>
        ) : (
          <>
            {auth.status === 'signed-in' ? (
              <Row className="flex min-h-11 items-center justify-between gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-body">Signed in</span>
                  <span
                    className="block truncate text-micro"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    {auth.user?.email ?? auth.user?.name ?? 'Google account'}
                  </span>
                </span>
                <TextButton onClick={auth.signOut}>Sign out</TextButton>
              </Row>
            ) : (
              <Row className="flex flex-col gap-2.5">
                <p className="text-body" style={{ color: 'var(--muted-foreground)' }}>
                  Signing in syncs this list across your devices. The app works fully
                  without it.
                </p>
                <PrimaryButton
                  onClick={auth.signIn}
                  disabled={auth.status === 'signing-in'}
                >
                  {auth.status === 'signing-in' ? 'Signing in' : 'Sign in with Google'}
                </PrimaryButton>
              </Row>
            )}

            {auth.error && (
              <Row>
                <p className="text-meta" style={{ color: 'var(--now)' }}>
                  {auth.error}
                </p>
              </Row>
            )}

            <Row className="flex min-h-11 items-center justify-between gap-2">
              <span className="min-w-0 flex-1">
                <span className="block text-body">
                  {auth.status === 'signed-in'
                    ? (STATUS_LABEL[sync.status] ?? 'Idle')
                    : 'Inactive'}
                </span>
                <span
                  className="mono block text-micro"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  Last synced {formatSynced(sync.lastSyncedAt)}
                </span>
              </span>
              <button
                type="button"
                onClick={sync.syncNow}
                disabled={auth.status !== 'signed-in' || sync.status === 'syncing'}
                className={secondary}
                style={{ borderColor: 'var(--border)' }}
              >
                Sync now
              </button>
            </Row>
          </>
        )}
      </Group>

      <Group title="Your data">
        <RowButton
          onClick={download}
          trailing={<span className="mono text-micro">JSON</span>}
        >
          Export a copy
        </RowButton>

        <Row>
          <label htmlFor={fileId} className={fieldLabel} style={{ color: 'var(--muted-foreground)' }}>
            Import from a file
          </label>
          <input
            id={fileId}
            type="file"
            accept="application/json,.json"
            onChange={(e) => void stage(e.target.files?.[0])}
            className="min-h-11 w-full rounded-lg border px-3 py-2 text-body file:mr-3 file:min-h-9 file:rounded-md file:border-0 file:bg-[var(--muted)] file:px-3 file:text-meta file:font-medium file:text-[color:var(--foreground)]"
            style={fieldStyle}
          />
        </Row>

        {confirming === 'import' && (
          <Row className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applyImport}
              className={destructive}
              style={{ background: 'var(--now)', color: 'var(--accent-foreground)' }}
            >
              Replace everything
            </button>
            <button
              type="button"
              onClick={() => {
                staged.current = null;
                setConfirming(null);
                setMessage('Import cancelled.');
              }}
              className={secondary}
              style={{ borderColor: 'var(--border)' }}
            >
              Cancel
            </button>
          </Row>
        )}

        <RowButton
          onClick={() => setConfirming('reset')}
          tone="danger"
          hint="Empties this device. Export first if you want a copy."
        >
          Reset this device
        </RowButton>
      </Group>

      <p
        className="min-h-5 px-1 text-meta"
        role="status"
        aria-live="polite"
        style={{ color: 'var(--muted-foreground)' }}
      >
        {message}
      </p>

      {confirming === 'reset' && (
        <Confirm
          title="Reset this device?"
          detail="Empties the list on this device. Signed in, the account keeps its copy until this device syncs again."
          confirmLabel="Reset"
          typeToConfirm="reset"
          onConfirm={() => {
            clearState();
            dispatch({ type: 'reset' });
            setConfirming(null);
            setMessage('Reset. The list on this device is empty.');
          }}
          onCancel={() => setConfirming(null)}
        />
      )}

      {categories && <CategoriesEdit onClose={() => setCategories(false)} />}
      {guide && <Setup onClose={() => setGuide(false)} />}
    </div>
  );
}
