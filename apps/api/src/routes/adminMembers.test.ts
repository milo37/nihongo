import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AdminMemberService } from '../admin/adminMemberService.js'
import { ApplicationError } from '../errors/applicationError.js'
import { createAdminMemberRoutes } from './adminMembers.js'

const memberId = '00000000-0000-4000-8000-000000000001'
const actorId = '00000000-0000-4000-8000-0000000000aa'
const detail = {
  memberId,
  maskedEmail: 'mi****@e******.com',
  joinedAt: '2026-11-01T00:00:00.000Z',
  lastStudiedAt: null,
  solvedCount: 0,
  reportCount: 0,
  status: 'RESTRICTED',
  rowVersion: 2,
  restrictedAt: '2026-11-04T00:00:00.000Z',
  restrictionReason: '반복된 부적절 제보'
} as const

const createApp = (
  service: Partial<AdminMemberService>,
  { fresh = true }: { fresh?: boolean } = {}
) => {
  const app = new Hono()
  app.use('*', async (context, next) => {
    const url = new URL(context.req.url)
    context.set(
      'rawRequestTarget' as never,
      `${url.pathname}${url.search}` as never
    )
    context.set('adminActorId' as never, actorId as never)
    context.set('adminSessionFresh' as never, fresh as never)
    await next()
  })
  const pass = async (_context: unknown, next: () => Promise<void>) => {
    await next()
  }
  app.route(
    '/api/v1/admin',
    createAdminMemberRoutes({
      commandGuard: pass,
      readGuard: pass,
      service: service as AdminMemberService
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

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})

describe('admin member routes', () => {
  it('passes the actor and parsed list query to the service', async () => {
    const listMembers = vi.fn(async () => ({
      items: [],
      page: 2,
      pageSize: 50 as const,
      total: 0
    }))
    const response = await createApp({ listMembers }).request(
      '/api/v1/admin/members?sort=status&order=asc&page=2&pageSize=50'
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(listMembers).toHaveBeenCalledWith(actorId, {
      sort: 'status',
      order: 'asc',
      page: 2,
      pageSize: 50
    })
  })

  it('rejects unknown list query keys and malformed member ids', async () => {
    const app = createApp({ listMembers: vi.fn(), getMember: vi.fn() })
    for (const path of [
      '/api/v1/admin/members?rawEmail=1',
      '/api/v1/admin/members/not-a-uuid'
    ]) {
      const response = await app.request(path)
      await expect(response.json()).resolves.toEqual({
        code: 'VALIDATION_ERROR'
      })
    }
  })

  it('restricts with the expected row version and reason', async () => {
    const restrict = vi.fn(async () => detail)
    const response = await createApp({ restrict }).request(
      `/api/v1/admin/members/${memberId}/restriction`,
      post({ expectedRowVersion: 1, reason: '반복된 부적절 제보' })
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(detail)
    expect(restrict).toHaveBeenCalledWith({
      actorId,
      memberId,
      expectedRowVersion: 1,
      reason: '반복된 부적절 제보'
    })
  })

  it('releases with the expected row version only', async () => {
    const releaseRestriction = vi.fn(async () => ({
      ...detail,
      status: 'ACTIVE' as const,
      rowVersion: 3,
      restrictedAt: null,
      restrictionReason: null
    }))
    const app = createApp({ releaseRestriction })
    const rejected = await app.request(
      `/api/v1/admin/members/${memberId}/restriction-release`,
      post({ expectedRowVersion: 2, reason: '추가 필드' })
    )
    await expect(rejected.json()).resolves.toEqual({ code: 'VALIDATION_ERROR' })
    const response = await app.request(
      `/api/v1/admin/members/${memberId}/restriction-release`,
      post({ expectedRowVersion: 2 })
    )
    expect(response.status).toBe(200)
    expect(releaseRestriction).toHaveBeenCalledWith({
      actorId,
      memberId,
      expectedRowVersion: 2
    })
  })

  it('requires a fresh admin sign-in before any restriction command', async () => {
    const restrict = vi.fn()
    const releaseRestriction = vi.fn()
    const app = createApp({ restrict, releaseRestriction }, { fresh: false })
    for (const [path, body] of [
      ['restriction', { expectedRowVersion: 1, reason: '사유' }],
      ['restriction-release', { expectedRowVersion: 2 }]
    ] as const) {
      const response = await app.request(
        `/api/v1/admin/members/${memberId}/${path}`,
        post(body)
      )
      await expect(response.json()).resolves.toEqual({
        code: 'FRESH_ASSURANCE_REQUIRED'
      })
    }
    expect(restrict).not.toHaveBeenCalled()
    expect(releaseRestriction).not.toHaveBeenCalled()
  })
})
