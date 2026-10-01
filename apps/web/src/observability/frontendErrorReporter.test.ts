import { describe, expect, it, vi } from 'vitest'
import {
  createFrontendErrorReporter,
  installGlobalFrontendErrorReporting
} from '@/observability/frontendErrorReporter'

const releaseId = '1234567890abcdef1234567890abcdef12345678'

describe('frontend error reporter', () => {
  it('has zero transmission and persistence while provider-disabled', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const reporter = createFrontendErrorReporter({
      deploymentEnvironment: 'PRODUCTION',
      releaseId
    })

    expect(
      reporter.report({ source: 'ROUTE_RENDER', routeKey: 'routes.page' })
    ).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(storageSpy).not.toHaveBeenCalled()
  })

  it('sends only closed coarse fields and swallows transport failures', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('unavailable'))
    const reporter = createFrontendErrorReporter({
      deploymentEnvironment: 'STAGING',
      releaseId,
      transport: { send },
      now: () => new Date('2026-10-01T00:00:00.000Z')
    })

    expect(
      reporter.report({
        source: 'API_RESPONSE_VALIDATION',
        routeKey: 'routes.practiceSession',
        requestId: '00000000-0000-4000-8000-000000000001',
        statusClass: '4xx'
      })
    ).toBe(true)
    expect(
      reporter.report({ source: 'ROUTE_RENDER', routeKey: 'routes.page' })
    ).toBe(true)
    await Promise.resolve()

    expect(send.mock.calls[0]?.[0]).toEqual({
      schemaVersion: 1,
      occurredAt: '2026-10-01T00:00:00.000Z',
      deploymentEnvironment: 'STAGING',
      releaseId,
      source: 'API_RESPONSE_VALIDATION',
      routeKey: 'routes.practiceSession',
      requestId: '00000000-0000-4000-8000-000000000001',
      statusClass: '4xx'
    })
  })

  it('global handlers never inspect or transmit raw Error objects', () => {
    const report = vi.fn(() => false)
    const cleanup = installGlobalFrontendErrorReporting(
      { report },
      () => 'routes.home'
    )

    window.dispatchEvent(new ErrorEvent('error', { message: 'private text' }))
    window.dispatchEvent(new Event('unhandledrejection'))

    expect(report).toHaveBeenNthCalledWith(1, {
      source: 'WINDOW_ERROR',
      routeKey: 'routes.home'
    })
    expect(report).toHaveBeenNthCalledWith(2, {
      source: 'UNHANDLED_REJECTION',
      routeKey: 'routes.home'
    })
    cleanup()
  })
})
