import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import {
  adminAccessPath,
  createPrismaAdminAccessRecorder,
  type AdminAccessRecorder
} from './adminAccessLog.js'
import { createAdminReadGuard } from './adminReadGuard.js'

const actorId = '00000000-0000-4000-8000-0000000000aa'
const memberId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-0000000000bb'

const createApp = ({
  recordAccess,
  role = 'ADMIN'
}: {
  recordAccess: AdminAccessRecorder
  role?: string
}) => {
  const principalService = {
    resolveAuthenticatedUser: vi.fn(async () => ({
      user: { id: actorId, role },
      headers: new Headers(),
      clearSessionCookie: false,
      ownedSessionProof: { isFresh: true }
    }))
  } as unknown as PrincipalService
  const handler = vi.fn((context: { text: (body: string) => Response }) =>
    context.text('ok')
  )
  const app = new Hono<{ Variables: ApiVariables }>()
  app.use('*', async (context, next) => {
    context.set('requestId', requestId)
    await next()
  })
  app.use(
    '*',
    createAdminReadGuard({
      assertCapability: () => undefined,
      environment: {
        AUTH_TRUSTED_PROXY_CIDRS: [],
        NODE_ENV: 'test'
      } as unknown as ApiEnvironment,
      principalService,
      rateLimiter: { consume: vi.fn(async () => undefined) },
      recordAccess
    })
  )
  app.get('*', handler)
  app.onError((error, context) =>
    context.json(
      { code: error instanceof ApplicationError ? error.code : 'UNKNOWN' },
      error instanceof ApplicationError && error.code === 'ADMIN_REQUIRED'
        ? 403
        : 503
    )
  )
  return { app, handler }
}

describe('administrator access record (JLP-842)', () => {
  it('records the actor, method and path without the query before the handler', async () => {
    const order: string[] = []
    const recordAccess = vi.fn(async () => {
      order.push('record')
    })
    const { app, handler } = createApp({ recordAccess })
    handler.mockImplementation((context) => {
      order.push('handler')
      return context.text('ok')
    })
    const response = await app.request(
      `/api/v1/admin/members/${memberId}?email=someone@example.com`
    )
    expect(response.status).toBe(200)
    expect(order).toEqual(['record', 'handler'])
    expect(recordAccess).toHaveBeenCalledWith({
      actorId,
      clientIp: 'unresolved',
      method: 'GET',
      path: `/api/v1/admin/members/${memberId}`,
      requestId
    })
  })

  it('refuses the request when the record cannot be written', async () => {
    const { app, handler } = createApp({
      recordAccess: vi.fn(async () => {
        throw new Error('database unavailable')
      })
    })
    const response = await app.request('/api/v1/admin/members')
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      code: 'SERVICE_UNAVAILABLE'
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('records nothing for a non-administrator or an admin static asset', async () => {
    const recordAccess = vi.fn(async () => undefined)
    const refused = createApp({ recordAccess, role: 'USER' })
    expect((await refused.app.request('/api/v1/admin/members')).status).toBe(
      403
    )
    const asset = createApp({ recordAccess })
    expect((await asset.app.request('/admin/assets/index.js')).status).toBe(200)
    expect(recordAccess).not.toHaveBeenCalled()
  })

  it('stores printable paths of at most 512 characters', () => {
    expect(adminAccessPath('/admin/회원')).toBe('/admin/%ED%9A%8C%EC%9B%90')
    expect(adminAccessPath(`/${'a'.repeat(600)}`)).toHaveLength(512)
  })

  it('inserts one row and stores an unexpected address as unresolved', async () => {
    const executeRaw = vi.fn(async () => 1)
    await createPrismaAdminAccessRecorder({
      $executeRaw: executeRaw
    } as never)({
      actorId,
      clientIp: 'not an address',
      method: 'GET',
      path: '/api/v1/admin/members',
      requestId
    })
    expect(executeRaw).toHaveBeenCalledOnce()
    const [query] = executeRaw.mock.calls[0] as unknown as [
      { sql: string; values: unknown[] }
    ]
    expect(query.sql).toContain('INSERT INTO "AdminAccessLog"')
    expect(query.values).toEqual([
      actorId,
      'unresolved',
      'GET',
      '/api/v1/admin/members',
      requestId
    ])
  })
})
