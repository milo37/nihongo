import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAllTargetedReviewAttempts,
  clearTargetedReviewAttemptMemoryCache,
  getOrCreateTargetedReviewAttempt,
  getTargetedReviewAttemptStorageKey,
  readTargetedReviewAttempt
} from '@app/wrong-note/targetedReviewAttemptStorage'

const principalScope = `USER:${crypto.randomUUID()}`
const questionId = crypto.randomUUID()

describe('targeted review attempt storage', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    clearTargetedReviewAttemptMemoryCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearAllTargetedReviewAttempts()
  })

  it('reuses the exact key for one principal/question and restores it after reload', () => {
    const first = getOrCreateTargetedReviewAttempt(principalScope, questionId)
    clearTargetedReviewAttemptMemoryCache()

    expect(readTargetedReviewAttempt(principalScope, questionId)).toEqual(first)
    expect(
      getOrCreateTargetedReviewAttempt(principalScope, questionId)
    ).toEqual(first)
    expect(
      getOrCreateTargetedReviewAttempt(
        `ADMIN:${crypto.randomUUID()}`,
        questionId
      ).idempotencyKey
    ).not.toBe(first.idempotencyKey)
  })

  it('deletes a persisted record whose principal scope was tampered', () => {
    const storageKey = getTargetedReviewAttemptStorageKey(
      principalScope,
      questionId
    )
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        contractVersion: 2,
        idempotencyKey: crypto.randomUUID(),
        principalScope: `USER:${crypto.randomUUID()}`,
        questionId
      })
    )

    expect(readTargetedReviewAttempt(principalScope, questionId)).toBeNull()
    expect(window.sessionStorage.getItem(storageKey)).toBeNull()
  })

  it('blocks transport when durable storage fails without retaining a memory-only key', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    expect(() =>
      getOrCreateTargetedReviewAttempt(principalScope, questionId)
    ).toThrow('요청을 전송하지 않았습니다')
    expect(readTargetedReviewAttempt(principalScope, questionId)).toBeNull()
  })
})
