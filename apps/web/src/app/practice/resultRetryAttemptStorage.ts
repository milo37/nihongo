import { z } from 'zod'
import { cachedSessionStorage } from '@libs/storage'

const STORAGE_KEY_PREFIX = 'jlpt-drill-note:study-result-retry-attempt:v1:'
const resultRetryAttemptSchema = z
  .object({
    contractVersion: z.literal(2),
    idempotencyKey: z.uuid(),
    principalScope: z.string().min(1),
    sourceSessionId: z.uuid()
  })
  .strict()

export type ResultRetryAttempt = z.output<typeof resultRetryAttemptSchema>

const memoryAttempts = new Map<string, ResultRetryAttempt>()

export const getResultRetryAttemptStorageKey = (
  principalScope: string,
  sourceSessionId: string
): string =>
  `${STORAGE_KEY_PREFIX}${encodeURIComponent(principalScope)}:${encodeURIComponent(sourceSessionId)}`

export const readResultRetryAttempt = (
  principalScope: string,
  sourceSessionId: string
): ResultRetryAttempt | null => {
  const storageKey = getResultRetryAttemptStorageKey(
    principalScope,
    sourceSessionId
  )
  const memoryAttempt = memoryAttempts.get(storageKey)
  if (memoryAttempt) {
    return memoryAttempt
  }

  const serialized = cachedSessionStorage.getItem(storageKey)
  if (!serialized) {
    return null
  }

  try {
    const parsed = resultRetryAttemptSchema.parse(JSON.parse(serialized))
    if (
      parsed.principalScope !== principalScope ||
      parsed.sourceSessionId !== sourceSessionId
    ) {
      throw new Error('retry attempt scope mismatch')
    }
    memoryAttempts.set(storageKey, parsed)
    return parsed
  } catch {
    cachedSessionStorage.removeItem(storageKey)
    return null
  }
}

export const getOrCreateResultRetryAttempt = (
  principalScope: string,
  sourceSessionId: string
): ResultRetryAttempt => {
  const stored = readResultRetryAttempt(principalScope, sourceSessionId)
  if (stored) {
    return stored
  }

  const attempt = resultRetryAttemptSchema.parse({
    contractVersion: 2,
    idempotencyKey: crypto.randomUUID(),
    principalScope,
    sourceSessionId
  })
  const storageKey = getResultRetryAttemptStorageKey(
    principalScope,
    sourceSessionId
  )
  if (!cachedSessionStorage.setItem(storageKey, JSON.stringify(attempt))) {
    throw new Error(
      '오답 재출제 복구 정보를 안전하게 저장하지 못해 요청을 전송하지 않았습니다.'
    )
  }
  memoryAttempts.set(storageKey, attempt)
  return attempt
}

export const clearResultRetryAttempt = (
  principalScope: string,
  sourceSessionId: string
): void => {
  const storageKey = getResultRetryAttemptStorageKey(
    principalScope,
    sourceSessionId
  )
  memoryAttempts.delete(storageKey)
  cachedSessionStorage.removeItem(storageKey)
}

export const clearAllResultRetryAttempts = (): void => {
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

export const clearResultRetryAttemptMemoryCache = (): void => {
  memoryAttempts.clear()
}
