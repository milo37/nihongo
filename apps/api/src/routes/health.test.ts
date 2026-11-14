import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { createHealthRoutes } from './health.js'

const releaseId = '1234567890abcdef1234567890abcdef12345678'

const createApp = (checkReadiness: () => Promise<void>) => {
  let clock = 0
  const app = new Hono<{ Variables: ApiVariables }>()
  app.route(
    '/health',
    createHealthRoutes({ checkReadiness, releaseId, now: () => clock })
  )
  app.onError((error, context) =>
    context.json(
      { code: error instanceof ApplicationError ? error.code : 'OTHER' },
      503
    )
  )
  return {
    app,
    advance: (ms: number) => {
      clock += ms
    }
  }
}

describe('public readiness cache (#1008)', () => {
  it('checks the database once per five seconds while ready', async () => {
    const checkReadiness = vi.fn().mockResolvedValue(undefined)
    const { app, advance } = createApp(checkReadiness)

    const first = await app.request('/health/ready')
    await Promise.all(
      Array.from({ length: 20 }, () => app.request('/health/ready'))
    )
    advance(4_999)
    const cached = await app.request('/health/ready')

    expect(first.status).toBe(200)
    expect(first.headers.get('X-Release-Id')).toBe(releaseId)
    expect(cached.status).toBe(200)
    expect(checkReadiness).toHaveBeenCalledTimes(1)

    advance(1)
    await app.request('/health/ready')
    expect(checkReadiness).toHaveBeenCalledTimes(2)
  })

  it('shares one check between requests that arrive together', async () => {
    let finish = (): void => undefined
    const checkReadiness = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const { app } = createApp(checkReadiness)

    const requests = Array.from({ length: 5 }, () =>
      app.request('/health/ready')
    )
    await vi.waitFor(() => expect(checkReadiness).toHaveBeenCalledTimes(1))
    finish()
    const responses = await Promise.all(requests)

    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200, 200, 200
    ])
    expect(checkReadiness).toHaveBeenCalledTimes(1)
  })

  it('keeps a failure for two seconds, then checks again', async () => {
    const checkReadiness = vi
      .fn()
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValue(undefined)
    const { app, advance } = createApp(checkReadiness)

    const failed = await app.request('/health/ready')
    advance(1_999)
    const stillFailed = await app.request('/health/ready')
    advance(1)
    const recovered = await app.request('/health/ready')

    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({ code: 'SERVICE_UNAVAILABLE' })
    expect(stillFailed.status).toBe(503)
    expect(recovered.status).toBe(200)
    expect(checkReadiness).toHaveBeenCalledTimes(2)
  })

  it('never touches the database for liveness', async () => {
    const checkReadiness = vi.fn().mockResolvedValue(undefined)
    const { app } = createApp(checkReadiness)

    expect((await app.request('/health/live')).status).toBe(200)
    expect(checkReadiness).not.toHaveBeenCalled()
  })
})
