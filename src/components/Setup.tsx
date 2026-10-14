import { useEffect, useRef, useState } from 'react';
import { Chevron } from './controls';
import { markSetupSeen, seenSetup } from '../lib/setup';
import { isConfigured, useAuth } from '../lib/auth';
import { captureConfigured } from '../lib/capture';

const MUTED = { color: 'var(--muted-foreground)' } as const;

const ARCHIVE = 'M4 7h16v3H4zM6 10h12v10H6zM10 14h4';
const GEAR =
  'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H2.8a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4V3.8a2 2 0 1 1 4 0V4a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11h.2a2 2 0 1 1 0 4H21z';

const Glyph = ({ path, size = 19 }: { path: string; size?: number }) => (
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

/** The whole chrome: header icons at the top, four tabs at the bottom. */
function TabsMock() {
  const tabs = [
    { label: 'Today', path: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2' },
    { label: 'Calendar', path: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4' },
    { label: 'Goals', path: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' },
    { label: 'Buy', path: 'M5 8h14l-1.2 11H6.2zM9 8V6a3 3 0 0 1 6 0v2' },
  ];
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-xl border"
      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="text-meta font-semibold">Today</span>
        <span className="flex items-center gap-2" style={MUTED}>
          <Glyph path={ARCHIVE} size={15} />
          <Glyph path={GEAR} size={15} />
        </span>
      </div>

      <div className="flex flex-col gap-1.5 px-3 py-3">
        <span className="h-1.5 w-3/4 rounded-full" style={{ background: 'var(--border)' }} />
        <span className="h-1.5 w-1/2 rounded-full" style={{ background: 'var(--border)' }} />
      </div>

      <div className="grid grid-cols-4 border-t" style={{ borderColor: 'var(--border)' }}>
        {tabs.map((t, n) => (
          <span
            key={t.label}
            className="-mt-px flex flex-col items-center justify-center gap-1 border-t-2 py-2.5 text-micro font-medium"
            style={{
              color: n === 0 ? 'var(--accent)' : 'var(--muted-foreground)',
              borderTopColor: n === 0 ? 'var(--accent)' : 'transparent',
            }}
          >
            <Glyph path={t.path} />
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The work draws itself from the start-by date towards the deadline. */
function Timeline() {
  return (
    <svg viewBox="0 0 260 92" className="w-full" role="img" aria-label="Start by sits before the deadline">
      <line x1="14" y1="46" x2="246" y2="46" stroke="var(--border)" strokeWidth="2" />
      <line
        className="guide-draw"
        pathLength="1"
        x1="70"
        y1="46"
        x2="210"
        y2="46"
        stroke="var(--accent)"
        strokeWidth="2"
      />
      <circle cx="70" cy="46" r="7" fill="var(--accent)" />
      <circle cx="210" cy="46" r="7" fill="none" stroke="var(--now)" strokeWidth="2.5" />
      <text x="70" y="28" textAnchor="middle" fontSize="11" fill="var(--foreground)">
        start by
      </text>
      <text x="210" y="28" textAnchor="middle" fontSize="11" fill="var(--now)">
        due
      </text>
      <text x="140" y="70" textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">
        the work
      </text>
    </svg>
  );
}

/** The add button opening and closing. The brain dump is only in a build with a parser. */
function AddMock({ dump }: { dump: boolean }) {
  const choices = [
    {
      label: 'New item',
      path: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
    },
    { label: 'New goal', path: 'M12 3v18M5 8h14l-2.5 4L19 16H5' },
    ...(dump
      ? [{ label: 'Brain dump', path: 'M12 19v3M8 22h8M5 10a7 7 0 0 1 14 0c0 3-2 4-2 6H7c0-2-2-3-2-6z' }]
      : []),
  ];
  return (
    <div aria-hidden="true" className="flex flex-col items-end gap-1.5">
      {choices.map((c, n) => (
        <span
          key={c.label}
          className="guide-choice flex items-center gap-2 rounded-full border py-1 pr-1 pl-3.5 text-body font-medium"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--border)',
            animationDelay: `${n * 0.12}s`,
          }}
        >
          {c.label}
          <span
            className="grid h-8 w-8 flex-none place-items-center rounded-full"
            style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
          >
            <Glyph path={c.path} size={17} />
          </span>
        </span>
      ))}
      <span
        className="guide-fab grid h-12 w-12 place-items-center rounded-full"
        style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
      >
        <Glyph path="M12 5v14M5 12h14" size={22} />
      </span>
    </div>
  );
}

/**
 * Both swipes in turn, each card held past its threshold so the panel behind it shows.
 * The travel clears the checkbox, which is what the card does under a thumb.
 */
function SwipeMock() {
  const rows = [
    {
      title: 'Find the passport',
      hue: 'var(--cat-blue)',
      move: 'guide-swipe-right',
      align: 'flex-start',
      label: 'Done',
      panel: 'var(--accent)',
      ink: 'var(--accent-foreground)',
    },
    {
      title: 'Sort out the bike',
      hue: 'var(--cat-green)',
      move: 'guide-swipe-left',
      align: 'flex-end',
      label: '+1 day',
      panel: 'var(--muted)',
      ink: 'var(--muted-foreground)',
    },
  ];
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {rows.map((r) => (
        <span
          key={r.title}
          className="relative block overflow-hidden"
          style={{ borderRadius: 14, height: 50 }}
        >
          <span
            className="absolute inset-0 flex items-center px-3 text-micro font-medium"
            style={{ background: r.panel, color: r.ink, justifyContent: r.align }}
          >
            {r.label}
          </span>
          <span
            className={`${r.move} absolute inset-0 flex items-center gap-3 border px-4`}
            style={{
              background: 'var(--card)',
              borderColor: 'var(--border)',
              borderLeftWidth: 4,
              borderLeftColor: r.hue,
              borderRadius: 14,
            }}
          >
            <span
              className="h-[22px] w-[22px] flex-none rounded-[6px] border-[1.5px]"
              style={{ borderColor: 'var(--muted-foreground)' }}
            />
            <span className="text-row font-medium tracking-[-0.008em]">{r.title}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

/** The overdue pass, stepping to the next one and back. */
function MissedMock() {
  return (
    <div
      aria-hidden="true"
      className="rounded-[14px] border px-3.5 py-3"
      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-1" style={MUTED}>
        <span className="flex-1 text-meta font-semibold" style={{ color: 'var(--foreground)' }}>
          What you missed
        </span>
        <Chevron dir="left" />
        <span className="relative mono text-micro">
          <span className="guide-step-out">1 of 3</span>
          <span className="guide-step-in absolute inset-0">2 of 3</span>
        </span>
        <Chevron dir="right" />
        <span className="pl-1.5">
          <Glyph path="M6 6l12 12M18 6L6 18" size={15} />
        </span>
      </div>

      <div className="relative mt-1">
        <div className="guide-step-out">
          <p className="text-lead font-semibold tracking-[-0.014em]">Sort out the bike</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="mono text-meta font-semibold" style={{ color: 'var(--now)' }}>
              4d late
            </span>
            <span className="text-micro" style={MUTED}>
              · Home
            </span>
          </p>
        </div>
        <div className="guide-step-in absolute inset-0">
          <p className="text-lead font-semibold tracking-[-0.014em]">Chase the water bill</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="mono text-meta font-semibold" style={{ color: 'var(--now)' }}>
              1d late
            </span>
            <span className="text-micro" style={MUTED}>
              · Admin
            </span>
          </p>
        </div>
      </div>

      <div
        className="mt-2.5 flex overflow-hidden rounded-lg border text-meta font-medium"
        style={{ borderColor: 'var(--border)' }}
      >
        {['Today', 'Tomorrow', 'Next week'].map((label, n) => (
          <span
            key={label}
            className="flex-1 py-2 text-center"
            style={{
              borderLeftWidth: n === 0 ? 0 : 1,
              borderLeftColor: 'var(--border)',
              ...MUTED,
            }}
          >
            {label}
          </span>
        ))}
      </div>

      <div className="mt-1.5 flex items-center justify-between text-meta font-medium">
        <span style={{ color: 'var(--accent)' }}>Done</span>
        <span style={{ color: 'var(--now)' }}>Drop</span>
      </div>
    </div>
  );
}

/** A row arriving on the second device, over a link that keeps flowing. */
function SyncMock() {
  return (
    <svg viewBox="0 0 260 92" className="w-full" role="img" aria-label="One list on two devices">
      <rect x="34" y="20" width="52" height="52" rx="8" fill="none" stroke="var(--border)" strokeWidth="2" />
      <rect x="174" y="20" width="52" height="52" rx="8" fill="none" stroke="var(--border)" strokeWidth="2" />
      <line x1="44" y1="36" x2="76" y2="36" stroke="var(--accent)" strokeWidth="3" />
      <line x1="44" y1="46" x2="70" y2="46" stroke="var(--border)" strokeWidth="3" />
      <line
        className="guide-draw"
        pathLength="1"
        x1="184"
        y1="36"
        x2="216"
        y2="36"
        stroke="var(--accent)"
        strokeWidth="3"
      />
      <line x1="184" y1="46" x2="210" y2="46" stroke="var(--border)" strokeWidth="3" />
      <line
        className="guide-flow"
        x1="94"
        y1="46"
        x2="166"
        y2="46"
        stroke="var(--accent)"
        strokeWidth="2"
      />
    </svg>
  );
}

interface Page {
  title: string;
  /** One bolded lead plus a few words, or a bare line where no lead helps. */
  points: { lead?: string; text: string }[];
  art: React.ReactNode;
}

function guidePages(): Page[] {
  const dump = captureConfigured();
  return [
    {
      title: 'Four tabs',
      points: [
        { lead: 'Today', text: 'what to pick up now' },
        { lead: 'Calendar', text: 'the month, starts and deadlines' },
        { lead: 'Goals', text: 'steps you date into Today' },
        { lead: 'Buy', text: 'shopping, this month to wishlist' },
        { lead: 'Header', text: 'archive, settings, this guide' },
      ],
      art: <TabsMock />,
    },
    {
      title: 'Start by, not due',
      points: [{ text: 'The last day you can begin and still finish. Every list sorts on it.' }],
      art: <Timeline />,
    },
    {
      title: 'Adding something',
      points: [
        { text: 'The + follows the tab - an item, a goal, or a purchase on Buy.' },
        ...(dump ? [{ lead: 'Brain dump', text: 'ramble in, drafts you keep or discard' }] : []),
      ],
      art: <AddMock dump={dump} />,
    },
    {
      title: 'Working a card',
      points: [{ text: 'Swipe right to finish, left to push a day. Both undo.' }],
      art: <SwipeMock />,
    },
    {
      title: 'What you missed',
      points: [{ text: 'Overdue work leads Today, most late first.' }],
      art: <MissedMock />,
    },
  ];
}

const SIGN_IN_PAGE: Page = {
  title: 'Keep it on every device',
  points: [{ text: 'Sign in with Google and this list follows you. Optional.' }],
  art: <SyncMock />,
};

/**
 * What each surface is for, plus the one date rule the whole app sorts on. Read once on
 * first run, and reachable again from Settings, which is also where categories are named:
 * a newcomer has seven sensible defaults and no reason to rename anything before they
 * have added a single item.
 */
export function Setup({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const { status, signIn } = useAuth();
  // Offered on first open rather than buried in Settings, but only in a build that has
  // somewhere to sign in to.
  const pages = [...guidePages(), ...(isConfigured() ? [SIGN_IN_PAGE] : [])];
  const last = page === pages.length - 1;
  const offerSignIn = last && isConfigured() && status !== 'signed-in';

  const finish = () => {
    markSetupSeen();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      markSetupSeen();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const current = pages[page];

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-center"
      style={{ background: 'var(--background)' }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Setup guide"
        className="flex w-full max-w-[460px] flex-col px-4 pt-3 pb-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5" aria-hidden="true">
            {pages.map((p, n) => (
              <span
                key={p.title}
                className="h-1.5 w-6 rounded-full"
                style={{ background: n === page ? 'var(--accent)' : 'var(--border)' }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={finish}
            className="min-h-11 px-3 text-meta font-medium"
            style={MUTED}
          >
            Skip
          </button>
        </div>

        <div className="flex flex-1 flex-col justify-center py-6">
          <div className="reveal-in" key={current.title}>
            <div
              className="rounded-2xl border p-4"
              style={{ borderColor: 'var(--border)', background: 'var(--muted)' }}
            >
              {current.art}
            </div>

            <h2 className="mt-6 text-head font-semibold tracking-[-0.022em]">{current.title}</h2>
            <div className="mt-2 flex flex-col gap-1.5">
              {current.points.map((p) => (
                <p key={p.text} className="text-row" style={MUTED}>
                  {p.lead && (
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                      {p.lead}{' '}
                    </span>
                  )}
                  {p.text}
                </p>
              ))}
            </div>
          </div>
        </div>

        {/* On the sign-in page the primary takes a row of its own, with the two ways past it
            sharing the one beneath. Three controls in a single line made the accent primary the
            narrowest of them at 320 wide, its label wrapping inside a 48px button. */}
        <div className="flex flex-col gap-2">
          {offerSignIn && (
            <button
              type="button"
              onClick={() => {
                // Marked seen before the redirect, or the guide comes back with the user.
                markSetupSeen();
                void signIn();
              }}
              className="min-h-12 w-full rounded-lg text-row font-semibold whitespace-nowrap"
              style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
            >
              Sign in with Google
            </button>
          )}

          <div className="flex items-center gap-2">
            {page > 0 && (
              <button
                type="button"
                onClick={() => setPage(page - 1)}
                className={`min-h-12 rounded-lg border px-5 text-row font-medium ${offerSignIn ? 'flex-1' : ''}`}
                style={{ borderColor: 'var(--border)' }}
              >
                Back
              </button>
            )}
            {offerSignIn ? (
              <button
                type="button"
                onClick={finish}
                className="min-h-12 flex-1 rounded-lg border px-5 text-row font-medium"
                style={{ borderColor: 'var(--border)' }}
              >
                Not now
              </button>
            ) : (
              <button
                type="button"
                onClick={() => (last ? finish() : setPage(page + 1))}
                className="min-h-12 flex-1 rounded-lg text-row font-semibold"
                style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
              >
                {last ? 'Start' : 'Next'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** First run only. Mount once, anywhere above the app. */
export function SetupGate() {
  const [open, setOpen] = useState(() => !seenSetup());
  if (!open) return null;
  return <Setup onClose={() => setOpen(false)} />;
}
