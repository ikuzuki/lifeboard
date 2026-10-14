/**
 * Theme preference, persisted. Three states rather than a boolean: `system` is a real
 * answer and is the default, so a device that switches to dark in the evening still
 * follows until the user makes an explicit choice.
 */
export type Theme = 'light' | 'dark' | 'system';

const KEY = 'lifeboard.theme';

const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark' || v === 'system';

export function readTheme(): Theme {
  try {
    const raw = localStorage.getItem(KEY);
    return isTheme(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

const prefersDark = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;

/** Whether the given preference renders dark right now. */
export const isDarkFor = (theme: Theme): boolean =>
  theme === 'dark' || (theme === 'system' && prefersDark());

/**
 * Writes the class the tokens key off. Called once from `main.tsx` before React renders,
 * so the first paint is already the right theme.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', isDarkFor(theme));
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private browsing; the choice lasts the session */
  }
  applyTheme(theme);
}

/**
 * Keeps a `system` preference honest when the device flips mid-session. Returns an
 * unsubscribe. A stored explicit choice ignores the device.
 */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (readTheme() === 'system') applyTheme('system');
  };
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
