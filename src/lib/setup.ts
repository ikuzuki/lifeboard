const SEEN_KEY = 'lifeboard.setup.seen';

/** Device-local: what this person has read is not list data, so it does not sync. */
export function seenSetup(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markSetupSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* private browsing; the guide reappears next time, which is survivable */
  }
}
