import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsEventInput } from '@nihongo/contracts/analytics/events'
import { createAnalyticsClient } from '@/analytics/client'

const releaseId = '1234567890abcdef1234567890abcdef12345678'

describe('analytics client', () => {
  it('keeps transmission, queue, and persistence off without a provider', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const client = createAnalyticsClient({
      environment: 'PRODUCTION',
      releaseId
    })

    expect(client.track({ event: 'login', payload: {} })).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(storageSpy).not.toHaveBeenCalled()
  })

  it('sends only parsed closed-schema events and swallows provider failure', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('provider unavailable'))
    const client = createAnalyticsClient({
      environment: 'STAGING',
      releaseId,
      transport: { send },
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      createCorrelationId: () => '00000000-0000-4000-8000-000000000001'
    })

    expect(client.track({ event: 'login', payload: {} })).toBe(true)
    expect(client.track({ event: 'sign_up', payload: {} })).toBe(true)
    await Promise.resolve()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0]?.[0]).toEqual({
      schemaVersion: 1,
      occurredAt: '2026-10-01T00:00:00.000Z',
      environment: 'STAGING',
      releaseId,
      correlationId: '00000000-0000-4000-8000-000000000001',
      event: 'login',
      payload: {}
    })
  })

  it('rejects runtime input containing prohibited fields before transport', () => {
    const send = vi.fn()
    const client = createAnalyticsClient({
      environment: 'TEST',
      releaseId,
      transport: { send }
    })
    const unsafe = {
      event: 'question_answered',
      payload: { ordinal: 1, answer: 'private answer' }
    } as unknown as AnalyticsEventInput

    expect(client.track(unsafe)).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})
