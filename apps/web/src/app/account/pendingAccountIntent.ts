import { z } from 'zod'
import { ssoProviderIdSchema } from '@nihongo/contracts/auth/sign-in-social'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'

export type AccountIntent =
  | { kind: 'delete' }
  | { kind: 'unlink'; provider: SsoProviderId }

const STORAGE_KEY = 'harumaru:account-intent:v1'

const storedIntentSchema = z.object({
  userId: z.string().min(1),
  intent: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('delete') }),
    z.object({ kind: z.literal('unlink'), provider: ssoProviderIdSchema })
  ])
})

// Remembers which confirmation the Google round trip belongs to, so the same
// dialog reopens at its second step for the same account on return.
export const savePendingAccountIntent = (
  userId: string,
  intent: AccountIntent
): void => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, intent }))
  } catch {
    // Without storage the user simply chooses the action again on return.
  }
}

export const readPendingAccountIntent = (
  userId: string
): AccountIntent | null => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    const parsed = storedIntentSchema.safeParse(raw ? JSON.parse(raw) : null)
    return parsed.success && parsed.data.userId === userId
      ? parsed.data.intent
      : null
  } catch {
    return null
  }
}

export const takePendingAccountIntent = (
  userId: string
): AccountIntent | null => {
  const intent = readPendingAccountIntent(userId)
  clearPendingAccountIntent()
  return intent
}

export const clearPendingAccountIntent = (): void => {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
