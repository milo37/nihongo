import { z } from 'zod'
import { cachedSessionStorage } from '@libs/storage'

const STORAGE_KEY_PREFIX = 'jlpt-drill-note:targeted-review-attempt:v1:'
const targetedReviewAttemptSchema = z
  .object({
    contractVersion: z.literal(2),
    idempotencyKey: z.uuid(),
    principalScope: z.string().min(1),
    questionId: z.uuid()
  })
  .strict()

export type TargetedReviewAttempt = z.output<typeof targetedReviewAttemptSchema>

const memoryAttempts = new Map<string, TargetedReviewAttempt>()

export const getTargetedReviewAttemptStorageKey = (
  principalScope: string,
  questionId: string
): string =>
  `${STORAGE_KEY_PREFIX}${encodeURIComponent(principalScope)}:${encodeURIComponent(questionId)}`

export const readTargetedReviewAttempt = (
  principalScope: string,
  questionId: string
): TargetedReviewAttempt | null => {
  const storageKey = getTargetedReviewAttemptStorageKey(
    principalScope,
    questionId
  )
  const cached = memoryAttempts.get(storageKey)
  if (cached) {
    return cached
  }

  const serialized = cachedSessionStorage.getItem(storageKey)
  if (!serialized) {
    return null
  }

  try {
    const parsed = targetedReviewAttemptSchema.parse(JSON.parse(serialized))
    if (
      parsed.principalScope !== principalScope ||
      parsed.questionId !== questionId
    ) {
      throw new Error('targeted review attempt scope mismatch')
    }
    memoryAttempts.set(storageKey, parsed)
    return parsed
  } catch {
    cachedSessionStorage.removeItem(storageKey)
    return null
  }
}

export const getOrCreateTargetedReviewAttempt = (
  principalScope: string,
  questionId: string
): TargetedReviewAttempt => {
  const stored = readTargetedReviewAttempt(principalScope, questionId)
  if (stored) {
    return stored
  }

  const attempt = targetedReviewAttemptSchema.parse({
    contractVersion: 2,
    idempotencyKey: crypto.randomUUID(),
    principalScope,
    questionId
  })
  const storageKey = getTargetedReviewAttemptStorageKey(
    principalScope,
    questionId
  )
  if (!cachedSessionStorage.setItem(storageKey, JSON.stringify(attempt))) {
    throw new Error(
      '단일 복습 복구 정보를 안전하게 저장하지 못해 요청을 전송하지 않았습니다.'
    )
  }
  memoryAttempts.set(storageKey, attempt)
  return attempt
}

export const clearTargetedReviewAttempt = (
  principalScope: string,
  questionId: string
): void => {
  const storageKey = getTargetedReviewAttemptStorageKey(
    principalScope,
    questionId
  )
  memoryAttempts.delete(storageKey)
  cachedSessionStorage.removeItem(storageKey)
}

export const clearAllTargetedReviewAttempts = (): void => {
  memoryAttempts.clear()
  if (typeof window === 'undefined') {
    return
  }

  const keys: string[] = []
  try {
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index)
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        keys.push(key)
      }
    }
  } catch {
    return
  }
  keys.forEach((key) => cachedSessionStorage.removeItem(key))
}

export const clearTargetedReviewAttemptMemoryCache = (): void => {
  memoryAttempts.clear()
}
