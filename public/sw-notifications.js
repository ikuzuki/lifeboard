/*
 * Imported into the generated service worker. Without this, a notification shown by
 * `registration.showNotification` does nothing at all when tapped: unlike a page-created
 * notification, which focuses its tab for free, a worker-shown one has no default click
 * behaviour and the platform simply dismisses it.
 *
 * Kept as a plain script rather than folded into the app bundle because the generated worker
 * is the only place these events arrive, and switching the whole build to injectManifest to
 * own one handler is not worth the risk to the offline shell.
 */

/* global self, clients */

/**
 * An arriving push. The payload is written by the dispatcher and carries only a title and a
 * body it assembled from counts, so there is nothing here to interpret: show it.
 *
 * `userVisibleOnly` is mandatory on every engine, so a push that showed nothing would get the
 * subscription revoked. A malformed payload therefore still shows something rather than
 * silently swallowing the message.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Lifeboard';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    // One tag per window, so an unread morning digest is replaced rather than stacked.
    tag: typeof payload.tag === 'string' ? payload.tag : 'lifeboard',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : [],
    // Kept on the notification so the click handler can honour it. Only a same-origin path
    // is accepted: a url from a push payload is untrusted input, and opening an arbitrary
    // origin from a notification would be a redirect anyone with the endpoint could trigger.
    data: { url: typeof payload.url === 'string' && payload.url.startsWith('/') ? payload.url : '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Action buttons deliberately navigate rather than change anything: the worker holds no
  // credentials, and a button that silently rewrote the list from the shade could be neither
  // seen nor undone. The path was validated as same-origin when the notification was shown.
  const path = (event.notification.data && event.notification.data.url) || '/';
  const target = new URL(path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const mine = open.find((client) => client.url.startsWith(self.location.origin));
      if (mine) {
        await mine.focus();
        if ('navigate' in mine && path !== '/') await mine.navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// A dismissed notification needs no work, but the listener keeps the worker from being
// woken for nothing on some platforms.
self.addEventListener('notificationclose', () => {});
