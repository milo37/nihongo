import { describe, expect, it } from 'vitest'
import {
  isCanonicalAdminConsoleCommandRequest,
  isCanonicalAdminConsoleReadRequest
} from '../app/protectedRouteExclusion.js'
import type {
  UserReportCommandOutcome,
  UserReportRecord,
  UserReportRepository
} from './userReportRepository.js'
import {
  createUserReportService,
  toDescriptionPreview
} from './userReportService.js'

const reportId = '00000000-0000-4000-8000-000000000001'
const record: UserReportRecord = {
  id: reportId,
  kind: 'APP_ERROR',
  status: 'RECEIVED',
  location: '/study',
  questionId: null,
  questionVersionId: null,
  description: '멈춤',
  reporterUserId: null,
  reporterReply: null,
  repliedAt: null,
  internalNote: '내부 메모',
  closedAt: null,
  rowVersion: 1,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z')
}

const serviceWith = (outcome: UserReportCommandOutcome) =>
  createUserReportService({
    applyCommand: async () => outcome,
    listByReporter: async () => ({ items: [record], total: 1 })
  } as unknown as UserReportRepository)

describe('toDescriptionPreview', () => {
  it('folds whitespace into one line and keeps at most 160 scalars', () => {
    expect(toDescriptionPreview('  첫 줄\n\n둘째 줄\t끝  ')).toBe(
      '첫 줄 둘째 줄 끝'
    )
    expect([...toDescriptionPreview('😀'.repeat(200))]).toHaveLength(160)
  })
})

describe('createUserReportService', () => {
  it.each([
    [{ kind: 'NOT_FOUND' } as const, 'RESOURCE_NOT_FOUND'],
    [{ kind: 'VERSION_CONFLICT' } as const, 'VERSION_CONFLICT'],
    [{ kind: 'CLOSED' } as const, 'INVALID_STATE_TRANSITION']
  ])('maps %o to %s', async (outcome, code) => {
    await expect(
      serviceWith(outcome).close(reportId, { expectedRowVersion: 1 })
    ).rejects.toMatchObject({ code })
  })

  it('never shows the internal note to the reporter', async () => {
    const page = await serviceWith({ kind: 'NOT_FOUND' }).listMyReports(
      'reporter',
      { page: 1, pageSize: 20 }
    )
    expect(JSON.stringify(page)).not.toContain('내부 메모')
  })
})

describe('operations console paths', () => {
  it('allows only the canonical report and import-result routes', () => {
    const read = (requestTarget: string) =>
      isCanonicalAdminConsoleReadRequest({ method: 'GET', requestTarget })
    const command = (requestTarget: string) =>
      isCanonicalAdminConsoleCommandRequest({ method: 'POST', requestTarget })
    expect(read('/api/v1/admin/reports?status=RECEIVED')).toBe(true)
    expect(read(`/api/v1/admin/reports/${reportId}`)).toBe(true)
    expect(read(`/api/v1/admin/question-imports/${reportId}`)).toBe(true)
    expect(read('/api/v1/admin/reports/not-a-uuid')).toBe(false)
    expect(command(`/api/v1/admin/reports/${reportId}/reply-and-close`)).toBe(
      true
    )
    expect(command(`/api/v1/admin/reports/${reportId}/note`)).toBe(true)
    expect(command(`/api/v1/admin/reports/${reportId}/close`)).toBe(true)
    expect(command(`/api/v1/admin/reports/${reportId}/delete`)).toBe(false)
  })
})
