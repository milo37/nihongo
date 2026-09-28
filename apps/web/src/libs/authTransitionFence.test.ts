import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { safeFactory } from '@api/config'
import {
  advanceAuthTransitionEpoch,
  assertCurrentAuthActorTransitionFence,
  AuthTransitionSupersededError,
  captureAuthActorTransitionFence
} from '@libs/authTransitionFence'
import { emitApiError, subscribeApiError } from '@libs/errorBus'
import { queryClient } from '@libs/queryClient'

describe('auth transition response fence', () => {
  it('rejects a same-epoch actor or role replacement', () => {
    const fence = captureAuthActorTransitionFence({
      id: 'admin-a',
      role: 'ADMIN'
    })

    expect(() =>
      assertCurrentAuthActorTransitionFence(fence, {
        id: 'admin-b',
        role: 'ADMIN'
      })
    ).toThrow(AuthTransitionSupersededError)
    expect(() =>
      assertCurrentAuthActorTransitionFence(fence, {
        id: 'admin-a',
        role: 'USER'
      })
    ).toThrow(AuthTransitionSupersededError)
  })

  it('rejects a successful raw response that belongs to an older auth epoch', async () => {
    let releaseResponse: ((value: unknown) => void) | undefined
    const rawResponse = new Promise<unknown>((resolve) => {
      releaseResponse = resolve
    })
    const request = safeFactory(() => rawResponse)(
      z.object({ value: z.string() })
    )()

    advanceAuthTransitionEpoch()
    releaseResponse?.({ value: 'stale' })

    await expect(request).rejects.toBeInstanceOf(AuthTransitionSupersededError)
  })

  it('keeps superseded responses silent and non-retryable', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeApiError(listener)
    const error = new AuthTransitionSupersededError()
    const retry = queryClient.getDefaultOptions().queries?.retry

    emitApiError(error)

    expect(listener).not.toHaveBeenCalled()
    expect(typeof retry).toBe('function')
    if (typeof retry === 'function') {
      expect(retry(0, error)).toBe(false)
    }
    unsubscribe()
  })
})
