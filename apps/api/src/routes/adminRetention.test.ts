import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AdminRetentionReader } from '../admin/adminRetention.js'
import { ApplicationError } from '../errors/applicationError.js'
import { createAdminRetentionRoutes } from './adminRetention.js'

const createApp = (reader: AdminRetentionReader) => {
  const app = new Hono()
  app.use('*', async (context, next) => {
    const url = new URL(context.req.url)
    context.set(
      'rawRequestTarget' as never,
      `${url.pathname}${url.search}` as never
    )
    await next()
  })
  app.route(
    '/api/v1/admin',
    createAdminRetentionRoutes({
      now: () => new Date('2026-11-24T00:00:00.000Z'),
      readGuard: async (_context, next) => {
        await next()
      },
      reader
    }) as never
  )
  app.onError((error, context) =>
    context.json(
      { code: error instanceof ApplicationError ? error.code : 'UNKNOWN' },
      400
    )
  )
  return app
}

describe('admin retention route', () => {
  it('returns the rows without caching', async () => {
    const read = vi.fn(async () => ({ rows: [] }))
    const response = await createApp({ read }).request(
      '/api/v1/admin/retention'
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ rows: [] })
    expect(read).toHaveBeenCalledWith(new Date('2026-11-24T00:00:00.000Z'))
  })

  it('refuses any query parameter', async () => {
    const read = vi.fn(async () => ({ rows: [] }))
    const response = await createApp({ read }).request(
      '/api/v1/admin/retention?weeks=52'
    )
    expect(response.status).toBe(400)
    expect(read).not.toHaveBeenCalled()
  })
})
