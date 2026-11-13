import { createFrontendErrorReporter } from '@nihongo/browser/observability/frontendErrorReporter'
import { createApiFrontendErrorTransport } from '@nihongo/browser/observability/frontendErrorTransport'

const releaseId = '0123456789abcdef0123456789abcdef01234567'

const setup = () => {
  let clock = 0
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null))
  const reporter = createFrontendErrorReporter({
    deploymentEnvironment: 'LOCAL',
    releaseId,
    now: () => new Date('2026-11-13T12:00:00.000Z'),
    transport: createApiFrontendErrorTransport({
      baseUrl: '/api',
      fetchImpl,
      now: () => clock
    })
  })
  return {
    fetchImpl,
    reporter,
    advance: (ms: number) => {
      clock += ms
    }
  }
}

describe('createApiFrontendErrorTransport', () => {
  it('posts the checked event to our API without the shared API client', () => {
    const { fetchImpl, reporter } = setup()

    expect(
      reporter.report({
        source: 'WINDOW_ERROR',
        routeKey: 'routes.practiceSession'
      })
    ).toBe(true)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('/api/v1/client-errors')
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' }
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      schemaVersion: 1,
      occurredAt: '2026-11-13T12:00:00.000Z',
      deploymentEnvironment: 'LOCAL',
      releaseId,
      source: 'WINDOW_ERROR',
      routeKey: 'routes.practiceSession'
    })
  })

  it('sends the same source on the same route once a minute', () => {
    const { advance, fetchImpl, reporter } = setup()
    const input = {
      source: 'UNHANDLED_REJECTION',
      routeKey: 'routes.practiceSession'
    } as const

    reporter.report(input)
    advance(59_999)
    reporter.report(input)
    reporter.report({ ...input, routeKey: 'routes.home' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    advance(1)
    reporter.report(input)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('stops after ten reports on one page', () => {
    const { advance, fetchImpl, reporter } = setup()

    for (let index = 0; index < 15; index += 1) {
      reporter.report({
        source: 'WINDOW_ERROR',
        routeKey: 'routes.practiceSession'
      })
      advance(60_000)
    }

    expect(fetchImpl).toHaveBeenCalledTimes(10)
  })

  it('drops a failed delivery quietly', async () => {
    const { fetchImpl, reporter } = setup()
    fetchImpl.mockRejectedValueOnce(new TypeError('offline'))

    expect(
      reporter.report({
        source: 'ROUTE_RENDER',
        routeKey: 'routes.practiceSession'
      })
    ).toBe(true)
    await Promise.resolve()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
