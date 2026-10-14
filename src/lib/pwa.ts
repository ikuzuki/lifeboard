// Service worker registration and the update handshake. The UI subscribes to
// getPwaStatus/subscribeToPwa and calls applyUpdate when the user accepts.

export type PwaStatus = {
  /** A new worker is installed and waiting; the running bundle is now stale. */
  updateReady: boolean;
  /** The shell is precached, so the app will open with no connection. */
  offlineReady: boolean;
};

type Listener = () => void;

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

let status: PwaStatus = { updateReady: false, offlineReady: false };
const listeners = new Set<Listener>();
let waitingWorker: ServiceWorker | null = null;
let reloadRequested = false;

function setStatus(next: Partial<PwaStatus>): void {
  const merged = { ...status, ...next };
  if (merged.updateReady === status.updateReady && merged.offlineReady === status.offlineReady) return;
  status = merged;
  for (const listener of listeners) listener();
}

/** Stable snapshot, safe as the getSnapshot argument to useSyncExternalStore. */
export function getPwaStatus(): PwaStatus {
  return status;
}

export function subscribeToPwa(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Activate the waiting worker. The page reloads once it takes control, so call
 * this only after the user has agreed to lose any in-flight input.
 */
export function applyUpdate(): void {
  if (!waitingWorker) return;
  reloadRequested = true;
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

function trackWaiting(worker: ServiceWorker): void {
  waitingWorker = worker;
  setStatus({ updateReady: true });
}

function watchInstalling(registration: ServiceWorkerRegistration): void {
  const installing = registration.installing;
  if (!installing) return;
  installing.addEventListener('statechange', () => {
    if (installing.state !== 'installed') return;
    if (navigator.serviceWorker.controller) {
      trackWaiting(registration.waiting ?? installing);
    } else {
      setStatus({ offlineReady: true });
    }
  });
}

async function register(): Promise<void> {
  // updateViaCache none stops the HTTP cache from pinning an old worker script.
  const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });

  // Only reload for an update the user asked for. clientsClaim fires this event
  // on first install too, and reloading there is the classic refresh loop.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadRequested) return;
    window.location.reload();
  });

  if (registration.active && !registration.installing && !registration.waiting) {
    setStatus({ offlineReady: true });
  }
  if (registration.waiting && navigator.serviceWorker.controller) {
    trackWaiting(registration.waiting);
  }
  registration.addEventListener('updatefound', () => watchInstalling(registration));

  const check = () => {
    void registration.update();
  };
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

/** Call once on startup. No-op in development and where service workers are absent. */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    register().catch((error: unknown) => {
      console.error('service worker registration failed', error);
    });
  });
}
