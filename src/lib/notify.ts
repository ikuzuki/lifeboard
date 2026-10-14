/**
 * Notification permission and a local preview.
 *
 * Permission is never requested on load. It is asked for only from a control the user has
 * just tapped, which is the one pattern every set of guidance agrees on: a prompt that
 * arrives unbidden gets refused, and a refusal on this origin is close to permanent.
 *
 * Nothing here sends a push. `preview` draws the notification locally through the service
 * worker so the real thing can be judged on a real phone, with the real action buttons,
 * before any of the delivery infrastructure exists.
 */

export type NotifyState = 'unsupported' | 'insecure-context' | 'default' | 'granted' | 'denied';

export function notifyState(): NotifyState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  // A service worker is needed for action buttons, and it needs a secure context.
  if (!('serviceWorker' in navigator)) return 'unsupported';
  if (window.isSecureContext === false) return 'insecure-context';
  return Notification.permission as 'default' | 'granted' | 'denied';
}

export async function askForNotifications(): Promise<NotifyState> {
  if (notifyState() === 'unsupported') return 'unsupported';
  const result = await Notification.requestPermission();
  return result as 'granted' | 'denied' | 'default';
}

/** What the morning and evening digests would say, from counts alone. */
export interface Digest {
  missed: number;
  today: number;
  thisWeek: number;
}

export const morningText = (d: Digest): { title: string; body: string } => ({
  title:
    d.missed > 0
      ? `${d.missed} missed, ${d.today} start today`
      : `${d.today} to start today`,
  body: d.thisWeek > 0 ? `${d.thisWeek} more start this week.` : 'Nothing else this week.',
});

export const eveningText = (open: number): { title: string; body: string } => ({
  title: `${open} still open`,
  body: 'Push them to tomorrow, or tick them off.',
});

/**
 * Draws both digests locally, a few seconds apart so they can be seen arriving rather than
 * appearing at once. Uses the service worker registration rather than `new Notification`,
 * because only that route carries action buttons on Android.
 */
export async function preview(digest: Digest, open: number): Promise<'shown' | NotifyState> {
  const state = notifyState();
  if (state !== 'granted') return state;

  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return 'unsupported';

  const morning = morningText(digest);
  await registration.showNotification(morning.title, {
    body: morning.body,
    tag: 'lifeboard-preview-morning',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    silent: false,
  });

  await new Promise((resolve) => setTimeout(resolve, 3500));

  const evening = eveningText(open);
  await registration.showNotification(evening.title, {
    body: evening.body,
    tag: 'lifeboard-preview-evening',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // Android allows two. Safari allows none, and drops them silently.
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'missed', title: 'What you missed' },
    ],
  } as NotificationOptions & { actions: { action: string; title: string }[] });

  return 'shown';
}
