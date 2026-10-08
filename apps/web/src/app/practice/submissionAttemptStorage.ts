import { cachedSessionStorage } from '@libs/storage'

const STORAGE_KEY_PREFIX = 'jlpt-drill-note:study-submission-attempt:v1:'
const memoryAttempts = new Map<string, unknown>()

export interface StoredSubmissionLogicalRequest {
  answers: Array<{
    questionId: string
    selectedOptionId: string
    elapsedSec: number
  }>
  durationSec: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const getSubmissionAttemptStorageKey = (sessionId: string): string =>
  `${STORAGE_KEY_PREFIX}${encodeURIComponent(sessionId)}`

export const readStoredSubmissionAttempt = (
  sessionId: string
): unknown | null => {
  if (memoryAttempts.has(sessionId)) {
    return memoryAttempts.get(sessionId) ?? null
  }

  const serialized = cachedSessionStorage.getItem(
    getSubmissionAttemptStorageKey(sessionId)
  )
  if (!serialized) {
    return null
  }

  try {
    const value: unknown = JSON.parse(serialized)
    memoryAttempts.set(sessionId, value)
    return value
  } catch {
    cachedSessionStorage.removeItem(getSubmissionAttemptStorageKey(sessionId))
    return null
  }
}

export const hasStoredSubmissionAttempt = (sessionId: string): boolean =>
  readStoredSubmissionAttempt(sessionId) !== null

export const readStoredSubmissionLogicalRequest = (
  sessionId: string
): StoredSubmissionLogicalRequest | null => {
  const attempt = readStoredSubmissionAttempt(sessionId)
  if (!isRecord(attempt) || !isRecord(attempt.logicalRequest)) {
    return null
  }

  const { answers, durationSec } = attempt.logicalRequest
  if (
    !Array.isArray(answers) ||
    typeof durationSec !== 'number' ||
    !Number.isFinite(durationSec) ||
    answers.some(
      (answer) =>
        !isRecord(answer) ||
        typeof answer.questionId !== 'string' ||
        typeof answer.selectedOptionId !== 'string' ||
        typeof answer.elapsedSec !== 'number' ||
        !Number.isFinite(answer.elapsedSec)
    )
  ) {
    return null
  }

  return {
    answers: answers.map((answer) => ({
      questionId: String(answer.questionId),
      selectedOptionId: String(answer.selectedOptionId),
      elapsedSec: Number(answer.elapsedSec)
    })),
    durationSec
  }
}

export const writeStoredSubmissionAttempt = (
  sessionId: string,
  value: unknown
): void => {
  const serialized = JSON.stringify(value)
  if (
    serialized === undefined ||
    !cachedSessionStorage.setItem(
      getSubmissionAttemptStorageKey(sessionId),
      serialized
    )
  ) {
    throw new Error(
      '제출 재시도 정보를 안전하게 저장하지 못해 답안을 전송하지 않았습니다.'
    )
  }

  memoryAttempts.set(sessionId, value)
}

export const clearSubmissionAttempt = (sessionId: string): void => {
  memoryAttempts.delete(sessionId)
  cachedSessionStorage.removeItem(getSubmissionAttemptStorageKey(sessionId))
}

export const clearAllSubmissionAttempts = (): void => {
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

export const clearSubmissionAttemptMemoryCache = (): void => {
  memoryAttempts.clear()
}
