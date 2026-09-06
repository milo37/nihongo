import { createHash } from 'node:crypto'
import {
  createAdminAuditContentDigestPreimage,
  listAdminAuditLogQuerySchema,
  listAdminQuestionsQuerySchema,
  listAdminQuestionVersionsQuerySchema,
  type AdminAuditLogItem
} from '@nihongo/contracts/admin/phase7'
import { describe, expect, it, vi } from 'vitest'
import {
  AdminQuestionRepositoryIntegrityError,
  type AdminAuditRecord,
  type AdminQuestionRepository,
  type AdminVersionRecord,
  type AdminVersionSummaryRecord
} from './adminQuestionRepository.js'
import { createAdminQuestionService } from './adminQuestionService.js'

const QUESTION_ID = '019d0000-0000-7000-8000-000000000001'
const VERSION_ID = '019d0000-0000-7000-8000-000000000011'
const TARGET_VERSION_ID = '019d0000-0000-7000-8000-000000000012'
const TAG_ID = '019d0000-0000-7000-8000-000000000021'
const OTHER_TAG_ID = '019d0000-0000-7000-8000-000000000022'
const ADMIN_ID = '019d0000-0000-7000-8000-000000000031'
const AUDIT_ID = '019d0000-0000-7000-8000-000000000041'
const OPERATION_ID = '019d0000-0000-7000-8000-000000000051'
const REQUEST_ID = '019d0000-0000-7000-8000-000000000061'
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z')
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z')

const baseVersion: AdminVersionRecord = {
  id: VERSION_ID,
  questionId: QUESTION_ID,
  versionNumber: 1,
  status: 'PUBLISHED',
  retirementKind: null,
  rowVersion: 1,
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  passage: null,
  questionText: '日本の読み方を選んでください。',
  correctOptionId: '019d0000-0000-7000-8000-000000000071',
  explanationKo: '정답 해설입니다.',
  explanationJa: null,
  difficulty: 'EASY',
  createdByActorId: null,
  createdByRoleSnapshot: null,
  createdByLabelSnapshot: 'SYSTEM_SEED',
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  publishedAt: UPDATED_AT,
  retiredAt: null,
  options: [
    {
      id: '019d0000-0000-7000-8000-000000000071',
      label: '1',
      ordinal: 1,
      text: 'にほん'
    },
    {
      id: '019d0000-0000-7000-8000-000000000072',
      label: '2',
      ordinal: 2,
      text: 'にっぽ'
    },
    {
      id: '019d0000-0000-7000-8000-000000000073',
      label: '3',
      ordinal: 3,
      text: 'ひのもと'
    },
    {
      id: '019d0000-0000-7000-8000-000000000074',
      label: '4',
      ordinal: 4,
      text: 'にちほん'
    }
  ],
  tags: [{ id: TAG_ID, label: '읽기', normalizedName: '읽기' }],
  latestReviewer: null
}

const targetVersion: AdminVersionRecord = {
  ...baseVersion,
  id: TARGET_VERSION_ID,
  versionNumber: 2,
  status: 'DRAFT',
  publishedAt: null,
  difficulty: 'NORMAL',
  questionText: '日本의 올바른 읽기를 선택하세요.',
  correctOptionId: '019d0000-0000-7000-8000-000000000072',
  explanationKo: '수정된 해설입니다.',
  tags: [
    { id: OTHER_TAG_ID, label: '한자', normalizedName: '한자' },
    { id: TAG_ID, label: '읽기', normalizedName: '읽기' }
  ]
}

const createRepository = (
  overrides: Partial<AdminQuestionRepository> = {}
): AdminQuestionRepository => ({
  listQuestions: vi.fn(async () => ({ items: [], total: 0 })),
  getQuestion: vi.fn(async () => null),
  listVersions: vi.fn(async () => null),
  findVersion: vi.fn(async () => null),
  findVersionPair: vi.fn(async () => null),
  listReviews: vi.fn(async () => null),
  listTags: vi.fn(async () => []),
  listAuditLog: vi.fn(async () => []),
  ...overrides
})

const createAuditItem = (contentDigest: string): AdminAuditRecord => ({
  id: AUDIT_ID,
  command: 'REVIEW_REQUEST',
  targetType: 'QUESTION_VERSION',
  targetId: VERSION_ID,
  actor: {
    kind: 'ACCOUNT',
    actorId: ADMIN_ID,
    role: 'ADMIN',
    label: 'ACTIVE_ADMIN'
  },
  beforeState: 'DRAFT',
  afterState: 'IN_REVIEW',
  beforeRowVersion: 1,
  afterRowVersion: 2,
  changedFields: ['VERSION_STATUS'],
  metadata: { kind: 'NONE_V1' },
  contentDigest,
  operationId: OPERATION_ID,
  requestId: REQUEST_ID,
  environment: 'TEST',
  occurredAt: UPDATED_AT
})

const createAuditDigest = (): string => {
  const item: AdminAuditLogItem = {
    ...createAuditItem('0'.repeat(64)),
    occurredAt: UPDATED_AT.toISOString()
  } as AdminAuditLogItem
  return createHash('sha256')
    .update(createAdminAuditContentDigestPreimage(item), 'utf8')
    .digest('hex')
}

describe('Phase 7 admin question service', () => {
  it('maps selected version stats with half-up basis points and leaks no answer', async () => {
    const repository = createRepository({
      listQuestions: vi.fn(async () => ({
        total: 1,
        items: [
          {
            questionId: QUESTION_ID,
            lifecycleStatus: 'ACTIVE' as const,
            currentPublishedVersionId: VERSION_ID,
            openCandidateVersionId: null,
            questionRowVersion: 1,
            questionCreatedAt: CREATED_AT,
            selectedVersion: baseVersion,
            answerCount: 3,
            correctCount: 2,
            openReportCount: 4
          }
        ]
      }))
    })
    const service = createAdminQuestionService(repository)
    const response = await service.listQuestions(
      listAdminQuestionsQuerySchema.parse({})
    )

    expect(response.items[0]).toMatchObject({
      questionId: QUESTION_ID,
      selectedVersionId: VERSION_ID,
      answerCount: 3,
      correctRateBasisPoints: 6667,
      openReportCount: 4
    })
    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain('correctOptionId')
    expect(serialized).not.toContain('explanationKo')
    expect(serialized).not.toContain('options')
  })

  it('returns null correct rate when no StudyAnswer exists', async () => {
    const summary: AdminVersionSummaryRecord = baseVersion
    const service = createAdminQuestionService(
      createRepository({
        listQuestions: vi.fn(async () => ({
          total: 1,
          items: [
            {
              questionId: QUESTION_ID,
              lifecycleStatus: 'ACTIVE' as const,
              currentPublishedVersionId: VERSION_ID,
              openCandidateVersionId: null,
              questionRowVersion: 1,
              questionCreatedAt: CREATED_AT,
              selectedVersion: summary,
              answerCount: 0,
              correctCount: 0,
              openReportCount: 0
            }
          ]
        }))
      })
    )

    const response = await service.listQuestions(
      listAdminQuestionsQuerySchema.parse({})
    )
    expect(response.items[0]?.correctRateBasisPoints).toBeNull()
  })

  it('preview reuses public projection and keeps answer in adminAnswer only', async () => {
    const service = createAdminQuestionService(
      createRepository({
        findVersion: vi.fn(async () => baseVersion)
      })
    )
    const preview = await service.previewVersion(VERSION_ID)

    expect(preview.question).toMatchObject({
      id: QUESTION_ID,
      questionVersionId: VERSION_ID,
      options: expect.arrayContaining([
        expect.objectContaining({ id: baseVersion.correctOptionId })
      ])
    })
    expect(preview.question).not.toHaveProperty('correctOptionId')
    expect(preview.question).not.toHaveProperty('explanationKo')
    expect(preview.adminAnswer).toEqual({
      correctOptionId: baseVersion.correctOptionId,
      explanationKo: baseVersion.explanationKo,
      explanationJa: null
    })
  })

  it('diff is complete and declaration ordered, including options and tags', async () => {
    const service = createAdminQuestionService(
      createRepository({
        findVersionPair: vi.fn(async () => ({
          base: baseVersion,
          target: targetVersion
        }))
      })
    )
    const diff = await service.diffVersion(TARGET_VERSION_ID, {
      baseVersionId: VERSION_ID
    })

    expect(diff.changedFields).toEqual([
      'DIFFICULTY',
      'QUESTION_TEXT',
      'EXPLANATION_KO',
      'OPTIONS',
      'TAGS'
    ])
    expect(diff.changes.map((change) => change.field)).toEqual(
      diff.changedFields
    )
  })

  it('uses the last included version key as next cursor', async () => {
    const service = createAdminQuestionService(
      createRepository({
        listVersions: vi.fn(async () => [targetVersion, baseVersion])
      })
    )
    const response = await service.listVersions(
      QUESTION_ID,
      listAdminQuestionVersionsQuerySchema.parse({ limit: 1 })
    )

    expect(response.items).toHaveLength(1)
    expect(response.items[0]?.questionVersionId).toBe(TARGET_VERSION_ID)
    expect(response.nextCursor).not.toBeNull()
  })

  it('verifies every returned audit digest and rejects tampering', async () => {
    const validDigest = createAuditDigest()
    const query = listAdminAuditLogQuerySchema.parse({})
    const validService = createAdminQuestionService(
      createRepository({
        listAuditLog: vi.fn(async () => [createAuditItem(validDigest)])
      })
    )
    await expect(validService.listAuditLog(query)).resolves.toMatchObject({
      items: [{ id: AUDIT_ID, contentDigest: validDigest }]
    })

    const tamperedService = createAdminQuestionService(
      createRepository({
        listAuditLog: vi.fn(async () => [createAuditItem('f'.repeat(64))])
      })
    )
    await expect(tamperedService.listAuditLog(query)).rejects.toThrow(
      'contentDigest'
    )
  })

  it('maps repository integrity failure to a retryable read 500', async () => {
    const service = createAdminQuestionService(
      createRepository({
        listQuestions: vi.fn(async () => {
          throw new AdminQuestionRepositoryIntegrityError('tampered projection')
        })
      })
    )

    await expect(
      service.listQuestions(listAdminQuestionsQuerySchema.parse({}))
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      retryable: true
    })
  })
})
