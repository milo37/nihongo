import { cachedSessionStorage } from '@nihongo/browser/libs/storage'

/** A kept screen state older than this is dropped instead of restored. */
export const REAUTH_KEEP_MS = 10 * 60_000

/** Screens that keep input across the same-tab trip to Google. */
export type ReauthKeepScreen =
  | 'question-list'
  | 'report-detail'
  | 'member-detail'
  | 'question-edit'

// The admin ID is part of the key so another account never restores it.
const key = (actorId: string, screen: ReauthKeepScreen): string =>
  `nihongo:admin-reauth:v1:${actorId}:${screen}`

/**
 * Keeps one screen's input in this tab before leaving for Google. False means
 * it was not kept, so the caller must stay on the page and say so.
 */
export const saveReauthKeep = (
  actorId: string,
  screen: ReauthKeepScreen,
  value: unknown,
  now: number = Date.now()
): boolean => {
  try {
    return cachedSessionStorage.setItem(
      key(actorId, screen),
      JSON.stringify({ version: 1, actorId, screen, savedAt: now, value })
    )
  } catch {
    return false
  }
}

/**
 * Returns the kept value once and removes it. The caller validates the shape;
 * anything stale, foreign or unreadable comes back as null.
 */
export const takeReauthKeep = (
  actorId: string,
  screen: ReauthKeepScreen,
  now: number = Date.now()
): unknown => {
  const name = key(actorId, screen)
  const raw = cachedSessionStorage.getItem(name)
  if (raw === null) return null
  cachedSessionStorage.removeItem(name)
  try {
    const kept: unknown = JSON.parse(raw)
    if (
      typeof kept !== 'object' ||
      kept === null ||
      !('version' in kept) ||
      kept.version !== 1 ||
      !('actorId' in kept) ||
      kept.actorId !== actorId ||
      !('screen' in kept) ||
      kept.screen !== screen ||
      !('savedAt' in kept) ||
      typeof kept.savedAt !== 'number' ||
      now - kept.savedAt > REAUTH_KEEP_MS ||
      kept.savedAt > now ||
      !('value' in kept)
    )
      return null
    return kept.value
  } catch {
    return null
  }
}
