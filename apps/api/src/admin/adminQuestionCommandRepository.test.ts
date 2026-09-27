import type {
  CreateAdminQuestionRequest,
  UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import { describe, expect, it, vi } from 'vitest'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import {
  createPreparedAdminQuestionCommandRepository,
  createPrismaAdminQuestionCommandRepository,
  type AdminCommandAuthority
} from './adminQuestionCommandRepository.js'

const actorId = '019d0000-0000-7000-8000-000000000001'
const reviewerId = '019d0000-0000-7000-8000-000000000006'
const questionId = '019d0000-0000-7000-8000-000000000002'
const versionId = '019d0000-0000-7000-8000-000000000003'
const tagId = '019d0000-0000-7000-8000-000000000004'
const optionIds = [
  '019d0000-0000-7000-8000-000000000011',
  '019d0000-0000-7000-8000-000000000012',
  '019d0000-0000-7000-8000-000000000013',
  '019d0000-0000-7000-8000-000000000014'
] as const
const authority: AdminCommandAuthority = {
  actorId,
  rawSessionToken: 'phase7-command-session',
  requestId: '019d0000-0000-7000-8000-000000000005'
}
const content: CreateAdminQuestionRequest = {
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  difficulty: 'NORMAL',
  questionText: '漢字の読み方を選んでください。',
  passage: null,
  explanationKo: '읽기를 확인합니다.',
  explanationJa: null,
  tagNames: ['kana'],
  options: [
    { clientOptionKey: 'a', text: 'かな' },
    { clientOptionKey: 'b', text: 'かんじ' },
    { clientOptionKey: 'c', text: 'ことば' },
    { clientOptionKey: 'd', text: 'ぶんぽう' }
  ],
  correctOptionKey: 'a'
}
const options = content.options.map((option, index) => ({
  id: optionIds[index]!,
  label: String(index + 1),
  ordinal: index + 1,
  text: option.text
}))
const update: UpdateQuestionVersionRequest = {
  level: content.level,
  subject: content.subject,
  questionType: content.questionType,
  difficulty: content.difficulty,
  questionText: `${content.questionText} 수정`,
  passage: content.passage,
  explanationKo: content.explanationKo,
  explanationJa: content.explanationJa,
  tagNames: content.tagNames,
  options: options.map(({ id, ordinal, text }) => ({ id, ordinal, text })),
  correctOptionId: optionIds[0],
  expectedRowVersion: 2
}
const tag = { id: tagId, label: 'Kana', normalizedName: 'kana' }
const versionTarget = (overrides: Record<string, unknown> = {}) => ({
  questionId,
  questionLifecycleStatus: 'ACTIVE',
  questionRowVersion: 3,
  questionCreatedByUserId: actorId,
  versionId,
  versionNumber: 1,
  versionStatus: 'DRAFT',
  versionRowVersion: 2,
  versionCreatedByUserId: actorId,
  latestApproverUserId: null,
  isPinned: false,
  level: content.level,
  subject: content.subject,
  questionType: content.questionType,
  difficulty: content.difficulty,
  passage: content.passage,
  questionText: content.questionText,
  explanationKo: content.explanationKo,
  explanationJa: content.explanationJa,
  correctOptionId: optionIds[0],
  ...overrides
})

const publicationTarget = (overrides: Record<string, unknown> = {}) =>
  versionTarget({
    questionCurrentPublishedVersionId: null,
    questionCreatedByUserId: actorId,
    versionNumber: 2,
    versionStatus: 'APPROVED',
    versionRowVersion: 5,
    versionCreatedByUserId: actorId,
    versionCreatedByActorId: actorId,
    versionCreatedByRoleSnapshot: 'ADMIN',
    versionCreatedByLabelSnapshot: 'ACTIVE_ADMIN',
    latestApproverUserId: reviewerId,
    latestApproverActorId: reviewerId,
    latestApproverRole: 'ADMIN',
    latestApproverLabel: 'ACTIVE_ADMIN',
    contentFingerprint: 'a'.repeat(64),
    ...overrides
  })

const lifecycleVersion = (status: 'APPROVED' | 'PUBLISHED' = 'APPROVED') => ({
  id: versionId,
  questionId,
  status,
  rowVersion: 5,
  createdByUserId: actorId,
  createdByActorId: actorId,
  createdByRoleSnapshot: 'ADMIN',
  createdByLabelSnapshot: 'ACTIVE_ADMIN',
  contentFingerprint: 'a'.repeat(64)
})

const questionTarget = {
  id: questionId,
  lifecycleStatus: 'ACTIVE',
  rowVersion: 3,
  currentPublishedVersionId: null,
  createdByUserId: actorId,
  maximumVersionNumber: 1,
  hasOpenCandidate: false
} as const

const createPublicationQuery = (input: {
  duplicate?: boolean
  principalIsFresh?: boolean
  target?: ReturnType<typeof publicationTarget>
  versions?: readonly ReturnType<typeof lifecycleVersion>[]
}) =>
  vi.fn(async (statement: string) => {
    if (statement.includes('phase7_resolve_v1_principal')) {
      return [
        {
          principalUserId: actorId,
          principalRole: 'ADMIN',
          isFresh: input.principalIsFresh ?? true
        }
      ]
    }
    if (statement.includes('latest_approval')) {
      return [input.target ?? publicationTarget()]
    }
    if (statement.includes('COALESCE(maximum')) return [questionTarget]
    if (statement.includes('ORDER BY version."id"')) {
      return input.versions ?? [lifecycleVersion()]
    }
    if (statement.includes('SELECT EXISTS')) {
      return [{ exists: input.duplicate ?? false }]
    }
    throw new Error(`Unexpected prepared repository query: ${statement}`)
  })

const rawError = (sqlState: string, message = 'database error') =>
  new Prisma.PrismaClientKnownRequestError(message, {
    clientVersion: '7.9.1',
    code: 'P2010',
    meta: { code: sqlState, message }
  })

const createUpdateClient = ({
  after,
  duplicateExists = false,
  transactionError
}: {
  after: ReturnType<typeof versionTarget>
  duplicateExists?: boolean
  transactionError: unknown
}) => {
  let targetReads = 0
  const duplicateProbe = vi.fn(async () => [{ exists: duplicateExists }])
  const query = vi.fn(async (statement: string) => {
    if (statement.includes('FROM "QuestionVersion" AS version')) {
      targetReads += 1
      return [targetReads === 1 ? versionTarget() : after]
    }
    if (statement.includes('FROM "QuestionOption"')) return options
    if (statement.includes('FROM "QuestionVersionTag" AS assignment')) {
      return [{ ...tag, assignmentId: crypto.randomUUID() }]
    }
    if (statement.includes('FROM "Tag" AS tag')) return [tag]
    if (statement.includes('SELECT EXISTS')) return duplicateProbe()
    throw new Error(`Unexpected repository query: ${statement}`)
  })
  const transaction = vi.fn(async () => Promise.reject(transactionError))
  return {
    client: {
      $queryRawUnsafe: query,
      $transaction: transaction
    } as unknown as PrismaClient,
    duplicateProbe,
    transaction
  }
}

describe('Phase 7 ADMIN question command repository error boundaries', () => {
  it('keeps publication closures out of the active runtime repository', () => {
    const client = {} as PrismaClient
    const active = createPrismaAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client
    })
    const prepared = createPreparedAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client
    })

    expect(Object.keys(active).toSorted()).toEqual([
      'createQuestion',
      'createVersion',
      'transitionVersion',
      'updateVersion'
    ])
    expect('publishVersion' in active).toBe(false)
    expect('retireVersion' in active).toBe(false)
    expect('archiveQuestion' in active).toBe(false)
    expect(Object.keys(prepared).toSorted()).toEqual([
      'archiveQuestion',
      'createQuestion',
      'createVersion',
      'publishVersion',
      'retireVersion',
      'transitionVersion',
      'updateVersion'
    ])
  })

  it.each(['publish', 'retire', 'archive'] as const)(
    'classifies stale commit authority for prepared %s as fresh-assurance rollback',
    async (operation) => {
      const target =
        operation === 'retire'
          ? publicationTarget({
              questionCurrentPublishedVersionId: versionId,
              versionStatus: 'PUBLISHED'
            })
          : publicationTarget()
      const query = createPublicationQuery({
        principalIsFresh: false,
        target,
        versions: operation === 'archive' ? [] : [lifecycleVersion()]
      })
      const transaction = vi.fn(async () =>
        Promise.reject(
          rawError(
            '42501',
            'Phase 7 operation authority is stale or insufficient.'
          )
        )
      )
      const repository = createPreparedAdminQuestionCommandRepository({
        auditEnvironment: 'TEST',
        client: {
          $queryRawUnsafe: query,
          $transaction: transaction
        } as unknown as PrismaClient
      })

      const outcome =
        operation === 'publish'
          ? repository.publishVersion(authority, versionId, {
              expectedQuestionRowVersion: 3,
              expectedRowVersion: 5
            })
          : operation === 'retire'
            ? repository.retireVersion(authority, versionId, {
                expectedQuestionRowVersion: 3,
                expectedRowVersion: 5
              })
            : repository.archiveQuestion(authority, questionId, {
                expectedQuestionRowVersion: 3,
                expectedOpenCandidateVersionId: null,
                expectedOpenCandidateRowVersion: null
              })

      await expect(outcome).rejects.toMatchObject({
        code: 'FRESH_ASSURANCE_REQUIRED',
        disposition: 'DEFINITE_ROLLBACK'
      })
      expect(transaction).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['publish', 'retire', 'archive'] as const)(
    'rejects prepared %s invalid state before transaction entry',
    async (operation) => {
      const query =
        operation === 'archive'
          ? vi.fn(async (statement: string) => {
              if (statement.includes('COALESCE(maximum')) {
                return [{ ...questionTarget, lifecycleStatus: 'ARCHIVED' }]
              }
              if (statement.includes('ORDER BY version."id"')) return []
              throw new Error(
                `Unexpected archive invalid-state query: ${statement}`
              )
            })
          : createPublicationQuery({
              target:
                operation === 'publish'
                  ? publicationTarget({ versionStatus: 'DRAFT' })
                  : publicationTarget({
                      questionCurrentPublishedVersionId: null,
                      versionStatus: 'PUBLISHED'
                    })
            })
      const transaction = vi.fn()
      const repository = createPreparedAdminQuestionCommandRepository({
        auditEnvironment: 'TEST',
        client: {
          $queryRawUnsafe: query,
          $transaction: transaction
        } as unknown as PrismaClient
      })

      const outcome =
        operation === 'publish'
          ? repository.publishVersion(authority, versionId, {
              expectedQuestionRowVersion: 3,
              expectedRowVersion: 5
            })
          : operation === 'retire'
            ? repository.retireVersion(authority, versionId, {
                expectedQuestionRowVersion: 3,
                expectedRowVersion: 5
              })
            : repository.archiveQuestion(authority, questionId, {
                expectedQuestionRowVersion: 3,
                expectedOpenCandidateVersionId: null,
                expectedOpenCandidateRowVersion: null
              })

      await expect(outcome).rejects.toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        disposition: 'NO_TX'
      })
      expect(transaction).not.toHaveBeenCalled()
    }
  )

  it('rejects publication SoD before duplicate probing or transaction entry', async () => {
    const query = createPublicationQuery({
      target: publicationTarget({
        latestApproverUserId: actorId,
        latestApproverActorId: actorId
      })
    })
    const transaction = vi.fn()
    const repository = createPreparedAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client: {
        $queryRawUnsafe: query,
        $transaction: transaction
      } as unknown as PrismaClient
    })

    await expect(
      repository.publishVersion(authority, versionId, {
        expectedQuestionRowVersion: 3,
        expectedRowVersion: 5
      })
    ).rejects.toMatchObject({
      code: 'SEPARATION_OF_DUTIES_VIOLATION',
      disposition: 'NO_TX'
    })
    expect(
      query.mock.calls.some(([statement]) =>
        statement.includes('SELECT EXISTS')
      )
    ).toBe(false)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('keeps a visible publication duplicate at 409/NO_TX', async () => {
    const query = createPublicationQuery({ duplicate: true })
    const transaction = vi.fn()
    const repository = createPreparedAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client: {
        $queryRawUnsafe: query,
        $transaction: transaction
      } as unknown as PrismaClient
    })

    await expect(
      repository.publishVersion(authority, versionId, {
        expectedQuestionRowVersion: 3,
        expectedRowVersion: 5
      })
    ).rejects.toMatchObject({
      code: 'DUPLICATE_QUESTION_CONTENT',
      disposition: 'NO_TX'
    })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('maps a publication duplicate appearing after arm to a definite 503 race', async () => {
    const query = createPublicationQuery({ duplicate: false })
    const transactionQuery = vi.fn(async (statement: string) => {
      if (statement.includes('phase7_begin_admin_operation')) {
        return [{ actorUserId: actorId, operationId: crypto.randomUUID() }]
      }
      if (statement.includes('phase7_arm_admin_operation')) {
        return [{ occurredAt: new Date('2026-09-15T00:00:00.000Z') }]
      }
      if (statement.includes('SELECT EXISTS')) return [{ exists: true }]
      throw new Error(`Unexpected publication transaction query: ${statement}`)
    })
    const execute = vi.fn()
    const transaction = vi.fn(
      async (
        callback: (client: Prisma.TransactionClient) => Promise<unknown>
      ) =>
        callback({
          $queryRawUnsafe: transactionQuery,
          $executeRawUnsafe: execute
        } as unknown as Prisma.TransactionClient)
    )
    const repository = createPreparedAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client: {
        $queryRawUnsafe: query,
        $transaction: transaction
      } as unknown as PrismaClient
    })

    await expect(
      repository.publishVersion(authority, versionId, {
        expectedQuestionRowVersion: 3,
        expectedRowVersion: 5
      })
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      disposition: 'DEFINITE_ROLLBACK',
      internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE'
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('maps a publication duplicate constraint to the same definite 503 race', async () => {
    const query = createPublicationQuery({ duplicate: false })
    const transaction = vi.fn(async () =>
      Promise.reject(
        rawError('23514', 'Cross-question canonical duplicate is forbidden.')
      )
    )
    const repository = createPreparedAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client: {
        $queryRawUnsafe: query,
        $transaction: transaction
      } as unknown as PrismaClient
    })

    await expect(
      repository.publishVersion(authority, versionId, {
        expectedQuestionRowVersion: 3,
        expectedRowVersion: 5
      })
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      disposition: 'DEFINITE_ROLLBACK',
      internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE'
    })
  })

  it('concurrent pin after serialization rollback becomes immutable before duplicate probing', async () => {
    const fixture = createUpdateClient({
      after: versionTarget({ isPinned: true }),
      transactionError: rawError('40001')
    })
    const repository = createPrismaAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client: fixture.client
    })

    await expect(
      repository.updateVersion(authority, versionId, update)
    ).rejects.toMatchObject({
      code: 'QUESTION_VERSION_IMMUTABLE',
      disposition: 'DEFINITE_ROLLBACK'
    })
    expect(fixture.transaction).toHaveBeenCalledTimes(1)
    expect(fixture.duplicateProbe).toHaveBeenCalledTimes(1)
  })

  it('rowVersion conflict keeps priority over a concurrent pin', async () => {
    const fixture = createUpdateClient({
      after: versionTarget({ isPinned: true, versionRowVersion: 3 }),
      transactionError: rawError('40001')
    })
    const repository = createPrismaAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client: fixture.client
    })

    await expect(
      repository.updateVersion(authority, versionId, update)
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      disposition: 'DEFINITE_ROLLBACK'
    })
    expect(fixture.duplicateProbe).toHaveBeenCalledTimes(1)
  })

  it('rejects a visible create duplicate as NO_TX before opening a transaction', async () => {
    const transaction = vi.fn()
    const client = {
      $queryRawUnsafe: vi.fn(async (statement: string) => {
        if (statement.includes('FROM "Tag" AS tag')) return [tag]
        if (statement.includes('SELECT EXISTS')) return [{ exists: true }]
        throw new Error(`Unexpected repository query: ${statement}`)
      }),
      $transaction: transaction
    } as unknown as PrismaClient
    const repository = createPrismaAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client
    })

    await expect(
      repository.createQuestion(authority, content)
    ).rejects.toMatchObject({
      code: 'DUPLICATE_QUESTION_CONTENT',
      disposition: 'NO_TX'
    })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('rejects a visible create-version duplicate as NO_TX before opening a transaction', async () => {
    const transaction = vi.fn()
    const client = {
      $queryRawUnsafe: vi.fn(async (statement: string) => {
        if (statement.includes('FROM "Question" AS question')) {
          return [
            {
              id: questionId,
              lifecycleStatus: 'ACTIVE',
              rowVersion: 3,
              createdByUserId: actorId,
              maximumVersionNumber: 1,
              hasOpenCandidate: false
            }
          ]
        }
        if (statement.includes('FROM "Tag" AS tag')) return [tag]
        if (statement.includes('SELECT EXISTS')) return [{ exists: true }]
        throw new Error(`Unexpected repository query: ${statement}`)
      }),
      $transaction: transaction
    } as unknown as PrismaClient
    const repository = createPrismaAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client
    })

    await expect(
      repository.createVersion(authority, questionId, {
        ...content,
        expectedQuestionRowVersion: 3
      })
    ).rejects.toMatchObject({
      code: 'DUPLICATE_QUESTION_CONTENT',
      disposition: 'NO_TX'
    })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('rejects a visible PATCH duplicate as NO_TX before opening a transaction', async () => {
    const fixture = createUpdateClient({
      after: versionTarget(),
      duplicateExists: true,
      transactionError: rawError('40001')
    })
    const repository = createPrismaAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client: fixture.client
    })

    await expect(
      repository.updateVersion(authority, versionId, update)
    ).rejects.toMatchObject({
      code: 'DUPLICATE_QUESTION_CONTENT',
      disposition: 'NO_TX'
    })
    expect(fixture.duplicateProbe).toHaveBeenCalledTimes(1)
    expect(fixture.transaction).not.toHaveBeenCalled()
  })

  it.each(['55P03', '57014'])(
    'maps PostgreSQL %s transaction abort to a definite rollback',
    async (sqlState) => {
      const client = {
        $queryRawUnsafe: vi.fn(async () => [tag]),
        $transaction: vi.fn(async () => Promise.reject(rawError(sqlState)))
      } as unknown as PrismaClient
      const repository = createPrismaAdminQuestionCommandRepository({
        auditEnvironment: 'TEST',
        client
      })

      await expect(
        repository.createQuestion(authority, content)
      ).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        disposition: 'DEFINITE_ROLLBACK'
      })
    }
  )

  it('maps the exact cross-question duplicate constraint with write rollback evidence', async () => {
    const client = {
      $queryRawUnsafe: vi.fn(async () => [tag]),
      $transaction: vi.fn(async () =>
        Promise.reject(
          rawError('23514', 'Cross-question canonical duplicate is forbidden.')
        )
      )
    } as unknown as PrismaClient
    const repository = createPrismaAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client
    })

    await expect(
      repository.createQuestion(authority, content)
    ).rejects.toMatchObject({
      code: 'DUPLICATE_QUESTION_CONTENT',
      disposition: 'DEFINITE_ROLLBACK'
    })
  })

  it('keeps an unknown transaction outcome commit-unknown', async () => {
    const client = {
      $queryRawUnsafe: vi.fn(async () => [tag]),
      $transaction: vi.fn(async () =>
        Promise.reject(new Error('connection result unavailable'))
      )
    } as unknown as PrismaClient
    const repository = createPrismaAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client
    })

    await expect(
      repository.createQuestion(authority, content)
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      disposition: 'COMMIT_UNKNOWN'
    })
  })

  it.each([
    [[], [{ outcome: 'AUTH_SESSION_EXPIRED' }], 'AUTH_SESSION_EXPIRED'],
    [[], [{ outcome: 'ADMIN_REQUIRED' }], 'ADMIN_REQUIRED'],
    [
      [
        {
          principalUserId: actorId,
          principalRole: 'USER',
          isFresh: true
        }
      ],
      [],
      'ADMIN_REQUIRED'
    ],
    [
      [
        {
          principalUserId: questionId,
          principalRole: 'ADMIN',
          isFresh: true
        }
      ],
      [],
      'AUTH_SESSION_EXPIRED'
    ],
    [
      [
        {
          principalUserId: actorId,
          principalRole: 'ADMIN',
          isFresh: true
        }
      ],
      [],
      'SERVICE_UNAVAILABLE'
    ]
  ] as const)(
    'classifies a commit authority failure without raw User access',
    async (principalRows, classificationRows, expectedCode) => {
      const query = vi.fn(
        async (statement: string, ..._parameters: unknown[]) =>
          statement.includes('phase7_resolve_v1_principal')
            ? principalRows
            : statement.includes('phase7_classify_admin_authority')
              ? classificationRows
              : [tag]
      )
      const client = {
        $queryRawUnsafe: query,
        $transaction: vi.fn(async () =>
          Promise.reject(
            rawError(
              '42501',
              'Phase 7 operation authority is stale or insufficient.'
            )
          )
        )
      } as unknown as PrismaClient
      const repository = createPrismaAdminQuestionCommandRepository({
        auditEnvironment: 'TEST',
        client
      })

      await expect(
        repository.createQuestion(authority, content)
      ).rejects.toMatchObject({
        code: expectedCode,
        disposition: 'DEFINITE_ROLLBACK'
      })
      const resolverCall = query.mock.calls.find(([statement]) =>
        statement.includes('phase7_resolve_v1_principal')
      )
      expect(resolverCall).toHaveLength(2)
      expect(resolverCall?.[0]).not.toContain('FROM "User"')
      expect(resolverCall?.[1]).toBe(authority.rawSessionToken)
      const classifierCalls = query.mock.calls.filter(([statement]) =>
        statement.includes('phase7_classify_admin_authority')
      )
      expect(classifierCalls).toHaveLength(principalRows.length === 0 ? 1 : 0)
      if (classifierCalls[0]) {
        expect(classifierCalls[0][0]).not.toContain('FROM "User"')
        expect(classifierCalls[0][1]).toBe(authority.rawSessionToken)
      }
    }
  )

  it('rejects an already pinned update before opening a transaction', async () => {
    const transaction = vi.fn()
    const client = {
      $queryRawUnsafe: vi.fn(async (statement: string) => {
        if (statement.includes('FROM "QuestionVersion" AS version')) {
          return [versionTarget({ isPinned: true })]
        }
        if (statement.includes('FROM "QuestionOption"')) return options
        throw new Error(`Unexpected repository query: ${statement}`)
      }),
      $transaction: transaction
    } as unknown as PrismaClient
    const repository = createPrismaAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client
    })

    await expect(
      repository.updateVersion(authority, versionId, update)
    ).rejects.toMatchObject({
      code: 'QUESTION_VERSION_IMMUTABLE',
      disposition: 'NO_TX'
    })
    expect(transaction).not.toHaveBeenCalled()
  })
})
