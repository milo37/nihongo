import type { PushLocale } from '@nihongo/contracts/notification/web-push'
import { deletePushSubscription, putPushSubscription } from '@api/push'

/**
 * #1046: this device's daily goal push. A subscription belongs to the
 * browser, so the switch shows this device only.
 * - hidden: the browser cannot take push (no switch at all)
 * - ios: iPhone/iPad before the site is added to the home screen
 * - denied: the browser blocked notifications; only its settings undo that
 * - off / on: this device has no subscription / has one
 */
export type DevicePushState = 'hidden' | 'ios' | 'denied' | 'off' | 'on'

const IOS_DEVICE = /iPhone|iPad|iPod/u

const isIosDevice = (): boolean =>
  IOS_DEVICE.test(navigator.userAgent) ||
  // iPadOS reports itself as a Mac with a touch screen.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const canPush = (): boolean =>
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

const currentSubscription = async (): Promise<PushSubscription | null> => {
  if (!canPush()) return null
  const registration = await navigator.serviceWorker.getRegistration('/')
  return (await registration?.pushManager.getSubscription()) ?? null
}

export const readDevicePush = async (): Promise<DevicePushState> => {
  // iOS gives web push only to a site opened from the home screen.
  if (!canPush()) return isIosDevice() ? 'ios' : 'hidden'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'off'
  return (await currentSubscription()) ? 'on' : 'off'
}

/** Must run inside the tap that turns the switch on. */
export const askPushPermission = (): Promise<NotificationPermission> =>
  Notification.requestPermission()

// The server key is base64url; subscribe() wants its bytes.
const keyBytes = (key: string): Uint8Array<ArrayBuffer> => {
  const base64 = key.replaceAll('-', '+').replaceAll('_', '/')
  const text = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(text, (char) => char.charCodeAt(0))
}

/** Subscribes this device (or keeps its subscription) and tells the server. */
export const turnOnDevicePush = async (
  publicKey: string,
  locale: PushLocale
): Promise<void> => {
  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey)
    }))
  const { keys } = subscription.toJSON()
  await putPushSubscription({
    endpoint: subscription.endpoint,
    keys: { p256dh: keys?.p256dh ?? '', auth: keys?.auth ?? '' },
    locale
  })
}

/**
 * Turns this device off. Never fails: the browser drops its subscription even
 * when the server cannot be told, and the push service then answers the
 * server's next send with 'gone', which deletes it there too.
 */
export const turnOffDevicePush = async (): Promise<void> => {
  try {
    const subscription = await currentSubscription()
    if (!subscription) return
    await deletePushSubscription({ endpoint: subscription.endpoint }).catch(
      () => undefined
    )
    await subscription.unsubscribe()
  } catch {
    // Nothing left to undo on this device.
  }
}
