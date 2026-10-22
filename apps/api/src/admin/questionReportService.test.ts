import { describe, expect, it, vi } from 'vitest'
import type { CreateQuestionReportRequest } from '@nihongo/contracts/admin/phase7'
import type { QuestionReportRateLimiter } from './questionReportRateLimiter.js'
import {
  QuestionReportRepositoryError,
  type QuestionReportCreateAuthority,
  type QuestionReportRepository
} from './questionReportRepository.js'
import { createQuestionReportService } from './questionReportService.js'

const ids = {
  reporter: '019d0000-0000-7000-8000-000000000001',
  question: '019d0000-0000-7000-8000-000000000002',
  version: '019d0000-0000-7000-8000-000000000003',
  report: '019d0000-0000-7000-8000-000000000004'
} as const

const authority: QuestionReportCreateAuthority = {
  actorId: ids.reporter,
  rawSessionToken: 'phase7-report-session'
}

const request: CreateQuestionReportRequest = {
  questionVersionId: ids.version,
  reason: 'OTHER',
  description: '설명을 확인해 주세요.'
}

const mutation = {
  id: ids.report,
  questionId: ids.question,
  questionVersionId: ids.version,
  status: 'OPEN',
  rowVersion: 1,
  assignee: null,
  resolution: null,
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z'
} as const

const createFixture = ({
  firstTarget = { questionId: ids.question },
  duplicateState = {
    questionId: ids.question,
    hasOpenDuplicate: false
  }
}: {
  readonly firstTarget?: { readonly questionId: string } | null
  readonly duplicateState?: {
    readonly questionId: string
    readonly hasOpenDuplicate: boolean
  } | null
} = {}) => {
  const events: string[] = []
  const repository: QuestionReportRepository = {
    findEntitledTarget: vi.fn(async () => {
      events.push('entitlement')
      return firstTarget
    }),
    findEntitledDuplicateState: vi.fn(async () => {
      events.push('entitlement-duplicate')
      return duplicateState
    }),
    create: vi.fn(async () => {
      events.push('create')
      return mutation
    }),
    list: vi.fn(async (query) => ({
      items: [],
      page: query.page,
      pageSize: query.pageSize,
      total: 0
    })),
    get: vi.fn(async () => null)
  }
  const rateLimiter: QuestionReportRateLimiter = {
    consume: vi.fn(async () => {
      events.push('version-rate')
    })
  }
  return {
    events,
    rateLimiter,
    repository,
    service: createQuestionReportService({ rateLimiter, repository })
  }
}

describe('Phase 7 question report service', () => {
  it('orders entitlement, REPORT_VERSION, entitlement-aware duplicate probe and create', async () => {
    const fixture = createFixture()

    await expect(
      fixture.service.createReport(authority, request)
    ).resolves.toEqual(mutation)
    expect(fixture.events).toEqual([
      'entitlement',
      'version-rate',
      'entitlement-duplicate',
      'create'
    ])
    expect(fixture.rateLimiter.consume).toHaveBeenCalledWith({
      group: 'REPORT_VERSION',
      value: ids.version
    })
    expect(fixture.repository.create).toHaveBeenCalledWith(
      authority,
      ids.question,
      request
    )
  })

  it('returns the same 404 before and after REPORT_VERSION when entitlement is absent', async () => {
    const before = createFixture({ firstTarget: null })
    await expect(
      before.service.createReport(authority, request)
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      phase7Disposition: 'NO_TX'
    })
    expect(before.events).toEqual(['entitlement'])

    const after = createFixture({ duplicateState: null })
    await expect(
      after.service.createReport(authority, request)
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      phase7Disposition: 'NO_TX'
    })
    expect(after.events).toEqual([
      'entitlement',
      'version-rate',
      'entitlement-duplicate'
    ])
    expect(after.repository.create).not.toHaveBeenCalled()
  })

  it('reveals an open duplicate only while the target remains entitled', async () => {
    const fixture = createFixture({
      duplicateState: {
        questionId: ids.question,
        hasOpenDuplicate: true
      }
    })

    await expect(
      fixture.service.createReport(authority, request)
    ).rejects.toMatchObject({
      code: 'QUESTION_REPORT_DUPLICATE',
      phase7Disposition: 'NO_TX'
    })
    expect(fixture.events).toEqual([
      'entitlement',
      'version-rate',
      'entitlement-duplicate'
    ])
    expect(fixture.repository.create).not.toHaveBeenCalled()
  })

  it('preserves the transaction disposition for a duplicate race at insert', async () => {
    const fixture = createFixture()
    vi.mocked(fixture.repository.create).mockRejectedValueOnce(
      new QuestionReportRepositoryError({
        code: 'QUESTION_REPORT_DUPLICATE',
        message: '동일 신고가 동시에 생성됐습니다.',
        disposition: 'DEFINITE_ROLLBACK'
      })
    )

    await expect(
      fixture.service.createReport(authority, request)
    ).rejects.toMatchObject({
      code: 'QUESTION_REPORT_DUPLICATE',
      retryable: false,
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })
  })
})
