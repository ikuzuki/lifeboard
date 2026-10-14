import { getCredentials } from './auth';
import { pushKey } from './sync';

/**
 * Subscribing this device to push, and turning it off again.
 *
 * The subscription is written straight to the user's own S3 prefix, which the authenticated
 * role already covers. That avoids building an API for something the browser can do on its
 * own: a table would need an endpoint, a Lambda and an authorizer to achieve exactly this.
 *
 * The role deliberately has no `s3:DeleteObject`, so turning notifications off writes
 * `enabled: false` over the record rather than removing it. The dispatcher skips those, and
 * it matches how the rest of the app soft-closes things.
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export const pushConfigured = (): boolean => Boolean(VAPID_PUBLIC_KEY);

/** The endpoint is a device-scoped secret, so it is hashed before it becomes a key name. */
async function endpointHash(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** VAPID keys travel as base64url; `applicationServerKey` wants raw bytes. */
function decodeKey(base64url: string): ArrayBuffer {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

async function writeRecord(subscription: PushSubscription, enabled: boolean): Promise<void> {
  const session = await getCredentials();
  const bucket = import.meta.env.VITE_SYNC_BUCKET;
  const region = import.meta.env.VITE_AWS_REGION;
  if (!session || !bucket || !region) throw new Error('Not signed in.');

  const { keys } = subscription.toJSON() as { keys?: { p256dh?: string; auth?: string } };
  const body = JSON.stringify({
    version: 1,
    enabled,
    endpoint: subscription.endpoint,
    p256dh: keys?.p256dh ?? null,
    auth: keys?.auth ?? null,
    // So a subscription that has stopped working can be recognised as old rather than broken.
    subscribedAt: new Date().toISOString(),
  });

  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ region, credentials: session.credentials });
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: pushKey(session.identityId, await endpointHash(subscription.endpoint)),
      Body: body,
      ContentType: 'application/json',
    }),
  );
}

/** True when this device already holds a subscription, whatever the account thinks. */
export async function isSubscribed(): Promise<boolean> {
  const registration = await navigator.serviceWorker.getRegistration();
  return Boolean(await registration?.pushManager.getSubscription());
}

export async function subscribe(): Promise<'subscribed' | 'unsupported' | 'denied' | 'failed'> {
  if (!pushConfigured()) return 'unsupported';
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration || !('pushManager' in registration)) return 'unsupported';
  if (Notification.permission !== 'granted') return 'denied';

  try {
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        // Required on every engine: a subscription that could receive silent pushes is not
        // permitted, so every message this account sends costs the user an interruption.
        userVisibleOnly: true,
        applicationServerKey: decodeKey(VAPID_PUBLIC_KEY as string),
      }));
    await writeRecord(subscription, true);
    return 'subscribed';
  } catch {
    return 'failed';
  }
}

export async function unsubscribe(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  // Marked disabled before the local unsubscribe, so a failure here cannot leave the account
  // sending to an endpoint this device has already thrown away.
  await writeRecord(subscription, false);
  await subscription.unsubscribe();
}
