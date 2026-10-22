import { createHash } from 'node:crypto'
import {
  adminImportValidationResponseSchema,
  canonicalizeJson,
  createAdminImportMappingDigest,
  createAdminImportValidationDigest,
  createAdminQuestionExportResponseBodyDigest,
  createAdminQuestionExportSelectionDigest,
  createQuestionReportDescriptionDigest,
  phase7Slice5OperationManifest,
  type AdminImportItem,
  type CanonicalJsonValue,
  type QuestionReportMutationResult,
  type Sha256TextPort
} from '@nihongo/contracts/admin/phase7'
import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { describe, expect, it, vi } from 'vitest'
import { getPhase7OperationBodyCap } from '../admin/adminCommandGuard.js'
import type { AdminCommandRateLimiter } from '../admin/adminCommandRateLimiter.js'
import { createPrismaAdminQuestionSlice5Repository } from '../admin/adminQuestionSlice5Repository.js'
import type {
  AdminQuestionCommandService,
  AdminQuestionPublicationCommandService,
  AdminQuestionSlice5CommandService
} from '../admin/adminQuestionCommandService.js'
import type { QuestionReportRateLimiter } from '../admin/questionReportRateLimiter.js'
import type { QuestionReportService } from '../admin/questionReportService.js'
import type { AdminQuestionReader } from '../admin/adminQuestionService.js'
import type { AdminReadRateLimiter } from '../admin/adminReadRateLimiter.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment, type ApiEnvironment } from '../config/env.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import { createApiApp } from './createApp.js'

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  ADMIN_CMS_MODE: 'technical',
  DATABASE_URL:
    'postgresql://nihongo_test_app_login:password@127.0.0.1:55432/nihongo_test?schema=public',
  AUTH_GATEWAY_DATABASE_URL:
    'postgresql://nihongo_test_auth_gateway_login:password@127.0.0.1:55432/nihongo_test?schema=public',
  TRUSTED_ORIGINS: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  GUEST_COOKIE_SECRET: 'b'.repeat(32),
  AUTH_EMAIL_FROM: 'auth@example.com'
})

const ids = {
  admin: '019d0000-0000-7000-8000-000000000001',
  user: '019d0000-0000-7000-8000-000000000002',
  question: '019d0000-0000-7000-8000-000000000003',
  version: '019d0000-0000-7000-8000-000000000004',
  report: '019d0000-0000-7000-8000-000000000005',
  request: '019d0000-0000-7000-8000-000000000006',
  session: '019d0000-0000-7000-8000-000000000007',
  tag: '019d0000-0000-7000-8000-000000000008',
  option1: '019d0000-0000-7000-8000-000000000011',
  option2: '019d0000-0000-7000-8000-000000000012',
  option3: '019d0000-0000-7000-8000-000000000013',
  option4: '019d0000-0000-7000-8000-000000000014'
} as const

const occurredAt = '2026-09-28T00:00:00.000Z'
const sha256Port: Sha256TextPort = {
  digestUtf8: async (value) =>
    createHash('sha256').update(value, 'utf8').digest('hex')
}

const adminUser = {
  id: ids.admin,
  name: '관리자',
  role: 'ADMIN',
  targetLevel: null
} as const
const regularUser = {
  id: ids.user,
  name: '학습자',
  role: 'USER',
  targetLevel: 'N5'
} as const
const adminActor = {
  kind: 'ACCOUNT',
  actorId: ids.admin,
  role: 'ADMIN',
  label: 'ACTIVE_ADMIN'
} as const
const userActor = {
  kind: 'ACCOUNT',
  actorId: ids.user,
  role: 'USER',
  label: 'ACTIVE_USER'
} as const

const importItem: AdminImportItem = {
  clientItemId: 'item-1',
  content: {
    level: 'N5',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    difficulty: 'NORMAL',
    passage: null,
    questionText: '빈칸에 알맞은 표현을 고르세요.',
    explanationKo: '문법 설명입니다.',
    explanationJa: null,
    tagNames: ['문법'],
    options: [
      { clientOptionKey: 'a', text: 'です' },
      { clientOptionKey: 'b', text: 'ます' },
      { clientOptionKey: 'c', text: 'でした' },
      { clientOptionKey: 'd', text: 'ません' }
    ],
    correctOptionKey: 'a'
  }
}

const mutation = (
  status: QuestionReportMutationResult['status'],
  rowVersion: number
): QuestionReportMutationResult => ({
  id: ids.report,
  questionId: ids.question,
  questionVersionId: ids.version,
  status,
  rowVersion,
  assignee: status === 'OPEN' ? null : adminActor,
  resolution:
    status === 'RESOLVED'
      ? {
          outcome: 'RESOLVED',
          reason: '설명을 바로잡았습니다.',
          remediationVersionId: null,
          resolvedAt: occurredAt
        }
      : null,
  createdAt: occurredAt,
  updatedAt: occurredAt
})

const questionReader: QuestionReader = {
  getQuestion: async () => Promise.reject(new Error('not used')),
  listQuestions: async () => ({ items: [], page: 1, pageSize: 20, total: 0 })
}

const reader: AdminQuestionReader = {
  listQuestions: async (query) => ({
    items: [],
    page: query.page,
    pageSize: query.pageSize,
    total: 0
  }),
  getQuestion: async () => Promise.reject(new Error('not used')),
  listVersions: async () => Promise.reject(new Error('not used')),
  previewVersion: async () => Promise.reject(new Error('not used')),
  diffVersion: async () => Promise.reject(new Error('not used')),
  listTags: async () => Promise.reject(new Error('not used')),
  listReviews: async () => Promise.reject(new Error('not used')),
  listAuditLog: async () => Promise.reject(new Error('not used'))
}

const guestPrincipalService: GuestPrincipalService = {
  clear: vi.fn(),
  create: vi.fn(),
  deleteExpired: vi.fn(),
  inspectCookie: vi.fn(() => ({ kind: 'ABSENT' }) as const),
  prepareCredential: vi.fn(),
  resolveExisting: vi.fn()
}

const unusedCommand = vi.fn(async () => Promise.reject(new Error('not used')))

type BatchRequest = Parameters<
  AdminQuestionSlice5CommandService['requestReviewBatch']
>[1]
type ValidationRequest = Parameters<
  AdminQuestionSlice5CommandService['validateImport']
>[0]
type ApplyRequest = Parameters<
  AdminQuestionSlice5CommandService['applyImport']
>[1]
type ExportRequest = Parameters<
  AdminQuestionSlice5CommandService['exportQuestions']
>[1]

const createFixture = ({
  appEnvironment = environment,
  isFresh = true
}: {
  readonly appEnvironment?: ApiEnvironment
  readonly isFresh?: boolean
} = {}) => {
  const baseCommandService: AdminQuestionCommandService &
    AdminQuestionPublicationCommandService = {
    createQuestion: unusedCommand,
    createVersion: unusedCommand,
    updateVersion: unusedCommand,
    requestReview: unusedCommand,
    requestChanges: unusedCommand,
    approveVersion: unusedCommand,
    withdrawApproval: unusedCommand,
    publishVersion: unusedCommand,
    retireVersion: unusedCommand,
    archiveQuestion: unusedCommand
  }

  const slice5Service: AdminQuestionSlice5CommandService = {
    requestReviewBatch: vi.fn(async (_authority, request: BatchRequest) => ({
      items: request.items.map((item) => ({
        questionId: ids.question,
        questionVersionId: item.versionId,
        lifecycleStatus: 'ACTIVE' as const,
        versionStatus: 'IN_REVIEW' as const,
        questionRowVersion: 1,
        versionRowVersion: item.expectedRowVersion + 1,
        occurredAt
      }))
    })),
    validateImport: vi.fn(async (request: ValidationRequest) => ({
      valid: true,
      validationDigest: await createAdminImportValidationDigest(
        sha256Port,
        request.items
      ),
      itemCount: request.items.length,
      errors: []
    })),
    applyImport: vi.fn(async (_authority, request: ApplyRequest) => {
      const response = {
        createdCount: request.items.length,
        items: request.items.map((item) => ({
          clientItemId: item.clientItemId,
          questionId: ids.question,
          questionVersionId: ids.version,
          lifecycleStatus: 'ACTIVE' as const,
          versionStatus: 'DRAFT' as const,
          questionRowVersion: 1 as const,
          versionRowVersion: 1 as const
        })),
        occurredAt
      }
      return {
        response,
        mappingDigest: await createAdminImportMappingDigest(
          sha256Port,
          response.items
        )
      }
    }),
    exportQuestions: vi.fn(async (_authority, request: ExportRequest) => {
      const document = {
        schemaVersion: 'admin-question-export-v1' as const,
        exportedAt: occurredAt,
        questions: request.questionIds.map((questionId) => ({
          questionId,
          lifecycleStatus: 'ACTIVE' as const,
          currentPublishedVersionId: null,
          versions: [
            {
              questionVersionId: ids.version,
              versionNumber: 1,
              versionStatus: 'DRAFT' as const,
              content: {
                level: importItem.content.level,
                subject: importItem.content.subject,
                questionType: importItem.content.questionType,
                difficulty: importItem.content.difficulty,
                passage: importItem.content.passage,
                questionText: importItem.content.questionText,
                explanationKo: importItem.content.explanationKo,
                explanationJa: importItem.content.explanationJa,
                options: [
                  { id: ids.option1, ordinal: 1, text: 'です' },
                  { id: ids.option2, ordinal: 2, text: 'ます' },
                  { id: ids.option3, ordinal: 3, text: 'でした' },
                  { id: ids.option4, ordinal: 4, text: 'ません' }
                ],
                correctOptionId: ids.option1,
                tags: [
                  {
                    id: ids.tag,
                    label: '문법',
                    normalizedName: '문법'
                  }
                ]
              }
            }
          ]
        }))
      }
      const canonicalBody = canonicalizeJson(
        document as unknown as CanonicalJsonValue
      )
      const [selectionDigest, responseBodyDigest] = await Promise.all([
        createAdminQuestionExportSelectionDigest(
          sha256Port,
          request.questionIds
        ),
        createAdminQuestionExportResponseBodyDigest(sha256Port, canonicalBody)
      ])
      return {
        document,
        canonicalBody,
        auditEvidence: {
          selectionDigest,
          responseBodyDigest,
          questionCount: document.questions.length,
          versionCount: document.questions.length
        }
      }
    }),
    triageReport: vi.fn(async (_authority, _reportId, request) =>
      mutation('TRIAGED', request.expectedRowVersion + 1)
    ),
    resolveReport: vi.fn(async (_authority, _reportId, request) => ({
      ...mutation(request.outcome, request.expectedRowVersion + 1),
      resolution: {
        outcome: request.outcome,
        reason: request.reason,
        remediationVersionId: request.remediationVersionId ?? null,
        resolvedAt: occurredAt
      }
    }))
  }

  const reportService: QuestionReportService = {
    createReport: vi.fn(async () => mutation('OPEN', 1)),
    listReports: vi.fn(async (query) => ({
      items: [
        {
          id: ids.report,
          questionId: ids.question,
          questionVersionId: ids.version,
          reason: 'OTHER' as const,
          status: 'OPEN' as const,
          rowVersion: 1,
          reporter: userActor,
          assignee: null,
          createdAt: occurredAt,
          updatedAt: occurredAt
        }
      ],
      page: query.page,
      pageSize: query.pageSize,
      total: 1
    })),
    getReport: vi.fn(async () => ({
      id: ids.report,
      questionId: ids.question,
      questionVersionId: ids.version,
      reason: 'OTHER' as const,
      description: '설명',
      descriptionDigest: await createQuestionReportDescriptionDigest(
        sha256Port,
        '설명'
      ),
      status: 'OPEN' as const,
      rowVersion: 1,
      reporter: userActor,
      assignee: null,
      resolution: null,
      createdAt: occurredAt,
      updatedAt: occurredAt
    }))
  }

  const commandConsume = vi.fn().mockResolvedValue(undefined)
  const reportConsume = vi.fn().mockResolvedValue(undefined)
  const readConsume = vi.fn().mockResolvedValue(undefined)
  const commandRateLimiter: AdminCommandRateLimiter = {
    consume: commandConsume
  }
  const reportRateLimiter: QuestionReportRateLimiter = {
    consume: reportConsume
  }
  const readRateLimiter: AdminReadRateLimiter = { consume: readConsume }
  const assertCapability = vi.fn().mockResolvedValue(undefined)
  const resolveAuthenticatedUser = vi.fn(async (headers: Headers) => {
    const user = headers.get('X-Test-Role') === 'USER' ? regularUser : adminUser
    return {
      clearSessionCookie: false,
      headers: new Headers(),
      phase7Session: {
        id: ids.session,
        token: 'phase7-session-token',
        createdAt: new Date(occurredAt),
        expiresAt: new Date('2026-09-29T00:00:00.000Z'),
        isFresh
      },
      user
    }
  })
  const principalService: PrincipalService = {
    resolveAuthenticatedUser,
    getAuthenticatedUser: vi.fn(async () => adminUser)
  }
  const app = createApiApp({
    admin: {
      assertCapability,
      commands: {
        rateLimiter: commandRateLimiter,
        service: baseCommandService,
        slice5Service
      },
      reports: { rateLimiter: reportRateLimiter, service: reportService },
      rateLimiter: readRateLimiter,
      reader
    },
    auth: {
      environment: appEnvironment,
      gateway: { handle: vi.fn() },
      guestPrincipalService,
      principalService
    },
    checkReadiness: vi.fn().mockResolvedValue(undefined),
    logger: createJsonLogger('silent'),
    questionReader
  })
  return {
    app,
    assertCapability,
    commandConsume,
    readConsume,
    reportConsume,
    reportService,
    resolveAuthenticatedUser,
    slice5Service
  }
}

const headers = (role: 'ADMIN' | 'USER' = 'ADMIN'): Headers =>
  new Headers({
    'Content-Type': 'application/json',
    Origin: environment.TRUSTED_ORIGINS[0]!,
    'X-Request-Id': ids.request,
    'X-Test-Role': role
  })

const pathFor = (path: string): string =>
  path
    .replace(':questionId', ids.question)
    .replace(':versionId', ids.version)
    .replace(':reportId', ids.report)

describe('Phase 7 Slice 5 routing', () => {
  it('executes all nine canonical operations with exact success transport', async () => {
    const fixture = createFixture()
    const validationDigest = await createAdminImportValidationDigest(
      sha256Port,
      [importItem]
    )
    const requests = [
      {
        method: 'POST',
        path: '/api/v1/admin/question-versions/review-request-batch',
        body: { items: [{ versionId: ids.version, expectedRowVersion: 1 }] },
        status: 200
      },
      {
        method: 'POST',
        path: '/api/v1/admin/questions/import-validation',
        body: { items: [importItem] },
        status: 200
      },
      {
        method: 'POST',
        path: '/api/v1/admin/questions/import-application',
        body: { items: [importItem], validationDigest },
        status: 201
      },
      {
        method: 'POST',
        path: '/api/v1/admin/questions/export',
        body: { questionIds: [ids.question] },
        status: 200
      },
      {
        method: 'POST',
        path: '/api/v1/question-reports',
        body: {
          questionVersionId: ids.version,
          reason: 'OTHER',
          description: '설명'
        },
        status: 201,
        role: 'USER' as const
      },
      {
        method: 'GET',
        path: '/api/v1/admin/question-reports',
        status: 200
      },
      {
        method: 'GET',
        path: `/api/v1/admin/question-reports/${ids.report}`,
        status: 200
      },
      {
        method: 'POST',
        path: `/api/v1/admin/question-reports/${ids.report}/triage`,
        body: { expectedRowVersion: 1 },
        status: 200
      },
      {
        method: 'POST',
        path: `/api/v1/admin/question-reports/${ids.report}/resolution`,
        body: {
          expectedRowVersion: 2,
          outcome: 'RESOLVED',
          reason: '설명을 바로잡았습니다.'
        },
        status: 200
      }
    ] as const

    for (const request of requests) {
      const response = await fixture.app.request(request.path, {
        method: request.method,
        headers: headers('role' in request ? request.role : 'ADMIN'),
        ...('body' in request ? { body: JSON.stringify(request.body) } : {})
      })
      expect(response.status, request.path).toBe(request.status)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('X-Request-Id')).toBe(ids.request)
      if (request.path.endsWith('/export')) {
        expect(response.headers.get('Content-Type')).toBe(
          'application/json; charset=utf-8'
        )
        expect(response.headers.get('Content-Disposition')).toBe(
          'attachment; filename="nihongo-admin-questions-v1.json"'
        )
      }
      await response.arrayBuffer()
    }

    expect(phase7Slice5OperationManifest).toHaveLength(9)
    expect(fixture.slice5Service.requestReviewBatch).toHaveBeenCalledOnce()
    expect(fixture.slice5Service.validateImport).toHaveBeenCalledOnce()
    expect(fixture.slice5Service.applyImport).toHaveBeenCalledOnce()
    expect(fixture.slice5Service.exportQuestions).toHaveBeenCalledOnce()
    expect(fixture.slice5Service.triageReport).toHaveBeenCalledOnce()
    expect(fixture.slice5Service.resolveReport).toHaveBeenCalledOnce()
    expect(fixture.reportService.createReport).toHaveBeenCalledOnce()
    expect(fixture.reportService.listReports).toHaveBeenCalledOnce()
    expect(fixture.reportService.getReport).toHaveBeenCalledOnce()
    expect(fixture.reportConsume).toHaveBeenCalledWith({
      actorId: ids.user,
      clientIp: 'unresolved',
      group: 'REPORT_ACTOR'
    })
  })

  it('does not trust a forwarded learner IP without a trusted peer', async () => {
    const fixture = createFixture()
    const requestHeaders = headers('USER')
    requestHeaders.set('X-Forwarded-For', '198.51.100.23')

    const response = await fixture.app.request('/api/v1/question-reports', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        questionVersionId: ids.version,
        reason: 'OTHER',
        description: '설명'
      })
    })

    expect(response.status).toBe(201)
    expect(fixture.reportConsume).toHaveBeenCalledWith({
      actorId: ids.user,
      clientIp: 'unresolved',
      group: 'REPORT_ACTOR'
    })
  })

  it('applies exact body caps and fresh-assurance policy before services', async () => {
    expect(getPhase7OperationBodyCap('requestContentReviewBatch')).toBe(
      256 * 1024
    )
    expect(getPhase7OperationBodyCap('validateQuestionImport')).toBe(
      2 * 1024 * 1024
    )
    expect(getPhase7OperationBodyCap('applyQuestionImport')).toBe(
      2 * 1024 * 1024
    )
    expect(getPhase7OperationBodyCap('exportAdminQuestions')).toBe(16 * 1024)
    expect(getPhase7OperationBodyCap('createQuestionReport')).toBe(32 * 1024)
    expect(getPhase7OperationBodyCap('triageAdminQuestionReport')).toBe(
      16 * 1024
    )
    expect(getPhase7OperationBodyCap('resolveAdminQuestionReport')).toBe(
      16 * 1024
    )

    const stale = createFixture({ isFresh: false })
    for (const [path, body] of [
      [
        '/api/v1/admin/question-versions/review-request-batch',
        { items: [{ versionId: ids.version, expectedRowVersion: 1 }] }
      ],
      [
        '/api/v1/admin/questions/import-application',
        { items: [importItem], validationDigest: 'a'.repeat(64) }
      ],
      ['/api/v1/admin/questions/export', { questionIds: [ids.question] }],
      [
        `/api/v1/admin/question-reports/${ids.report}/resolution`,
        {
          expectedRowVersion: 2,
          outcome: 'DISMISSED',
          reason: '조치가 필요하지 않습니다.'
        }
      ]
    ] as const) {
      const response = await stale.app.request(path, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body)
      })
      expect(response.status, path).toBe(401)
      expect(apiFailureSchema.parse(await response.json()).code).toBe(
        'FRESH_ASSURANCE_REQUIRED'
      )
    }
    expect(stale.slice5Service.requestReviewBatch).not.toHaveBeenCalled()
    expect(stale.slice5Service.applyImport).not.toHaveBeenCalled()
    expect(stale.slice5Service.exportQuestions).not.toHaveBeenCalled()
    expect(stale.slice5Service.resolveReport).not.toHaveBeenCalled()
  })

  it.each(['clientItemId', 'clientOptionKey', 'correctOptionKey'] as const)(
    'rejects an unpaired surrogate in import %s with 422 before digest or service work',
    async (field) => {
      const fixture = createFixture()
      const candidate: AdminImportItem = {
        ...importItem,
        content: {
          ...importItem.content,
          options: importItem.content.options.map((option) => ({ ...option }))
        }
      }
      if (field === 'clientItemId') candidate.clientItemId = '\ud800'
      if (field === 'clientOptionKey') {
        candidate.content.options[0]!.clientOptionKey = '\ud800'
      }
      if (field === 'correctOptionKey') {
        candidate.content.correctOptionKey = '\ud800'
      }
      const digest = vi.spyOn(sha256Port, 'digestUtf8')

      const response = await fixture.app.request(
        '/api/v1/admin/questions/import-validation',
        {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ items: [candidate] })
        }
      )

      expect(response.status).toBe(422)
      expect(apiFailureSchema.parse(await response.json())).toMatchObject({
        code: 'VALIDATION_ERROR',
        retryable: false
      })
      expect(digest).not.toHaveBeenCalled()
      expect(fixture.slice5Service.validateImport).not.toHaveBeenCalled()
      expect(fixture.slice5Service.applyImport).not.toHaveBeenCalled()
      digest.mockRestore()
    }
  )

  it('returns every semantic import issue in canonical pointer/code order through Hono', async () => {
    const fixture = createFixture()
    const invalidItem: AdminImportItem = {
      clientItemId: 'semantic-duplicate-id',
      content: {
        ...importItem.content,
        subject: 'READING',
        questionType: 'GRAMMAR_SELECT',
        passage: null,
        tagNames: ['없는 태그', '없는 태그'],
        options: [
          { clientOptionKey: 'a', text: '같은 보기' },
          { clientOptionKey: 'a', text: '둘째 보기' },
          { clientOptionKey: 'c', text: '같은 보기' },
          { clientOptionKey: 'd', text: '넷째 보기' }
        ],
        correctOptionKey: 'missing'
      }
    }
    const duplicateContentItem: AdminImportItem = {
      clientItemId: invalidItem.clientItemId,
      content: {
        ...importItem.content,
        questionText: '기존 retained content와 같은 문제입니다.',
        options: importItem.content.options.map((option) => ({ ...option }))
      }
    }
    const query = vi.fn(async (statement: string, ...parameters: unknown[]) => {
      if (statement.includes('FROM "Tag" AS tag')) {
        return [
          {
            id: ids.tag,
            label: '문법',
            normalizedName: '문법',
            level: 'N5',
            subject: 'GRAMMAR',
            questionType: 'GRAMMAR_SELECT'
          }
        ]
      }
      if (statement.includes('SELECT DISTINCT "contentFingerprint"')) {
        const fingerprints = parameters[0] as readonly string[]
        return [{ contentFingerprint: fingerprints[0] }]
      }
      throw new Error(`Unexpected semantic import query: ${statement}`)
    })
    const repository = createPrismaAdminQuestionSlice5Repository({
      auditEnvironment: 'TEST',
      client: {
        $queryRawUnsafe: query,
        $transaction: vi.fn()
      } as unknown as PrismaClient
    })
    vi.mocked(fixture.slice5Service.validateImport).mockImplementation(
      (request) => repository.validateImport(request)
    )

    const response = await fixture.app.request(
      '/api/v1/admin/questions/import-validation',
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ items: [invalidItem, duplicateContentItem] })
      }
    )

    expect(response.status).toBe(200)
    const result = adminImportValidationResponseSchema.parse(
      await response.json()
    )
    expect(result).toMatchObject({ valid: false, itemCount: 2 })
    expect(
      result.errors.map(({ code, fieldPath, itemIndex }) => ({
        code,
        fieldPath,
        itemIndex
      }))
    ).toEqual([
      {
        itemIndex: 0,
        fieldPath: '/items/0/content/correctOptionKey',
        code: 'CORRECT_OPTION_KEY_NOT_FOUND'
      },
      {
        itemIndex: 0,
        fieldPath: '/items/0/content/options/1/clientOptionKey',
        code: 'DUPLICATE_CLIENT_OPTION_KEY'
      },
      {
        itemIndex: 0,
        fieldPath: '/items/0/content/options/2/text',
        code: 'DUPLICATE_OPTION_TEXT'
      },
      {
        itemIndex: 0,
        fieldPath: '/items/0/content/passage',
        code: 'INVALID_READING_PASSAGE'
      },
      {
        itemIndex: 0,
        fieldPath: '/items/0/content/questionType',
        code: 'INVALID_CONTENT'
      },
      {
        itemIndex: 0,
        fieldPath: '/items/0/content/tagNames/0',
        code: 'UNKNOWN_TAG'
      },
      {
        itemIndex: 0,
        fieldPath: '/items/0/content/tagNames/1',
        code: 'DUPLICATE_TAG'
      },
      {
        itemIndex: 0,
        fieldPath: '/items/0/content/tagNames/1',
        code: 'UNKNOWN_TAG'
      },
      {
        itemIndex: 1,
        fieldPath: '/items/1/clientItemId',
        code: 'DUPLICATE_CLIENT_ITEM_ID'
      },
      {
        itemIndex: 1,
        fieldPath: '/items/1/content/questionText',
        code: 'DUPLICATE_QUESTION_CONTENT'
      }
    ])
    expect(new Set(result.errors.map(({ code }) => code)).size).toBe(9)
    expect(fixture.slice5Service.validateImport).toHaveBeenCalledOnce()
  })

  it('classifies a post-commit learner report response integrity failure as confirmed and non-retryable', async () => {
    const fixture = createFixture()
    vi.mocked(fixture.reportService.createReport).mockResolvedValueOnce({
      ...mutation('OPEN', 1),
      questionVersionId: ids.question
    })

    const response = await fixture.app.request('/api/v1/question-reports', {
      method: 'POST',
      headers: headers('USER'),
      body: JSON.stringify({
        questionVersionId: ids.version,
        reason: 'OTHER',
        description: '설명'
      })
    })

    expect(response.status).toBe(500)
    expect(apiFailureSchema.parse(await response.json())).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      retryable: false
    })
  })

  it('rejects a malformed learner report version UUID before calling the service', async () => {
    const fixture = createFixture()

    const response = await fixture.app.request('/api/v1/question-reports', {
      method: 'POST',
      headers: headers('USER'),
      body: JSON.stringify({
        questionVersionId: 'not-a-uuid',
        reason: 'OTHER',
        description: '설명'
      })
    })

    expect(response.status).toBe(422)
    expect(apiFailureSchema.parse(await response.json())).toMatchObject({
      code: 'VALIDATION_ERROR',
      retryable: false,
      fieldErrors: {
        questionVersionId: expect.any(Array)
      }
    })
    expect(fixture.reportService.createReport).not.toHaveBeenCalled()
  })

  it.each([
    ['disabled', { ...environment, ADMIN_CMS_MODE: 'disabled' }],
    ['production', { ...environment, NODE_ENV: 'production' }]
  ] as const)(
    '%s keeps all Slice 5 operations generic 404 with every caller at zero',
    async (_label, appEnvironment) => {
      const fixture = createFixture({ appEnvironment })
      for (const entry of phase7Slice5OperationManifest) {
        const response = await fixture.app.request(pathFor(entry.path), {
          method: entry.method,
          headers: headers(),
          ...(entry.method === 'GET' ? {} : { body: '{}' })
        })
        expect(response.status, entry.operation).toBe(404)
        expect(apiFailureSchema.parse(await response.json()).code).toBe(
          'RESOURCE_NOT_FOUND'
        )
      }
      expect(fixture.resolveAuthenticatedUser).not.toHaveBeenCalled()
      expect(fixture.assertCapability).not.toHaveBeenCalled()
      expect(fixture.commandConsume).not.toHaveBeenCalled()
      expect(fixture.readConsume).not.toHaveBeenCalled()
      expect(fixture.reportConsume).not.toHaveBeenCalled()
      for (const service of Object.values(fixture.slice5Service)) {
        expect(service).not.toHaveBeenCalled()
      }
      for (const service of Object.values(fixture.reportService)) {
        expect(service).not.toHaveBeenCalled()
      }
    }
  )
})
