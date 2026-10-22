import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAllResultRetryAttempts,
  clearResultRetryAttemptMemoryCache,
  getOrCreateResultRetryAttempt,
  getResultRetryAttemptStorageKey,
  readResultRetryAttempt
} from '@app/practice/resultRetryAttemptStorage'

const principalScope = `USER:${crypto.randomUUID()}`
const sourceSessionId = crypto.randomUUID()

describe('result retry attempt storage', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    clearResultRetryAttemptMemoryCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearAllResultRetryAttempts()
  })

  it('같은 principal/source에는 exact key를 재사용하고 reload 뒤 복원한다', () => {
    const first = getOrCreateResultRetryAttempt(principalScope, sourceSessionId)
    clearResultRetryAttemptMemoryCache()

    expect(readResultRetryAttempt(principalScope, sourceSessionId)).toEqual(
      first
    )
    expect(
      getOrCreateResultRetryAttempt(principalScope, sourceSessionId)
    ).toEqual(first)
  })

  it('scope가 변조된 record는 fail closed 삭제한다', () => {
    const key = getResultRetryAttemptStorageKey(principalScope, sourceSessionId)
    window.sessionStorage.setItem(
      key,
      JSON.stringify({
        contractVersion: 2,
        idempotencyKey: crypto.randomUUID(),
        principalScope: `USER:${crypto.randomUUID()}`,
        sourceSessionId
      })
    )

    expect(readResultRetryAttempt(principalScope, sourceSessionId)).toBeNull()
    expect(window.sessionStorage.getItem(key)).toBeNull()
  })

  it('durable write가 실패하면 key를 memory에만 남기지 않고 요청을 막는다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    expect(() =>
      getOrCreateResultRetryAttempt(principalScope, sourceSessionId)
    ).toThrow('요청을 전송하지 않았습니다')
    expect(readResultRetryAttempt(principalScope, sourceSessionId)).toBeNull()
  })
})
