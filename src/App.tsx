import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { GoalEdit } from './components/GoalEdit';
import { ItemDetail } from './components/ItemDetail';
import { QuickAdd } from './components/QuickAdd';
import { BrainDump } from './components/BrainDump';
import { AddMenu, type AddChoice } from './components/AddMenu';
import { applyUpdate, getPwaStatus, subscribeToPwa } from './lib/pwa';
import { isConfigured, restore, useAuth } from './lib/auth';
import { captureConfigured } from './lib/capture';
import { ArchiveView } from './views/ArchiveView';
import { SettingsView } from './views/SettingsView';
import { BuyView } from './views/BuyView';
import { CalendarView } from './views/CalendarView';
import { GoalsView } from './views/GoalsView';
import { TodayView } from './views/TodayView';
import { Screen } from './components/Screen';
import { StoreContext, reducer } from './store';
import { initStorage, persist, requestPersistence } from './lib/storage';
import { startSync, useSync } from './lib/sync';
import type { State } from './types';
import { chime } from './lib/feedback';
import type { Category, Day, Goal, Item } from './types';

type Tab = 'today' | 'calendar' | 'goals' | 'buy';

/**
 * `before` holds the pre-action copies of only the items the action touched, so undoing
 * cannot discard an unrelated edit made while the toast was up. `pickId` turns the toast
 * into a second route: undo, or go and choose a date.
 */
interface Undo {
  label: string;
  before: Item[];
  pickId?: string;
}

const TABS: { id: Tab; label: string; path: string }[] = [
  { id: 'today', label: 'Today', path: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2' },
  { id: 'calendar', label: 'Calendar', path: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4' },
  { id: 'goals', label: 'Goals', path: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' },
  { id: 'buy', label: 'Buy', path: 'M5 8h14l-1.2 11H6.2zM9 8V6a3 3 0 0 1 6 0v2' },
];

const Icon = ({ path, size = 18 }: { path: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={path} />
  </svg>
);

/**
 * IndexedDB is asynchronous, so the store cannot be read during the first render. This
 * waits for it rather than seeding from nothing: reseeding over data that was merely
 * slow to arrive would look exactly like losing the list.
 */
export default function App() {
  const [initial, setInitial] = useState<State | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    // `restore` finishes the sign-in redirect and rehydrates a saved session. It has to
    // settle before the shell mounts, or the first sync would run unauthenticated and the
    // `?code=` would still be sitting in the address bar. Its rejection is swallowed on
    // purpose: a sign-in problem belongs in Settings, not in the error boundary that
    // would otherwise take the whole list down with it.
    Promise.all([initStorage(), restore().catch(() => undefined)]).then(
      ([loaded]) => void (live && setInitial(loaded)),
      (error: unknown) => void (live && setFailure(error)),
    );
    return () => {
      live = false;
    };
  }, []);

  // Unreadable saved data is for the error boundary to explain, not for this to paper over.
  if (failure) throw failure;
  if (!initial) {
    return (
      <div className="grid min-h-full place-items-center" aria-busy="true">
        <span className="sr-only">Loading your list</span>
      </div>
    );
  }
  return <Shell initial={initial} />;
}

function Shell({ initial }: { initial: State }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [tab, setTab] = useState<Tab>('today');
  const [openId, setOpenId] = useState<string | null>(null);
  /** `act` seeds the date when the add came from tapping an empty calendar day. */
  const [adding, setAdding] = useState<{ act?: Day } | null>(null);
  const [dumping, setDumping] = useState(false);
  const [editing, setEditing] = useState<{ goal: Goal | null } | null>(null);
  const [archive, setArchive] = useState(false);
  const [settings, setSettings] = useState(false);
  const [filter, setFilter] = useState<Category | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // The waiting worker is never activated behind the user's back, so without this the
  // installed app would keep serving the build it precached and never take a deploy.
  const { updateReady } = useSyncExternalStore(subscribeToPwa, getPwaStatus, getPwaStatus);
  const [announcement, setAnnouncement] = useState('');
  const auth = useAuth();
  const { lastSyncedAt } = useSync();
  // A device that has synced before and is no longer signed in is holding the only copy of
  // every edit since. Said on the main screen, because Settings is not where anyone looks.
  const syncLapsed =
    isConfigured() &&
    lastSyncedAt !== null &&
    auth.status !== 'signed-in' &&
    auth.status !== 'signing-in';
  const undoTimer = useRef<number | undefined>(undefined);

  useEffect(() => persist(state), [state]);

  // The theme is applied in main.tsx before render, so nothing to do here.
  // `startSync` is a no-op without Cognito configuration, and returns its own teardown.
  useEffect(() => {
    requestPersistence();
    return startSync();
  }, []);

  const store = useMemo(() => ({ state, dispatch }), [state]);
  const openItem = state.items.find((i) => i.id === openId) ?? null;

  const addChoices: AddChoice[] = [
    tab === 'goals'
      ? {
          key: 'goal',
          label: 'New goal',
          icon: 'M12 3v18M5 8h14l-2.5 4L19 16H5',
          onPick: () => setEditing({ goal: null }),
        }
      : {
          key: 'item',
          label: tab === 'buy' ? 'New purchase' : 'New item',
          icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
          onPick: () => setAdding({}),
        },
    ...(tab === 'today'
      ? [
          {
            key: 'goal',
            label: 'New goal',
            icon: 'M12 3v18M5 8h14l-2.5 4L19 16H5',
            onPick: () => setEditing({ goal: null }),
          },
        ]
      : []),
    ...(captureConfigured()
      ? [
          {
            key: 'dump',
            label: 'Brain dump',
            icon: 'M12 19v3M8 22h8M5 10a7 7 0 0 1 14 0c0 3-2 4-2 6H7c0-2-2-3-2-6z',
            onPick: () => setDumping(true),
          },
        ]
      : []),
  ];

  const offerUndo = (undoable: Undo) => {
    setUndo(undoable);
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 8000);
  };

  const complete = (id: string) => {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    offerUndo({ label: item.title, before: [item] });
    dispatch({ type: 'complete', id });
    chime();
    setAnnouncement(
      item.recurrence ? `${item.title} done, next one scheduled` : `${item.title} completed`,
    );
  };

  // Pulling forward commits to today. A different day is one more tap, from the toast,
  // rather than a menu on every card.
  const push = (id: string) => {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    dispatch({ type: 'snooze', id, days: 1 });
    offerUndo({ label: '+1 day', before: [item], pickId: id });
    setAnnouncement(`${item.title} pushed on a day`);
  };

  const pullForward = (id: string) => {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    offerUndo({ label: 'Moved to today', before: [item], pickId: id });
    dispatch({ type: 'pullForward', id });
    setAnnouncement(`${item.title} moved to today`);
  };

  return (
    <StoreContext.Provider value={store}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:px-3 focus:py-2"
        style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
      >
        Skip to content
      </a>

      <div
        className="mx-auto flex min-h-full max-w-[460px] flex-col border-x pb-[86px]"
        style={{ borderColor: 'var(--border)', background: 'var(--background)' }}
      >
        <header
          className="sticky top-0 z-20 flex items-center justify-between border-b px-4 py-2"
          style={{ background: 'var(--background)', borderColor: 'var(--border)' }}
        >
          <h1 className="text-head font-semibold tracking-[-0.022em]">
            {TABS.find((t) => t.id === tab)?.label}
          </h1>

          <div className="flex items-center" style={{ color: 'var(--muted-foreground)' }}>
            <button
              type="button"
              onClick={() => setArchive(true)}
              aria-label="Open archive"
              className="grid h-11 w-11 place-items-center"
            >
              <Icon path="M4 7h16v3H4zM6 10h12v10H6zM10 14h4" />
            </button>
            <button
              type="button"
              onClick={() => setSettings(true)}
              aria-label="Open settings"
              className="grid h-11 w-11 place-items-center"
            >
              <Icon path="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H2.8a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4V3.8a2 2 0 1 1 4 0V4a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11h.2a2 2 0 1 1 0 4H21z" />
            </button>
          </div>
        </header>

        {syncLapsed && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 border-b px-4 py-1 text-meta"
            style={{ borderColor: 'var(--border)', color: 'var(--now)' }}
          >
            <span>Sync is off on this device.</span>
            <button
              type="button"
              onClick={auth.signIn}
              className="min-h-11 rounded-full px-4 font-semibold"
              style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
            >
              Sign in
            </button>
          </div>
        )}

        <main id="main" className="flex-1 px-4 pt-3 pb-10">
          {tab === 'today' && (
            <TodayView
              onOpen={setOpenId}
              onComplete={complete}
              onPullForward={pullForward}
              onSnooze={push}
              filter={filter}
              onFilter={setFilter}
            />
          )}
          {tab === 'calendar' && (
            <CalendarView onOpen={setOpenId} onAdd={(day) => setAdding({ act: day })} />
          )}
          {tab === 'goals' && (
            <GoalsView
              onOpen={setOpenId}
              onComplete={complete}
              onEdit={(goal) => setEditing({ goal })}
            />
          )}
          {tab === 'buy' && <BuyView onOpen={setOpenId} onComplete={complete} />}
        </main>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {updateReady && !undo && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[150px] z-40 mx-auto flex max-w-[460px] justify-center px-4">
          <div
            className="toast-in pointer-events-auto flex items-center gap-1 rounded-full py-1 pr-1 pl-4 text-body"
            style={{ background: 'var(--foreground)', color: 'var(--background)' }}
          >
            <span>New version ready</span>
            <button
              type="button"
              onClick={applyUpdate}
              className="min-h-11 rounded-full px-5 font-semibold"
              style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
            >
              Reload
            </button>
          </div>
        </div>
      )}

      {undo && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[150px] z-40 mx-auto flex max-w-[460px] justify-center px-4">
          <div
            className="toast-in pointer-events-auto flex items-center gap-1 rounded-full py-1 pr-1 pl-4 text-body"
            style={{ background: 'var(--foreground)', color: 'var(--background)' }}
          >
            <span className="max-w-[120px] truncate">{undo.label}</span>
            {undo.pickId && (
              <button
                type="button"
                onClick={() => {
                  setOpenId(undo.pickId ?? null);
                  setUndo(null);
                }}
                className="min-h-11 rounded-full px-3 font-medium"
              >
                Pick a date
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                dispatch({ type: 'restoreItems', items: undo.before });
                setUndo(null);
                setAnnouncement('Undone');
              }}
              className="min-h-11 rounded-full px-5 font-semibold"
              style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
            >
              Undo
            </button>
          </div>
        </div>
      )}

      {/* The calendar adds per day, from an empty day or the panel's own Add. */}
      {tab !== 'calendar' && (
        <AddMenu
          open={addOpen}
          onOpen={() => setAddOpen(true)}
          onClose={() => setAddOpen(false)}
          label="Add something"
          choices={addChoices}
        />
      )}

      <nav
        aria-label="Sections"
        className="fixed bottom-0 left-1/2 z-30 grid w-full max-w-[460px] -translate-x-1/2 grid-cols-4 border-t"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => {
                // Closed on the way out. The menu is unmounted rather than closed when the
                // tab changes, so without this it reopened itself on the way back.
                setAddOpen(false);
                setTab(t.id);
                window.scrollTo(0, 0);
              }}
              className="-mt-px flex min-h-14 flex-col items-center justify-center gap-1 border-t-2 px-1 text-micro font-medium"
              style={{
                color: on ? 'var(--accent)' : 'var(--muted-foreground)',
                borderTopColor: on ? 'var(--accent)' : 'transparent',
              }}
            >
              <Icon path={t.path} size={19} />
              {t.label}
            </button>
          );
        })}
      </nav>

      {openItem && <ItemDetail item={openItem} onClose={() => setOpenId(null)} />}
      {adding && (
        <QuickAdd
          onClose={() => setAdding(null)}
          defaultCategory={filter}
          defaultBuy={tab === 'buy'}
          defaultAct={adding.act}
        />
      )}
      {dumping && <BrainDump onClose={() => setDumping(false)} />}
      {editing && <GoalEdit goal={editing.goal} onClose={() => setEditing(null)} />}
      {archive && (
        <Screen title="Archive" onClose={() => setArchive(false)}>
          <ArchiveView onOpen={setOpenId} />
        </Screen>
      )}
      {settings && (
        <Screen title="Settings" onClose={() => setSettings(false)}>
          <SettingsView />
        </Screen>
      )}
    </StoreContext.Provider>
  );
}
