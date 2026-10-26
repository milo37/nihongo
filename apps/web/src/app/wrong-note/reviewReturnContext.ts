import { z } from 'zod'
import { cachedSessionStorage } from '@nihongo/browser/libs/storage'
import { getSafeWrongNoteReturnTo } from '@app/wrong-note/reviewQueueSearch'

const contextSchema = z
  .object({
    principalScope: z.string().min(1),
    sessionId: z.string().min(1),
    questionId: z.string().min(1),
    returnTo: z.string()
  })
  .strict()
const key = (principalScope: string, sessionId: string): string =>
  `jlpt-drill-note:review-return:v1:${encodeURIComponent(principalScope)}:${encodeURIComponent(sessionId)}`

export const saveReviewReturnContext = (
  input: z.input<typeof contextSchema>
): void => {
  const context = contextSchema.parse(input)
  cachedSessionStorage.setItem(
    key(context.principalScope, context.sessionId),
    JSON.stringify({
      ...context,
      returnTo: getSafeWrongNoteReturnTo(context.returnTo)
    })
  )
}

export const readReviewReturnContext = (
  principalScope: string,
  sessionId: string
) => {
  try {
    const raw = cachedSessionStorage.getItem(key(principalScope, sessionId))
    if (!raw) return null
    const context = contextSchema.parse(JSON.parse(raw))
    if (
      context.principalScope !== principalScope ||
      context.sessionId !== sessionId
    )
      return null
    return { ...context, returnTo: getSafeWrongNoteReturnTo(context.returnTo) }
  } catch {
    return null
  }
}

const lastResultKey = (principalScope: string): string =>
  `jlpt-drill-note:last-result:v1:${encodeURIComponent(principalScope)}`

export const rememberCurrentResult = (
  principalScope: string,
  sessionId: string
): void => {
  cachedSessionStorage.setItem(lastResultKey(principalScope), sessionId)
}

// This is only a navigation hint. The guest page verifies ownership again with the server.
export const readCurrentResult = (principalScope: string): string =>
  cachedSessionStorage.getItem(lastResultKey(principalScope)) ?? ''
