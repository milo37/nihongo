import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import type { UserReportService } from '../report/userReportService.js'
import { createAdminUserReportRoutes } from './userReports.js'

const reportId = '00000000-0000-4000-8000-000000000001'
const detail = {
  reportId,
  kind: 'APP_ERROR',
  status: 'RECEIVED',
  location: '/study',
  questionId: null,
  questionVersionId: null,
  reporterMemberId: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  rowVersion: 2,
  description: '멈춤',
  reporterReply: null,
  repliedAt: null,
  internalNote: '메모',
  closedAt: null,
  updatedAt: '2026-11-01T00:00:00.000Z'
} as const

const createApp = (service: Partial<UserReportService>) => {
  const app = new Hono()
  app.use('*', async (context, next) => {
    const url = new URL(context.req.url)
    context.set(
      'rawRequestTarget' as never,
      `${url.pathname}${url.search}` as never
    )
    await next()
  })
  const pass = async (_context: unknown, next: () => Promise<void>) => {
    await next()
  }
  app.route(
    '/api/v1/admin',
    createAdminUserReportRoutes({
      commandGuard: pass,
      readGuard: pass,
      service: service as UserReportService
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

const post = (path: string, body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  path
})

describe('admin user report routes', () => {
  it('passes a parsed note command to the service', async () => {
    const saveNote = vi.fn(async () => detail)
    const request = post(`/api/v1/admin/reports/${reportId}/note`, {
      expectedRowVersion: 1,
      internalNote: '메모'
    })
    const response = await createApp({ saveNote }).request(
      request.path,
      request
    )
    expect(response.status).toBe(200)
    expect(saveNote).toHaveBeenCalledWith(reportId, {
      expectedRowVersion: 1,
      internalNote: '메모'
    })
  })

  it.each([
    post('/api/v1/admin/reports/not-a-uuid/close', { expectedRowVersion: 1 }),
    post(`/api/v1/admin/reports/${reportId}/close`, { expectedRowVersion: 0 }),
    post(`/api/v1/admin/reports/${reportId}/reply-and-close`, {
      expectedRowVersion: 1
    })
  ])('rejects $path with VALIDATION_ERROR', async (request) => {
    const close = vi.fn()
    const replyAndClose = vi.fn()
    const response = await createApp({ close, replyAndClose }).request(
      request.path,
      request
    )
    expect(await response.json()).toEqual({ code: 'VALIDATION_ERROR' })
    expect(close).not.toHaveBeenCalled()
    expect(replyAndClose).not.toHaveBeenCalled()
  })

  it('rejects unknown list filters', async () => {
    const response = await createApp({ listAdminReports: vi.fn() }).request(
      '/api/v1/admin/reports?status=OPEN'
    )
    expect(await response.json()).toEqual({ code: 'VALIDATION_ERROR' })
  })
})
