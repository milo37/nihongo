import { createHash } from 'node:crypto'
import {
  createAdminImportValidationDigest,
  exportAdminQuestionsRequestSchema,
  requestContentReviewBatchRequestSchema,
  type AdminImportItem,
  type Sha256TextPort
} from '@nihongo/contracts/admin/phase7'
import { describe, expect, it, vi } from 'vitest'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import type { AdminCommandAuthority } from './adminQuestionCommandRepository.js'
import { createPrismaAdminQuestionSlice5Repository } from './adminQuestionSlice5Repository.js'

const ids = {
  actor: '019d0000-0000-7000-8000-000000000001',
  request: '019d0000-0000-7000-8000-000000000002',
  tag: '019d0000-0000-7000-8000-000000000003'
} as const

const authority: AdminCommandAuthority = {
  actorId: ids.actor,
  rawSessionToken: 'phase7-slice5-session',
  requestId: ids.request
}

const sha256Port: Sha256TextPort = {
  digestUtf8: async (value) =>
    createHash('sha256').update(value, 'utf8').digest('hex')
}

const rawError = (sqlState: string, message: string) =>
  new Prisma.PrismaClientKnownRequestError(message, {
    clientVersion: '7.9.1',
    code: 'P2010',
    meta: { code: sqlState, message }
  })

const item = (suffix: string): AdminImportItem => ({
  clientItemId: `item-${suffix}`,
  content: {
    level: 'N5',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    difficulty: 'NORMAL',
    passage: null,
    questionText: `빈칸에 알맞은 표현을 고르세요. ${suffix}`,
    explanationKo: `문법 설명 ${suffix}`,
    explanationJa: null,
    tagNames: ['문법'],
    options: [
      { clientOptionKey: 'a', text: `です-${suffix}` },
      { clientOptionKey: 'b', text: `ます-${suffix}` },
      { clientOptionKey: 'c', text: `でした-${suffix}` },
      { clientOptionKey: 'd', text: `ません-${suffix}` }
    ],
    correctOptionKey: 'a'
  }
})

const applicableTag = {
  id: ids.tag,
  label: '문법',
  normalizedName: '문법',
  level: 'N5',
  subject: 'GRAMMAR',
  questionType: 'GRAMMAR_SELECT'
} as const

const createClient = ({
  tags = [applicableTag],
  transaction
}: {
  readonly tags?: readonly (typeof applicableTag)[]
  readonly transaction?: PrismaClient['$transaction']
} = {}) => {
  const query = vi.fn(async (statement: string) => {
    if (statement.includes('FROM "Tag" AS tag')) return tags
    if (statement.includes('SELECT DISTINCT "contentFingerprint"')) return []
    throw new Error(`Unexpected query: ${statement}`)
  })
  const transact =
    transaction ?? vi.fn(async () => Promise.reject(new Error('not used')))
  const client = {
    $queryRawUnsafe: query,
    $transaction: transact
  } as unknown as PrismaClient
  return { client, query, transact }
}

describe('Phase 7 Slice 5 repository preflight', () => {
  it('returns semantic import failure before opening a transaction', async () => {
    const candidate = item('unknown-tag')
    const validationDigest = await createAdminImportValidationDigest(
      sha256Port,
      [candidate]
    )
    const fixture = createClient({ tags: [] })
    const repository = createPrismaAdminQuestionSlice5Repository({
      auditEnvironment: 'TEST',
      client: fixture.client
    })

    await expect(
      repository.applyImport(authority, {
        items: [candidate],
        validationDigest
      })
    ).rejects.toMatchObject({
      code: 'IMPORT_VALIDATION_FAILED',
      disposition: 'NO_TX',
      fieldErrors: {
        '/items/0/content/tagNames/0': [
          '존재하며 문제 분류에 적용 가능한 태그가 필요합니다.'
        ]
      }
    })
    expect(fixture.transact).not.toHaveBeenCalled()
  })

  it('rejects a mismatched validation digest before opening a transaction', async () => {
    const candidate = item('digest-mismatch')
    const fixture = createClient()
    const repository = createPrismaAdminQuestionSlice5Repository({
      auditEnvironment: 'TEST',
      client: fixture.client
    })

    await expect(
      repository.applyImport(authority, {
        items: [candidate],
        validationDigest: '0'.repeat(64)
      })
    ).rejects.toMatchObject({
      code: 'IMPORT_IDENTITY_CONFLICT',
      disposition: 'NO_TX'
    })
    expect(fixture.query).not.toHaveBeenCalled()
    expect(fixture.transact).not.toHaveBeenCalled()
  })

  it('classifies an unexpected callback failure as a definite rollback', async () => {
    const candidate = item('callback-failure')
    const validationDigest = await createAdminImportValidationDigest(
      sha256Port,
      [candidate]
    )
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        $queryRawUnsafe: vi
          .fn()
          .mockRejectedValue(new Error('begin operation failed'))
      })
    ) as unknown as PrismaClient['$transaction']
    const fixture = createClient({ transaction })
    const repository = createPrismaAdminQuestionSlice5Repository({
      auditEnvironment: 'TEST',
      client: fixture.client
    })

    await expect(
      repository.applyImport(authority, {
        items: [candidate],
        validationDigest
      })
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      disposition: 'DEFINITE_ROLLBACK'
    })
    expect(fixture.transact).toHaveBeenCalledOnce()
  })

  it('uses Unicode White_Space comparison and does not trim FEFF', async () => {
    const candidate = item('unicode-boundary')
    candidate.content.options[1]!.text = `\ufeff${candidate.content.options[0]!.text}\ufeff`
    const fixture = createClient()
    const repository = createPrismaAdminQuestionSlice5Repository({
      auditEnvironment: 'TEST',
      client: fixture.client
    })

    await expect(
      repository.validateImport({ items: [candidate] })
    ).resolves.toMatchObject({ valid: true, errors: [] })
  })

  it('rechecks earlier batch targets before returning a later missing-target failure', async () => {
    const firstQuestionId = '019d0000-0000-7000-8000-000000000060'
    const firstVersionId = '019d0000-0000-7000-8000-000000000061'
    const missingVersionId = '019d0000-0000-7000-8000-000000000062'
    const operationId = '019d0000-0000-7000-8000-000000000063'
    const preflightTarget = {
      questionId: firstQuestionId,
      questionLifecycleStatus: 'ACTIVE',
      questionRowVersion: 1,
      questionCreatedByUserId: ids.actor,
      versionId: firstVersionId,
      versionStatus: 'DRAFT',
      versionRowVersion: 1,
      versionCreatedByUserId: ids.actor
    } as const
    let armedManifest: unknown
    const transactionQuery = vi.fn(
      async (statement: string, ...parameters: unknown[]) => {
        if (statement.includes('phase7_begin_admin_operation')) {
          return [{ actorUserId: ids.actor, operationId }]
        }
        if (statement.includes('phase7_arm_admin_operation')) {
          armedManifest = JSON.parse(String(parameters[1])) as unknown
          throw rawError(
            '40001',
            'Phase 7 QuestionVersion target changed before arm.'
          )
        }
        throw new Error(`Unexpected transaction query: ${statement}`)
      }
    )
    const transactionExecute = vi.fn(async () => 0)
    const transaction = {
      $executeRawUnsafe: transactionExecute,
      $queryRawUnsafe: transactionQuery
    }
    const client = {
      $queryRawUnsafe: vi.fn(async (statement: string) => {
        if (statement.includes('FROM "QuestionVersion" AS version')) {
          return [preflightTarget]
        }
        throw new Error(`Unexpected client query: ${statement}`)
      }),
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction)
      )
    } as unknown as PrismaClient
    const repository = createPrismaAdminQuestionSlice5Repository({
      auditEnvironment: 'TEST',
      client
    })

    await expect(
      repository.requestReviewBatch(
        authority,
        requestContentReviewBatchRequestSchema.parse({
          items: [
            { versionId: firstVersionId, expectedRowVersion: 1 },
            { versionId: missingVersionId, expectedRowVersion: 1 }
          ]
        })
      )
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      disposition: 'DEFINITE_ROLLBACK'
    })
    expect(armedManifest).toEqual({
      questions: [{ id: firstQuestionId, rowVersion: 1, state: 'ACTIVE' }],
      versions: [{ id: firstVersionId, rowVersion: 1, state: 'DRAFT' }],
      reports: [],
      tags: []
    })
    expect(transactionExecute).not.toHaveBeenCalled()
  })

  it('rolls back before arm or audit when export reaches 8 MiB plus one byte', async () => {
    const questionId = '019d0000-0000-7000-8000-000000000010'
    const operationId = '019d0000-0000-7000-8000-000000000011'
    const exportedAt = new Date('2026-09-28T00:00:00.000Z')
    const uuidFor = (value: number): string =>
      `019d0000-0000-7000-8000-${value.toString().padStart(12, '0')}`
    const versions = Array.from({ length: 400 }, (_, index) => ({
      id: uuidFor(1000 + index),
      questionId,
      versionNumber: index + 1,
      status: index === 399 ? 'PUBLISHED' : 'RETIRED',
      rowVersion: 1,
      createdByUserId: ids.actor,
      level: 'N5',
      subject: 'READING',
      questionType: 'SHORT_READING',
      difficulty: 'NORMAL',
      passage: 'p'.repeat(10_000),
      questionText: 'q'.repeat(2_000),
      explanationKo: 'k'.repeat(5_000),
      explanationJa: 'j'.repeat(5_000),
      correctOptionId: uuidFor(10_000 + index * 10 + 1)
    }))
    const transactionQuery = vi.fn(
      async (statement: string, ...parameters: unknown[]) => {
        if (statement.includes('phase7_begin_admin_operation')) {
          return [{ actorUserId: ids.actor, operationId }]
        }
        if (statement.includes('transaction_timestamp()')) {
          return [{ exportedAt }]
        }
        if (statement.includes('FROM "Question" WHERE')) {
          return [
            {
              id: questionId,
              lifecycleStatus: 'ACTIVE',
              currentPublishedVersionId: versions.at(-1)!.id,
              rowVersion: 1,
              createdByUserId: ids.actor
            }
          ]
        }
        if (
          statement.includes('FROM "QuestionVersion"') &&
          statement.includes('LIMIT $4')
        ) {
          const cursorVersion = parameters[1]
          const start = typeof cursorVersion === 'number' ? cursorVersion : 0
          return versions.slice(start, start + 25)
        }
        if (statement.includes('FROM "QuestionOption"')) {
          const versionIds = parameters[0] as readonly string[]
          return versionIds.flatMap((versionId) => {
            const versionIndex = versions.findIndex(
              (version) => version.id === versionId
            )
            return Array.from({ length: 4 }, (_, optionIndex) => ({
              id: uuidFor(10_000 + versionIndex * 10 + optionIndex + 1),
              questionVersionId: versionId,
              ordinal: optionIndex + 1,
              text: String(optionIndex + 1).repeat(500)
            }))
          })
        }
        if (statement.includes('FROM "QuestionVersionTag"')) return []
        throw new Error(`Unexpected transaction query: ${statement}`)
      }
    )
    const transactionExecute = vi.fn(async () => 0)
    const transaction = {
      $executeRawUnsafe: transactionExecute,
      $queryRawUnsafe: transactionQuery
    }
    const clientQuery = vi.fn(async (statement: string) => {
      if (statement.includes('SELECT DISTINCT live_user."userId"')) return []
      throw new Error(`Unexpected client query: ${statement}`)
    })
    const client = {
      $queryRawUnsafe: clientQuery,
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => unknown) =>
          callback(transaction)
      )
    } as unknown as PrismaClient
    const repository = createPrismaAdminQuestionSlice5Repository({
      auditEnvironment: 'TEST',
      client
    })

    await expect(
      repository.exportQuestions(
        authority,
        exportAdminQuestionsRequestSchema.parse({ questionIds: [questionId] })
      )
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      disposition: 'DEFINITE_ROLLBACK'
    })
    const statements = transactionQuery.mock.calls.map(([statement]) =>
      String(statement)
    )
    expect(
      statements.some((statement) =>
        statement.includes('phase7_arm_admin_operation')
      )
    ).toBe(false)
    expect(
      statements.some((statement) =>
        statement.includes('INSERT INTO "AdminAuditLog"')
      )
    ).toBe(false)
    expect(transactionExecute).toHaveBeenCalledTimes(1)
  })

  it.each([
    { label: 'tail', loadedNumbers: [1], retainedNumbers: [1, 2] },
    { label: 'middle', loadedNumbers: [1, 3], retainedNumbers: [1, 2, 3] }
  ])(
    'rejects retained-version $label omission before arm or audit',
    async ({ loadedNumbers, retainedNumbers }) => {
      const questionId = '019d0000-0000-7000-8000-000000000020'
      const operationId = '019d0000-0000-7000-8000-000000000021'
      const exportedAt = new Date('2026-09-28T00:00:00.000Z')
      const versionId = (versionNumber: number): string =>
        `019d0000-0000-7000-8000-${(20_000 + versionNumber)
          .toString()
          .padStart(12, '0')}`
      const loadedVersions = loadedNumbers.map((versionNumber) => ({
        id: versionId(versionNumber),
        questionId,
        versionNumber,
        status: 'RETIRED',
        rowVersion: 1,
        createdByUserId: ids.actor,
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        difficulty: 'NORMAL',
        passage: null,
        questionText: `question-${versionNumber}`,
        explanationKo: `explanation-${versionNumber}`,
        explanationJa: null,
        correctOptionId: versionId(100 + versionNumber)
      }))
      const transactionQuery = vi.fn(async (statement: string) => {
        if (statement.includes('phase7_begin_admin_operation')) {
          return [{ actorUserId: ids.actor, operationId }]
        }
        if (statement.includes('transaction_timestamp()')) {
          return [{ exportedAt }]
        }
        if (statement.includes('FROM "Question" WHERE')) {
          return [
            {
              id: questionId,
              lifecycleStatus: 'ARCHIVED',
              currentPublishedVersionId: null,
              rowVersion: 1,
              createdByUserId: ids.actor
            }
          ]
        }
        if (
          statement.includes('FROM "QuestionVersion"') &&
          statement.includes('LIMIT $4')
        ) {
          return loadedVersions
        }
        if (
          statement.includes('FROM "QuestionOption"') ||
          statement.includes('FROM "QuestionVersionTag"')
        ) {
          return []
        }
        if (statement.includes('array_agg("id"::text')) {
          return [
            {
              questionId,
              versionCount: BigInt(retainedNumbers.length),
              maxVersionNumber: Math.max(...retainedNumbers),
              orderedVersionIds: retainedNumbers.map(versionId)
            }
          ]
        }
        throw new Error(`Unexpected transaction query: ${statement}`)
      })
      const transactionExecute = vi.fn(async () => 0)
      const transaction = {
        $executeRawUnsafe: transactionExecute,
        $queryRawUnsafe: transactionQuery
      }
      const client = {
        $queryRawUnsafe: vi.fn(async (statement: string) => {
          if (statement.includes('SELECT DISTINCT live_user."userId"')) {
            return []
          }
          throw new Error(`Unexpected client query: ${statement}`)
        }),
        $transaction: vi.fn(
          async (callback: (tx: typeof transaction) => unknown) =>
            callback(transaction)
        )
      } as unknown as PrismaClient
      const repository = createPrismaAdminQuestionSlice5Repository({
        auditEnvironment: 'TEST',
        client
      })

      await expect(
        repository.exportQuestions(
          authority,
          exportAdminQuestionsRequestSchema.parse({
            questionIds: [questionId]
          })
        )
      ).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        disposition: 'DEFINITE_ROLLBACK'
      })
      const statements = transactionQuery.mock.calls.map(([statement]) =>
        String(statement)
      )
      expect(
        statements.some((statement) =>
          statement.includes('phase7_arm_admin_operation')
        )
      ).toBe(false)
      expect(
        statements.some((statement) =>
          statement.includes('INSERT INTO "AdminAuditLog"')
        )
      ).toBe(false)
      expect(transactionExecute).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    { label: 'exact', matches: true },
    { label: 'mismatched', matches: false }
  ])(
    'accepts only $label audit evidence after an export commit acknowledgement loss',
    async ({ matches }) => {
      const questionId = '019d0000-0000-7000-8000-000000000030'
      const versionId = '019d0000-0000-7000-8000-000000000031'
      const operationId = '019d0000-0000-7000-8000-000000000032'
      const optionIds = [
        '019d0000-0000-7000-8000-000000000041',
        '019d0000-0000-7000-8000-000000000042',
        '019d0000-0000-7000-8000-000000000043',
        '019d0000-0000-7000-8000-000000000044'
      ] as const
      const tagId = '019d0000-0000-7000-8000-000000000050'
      const exportedAt = new Date('2026-09-28T00:00:00.000Z')
      const contentDigest = 'a'.repeat(64)
      let auditArguments: readonly unknown[] | undefined
      const transactionQuery = vi.fn(
        async (statement: string, ...parameters: unknown[]) => {
          if (statement.includes('phase7_begin_admin_operation')) {
            return [{ actorUserId: ids.actor, operationId }]
          }
          if (statement.includes('transaction_timestamp()')) {
            return [{ exportedAt }]
          }
          if (statement.includes('FROM "Question" WHERE')) {
            return [
              {
                id: questionId,
                lifecycleStatus: 'ACTIVE',
                currentPublishedVersionId: versionId,
                rowVersion: 1,
                createdByUserId: ids.actor
              }
            ]
          }
          if (
            statement.includes('FROM "QuestionVersion"') &&
            statement.includes('LIMIT $4')
          ) {
            return [
              {
                id: versionId,
                questionId,
                versionNumber: 1,
                status: 'PUBLISHED',
                rowVersion: 1,
                createdByUserId: ids.actor,
                level: 'N5',
                subject: 'VOCABULARY',
                questionType: 'KANJI_READING',
                difficulty: 'NORMAL',
                passage: null,
                questionText: '漢字の読み方を選んでください。',
                explanationKo: '한자의 올바른 읽기를 고릅니다.',
                explanationJa: null,
                correctOptionId: optionIds[0]
              }
            ]
          }
          if (statement.includes('FROM "QuestionOption"')) {
            return optionIds.map((id, index) => ({
              id,
              questionVersionId: versionId,
              ordinal: index + 1,
              text: ['かんじ', 'もじ', 'ことば', 'ぶんぽう'][index]
            }))
          }
          if (statement.includes('FROM "QuestionVersionTag"')) {
            return [
              {
                questionVersionId: versionId,
                id: tagId,
                label: '한자',
                normalizedName: '한자'
              }
            ]
          }
          if (statement.includes('array_agg("id"::text')) {
            return [
              {
                questionId,
                versionCount: 1n,
                maxVersionNumber: 1,
                orderedVersionIds: [versionId]
              }
            ]
          }
          if (statement.includes('phase7_arm_admin_operation')) {
            return [{ occurredAt: exportedAt }]
          }
          if (statement.includes('INSERT INTO "AdminAuditLog"')) {
            auditArguments = parameters
            return [{ contentDigest }]
          }
          throw new Error(`Unexpected transaction query: ${statement}`)
        }
      )
      const transaction = {
        $executeRawUnsafe: vi.fn(async () => 0),
        $queryRawUnsafe: transactionQuery
      }
      const clientQuery = vi.fn(async (statement: string) => {
        if (statement.includes('SELECT DISTINCT live_user."userId"')) {
          return []
        }
        if (statement.includes('FROM "AdminAuditLog"')) {
          if (!auditArguments) return []
          return [
            {
              operationId: auditArguments[10],
              command: auditArguments[0],
              targetType: auditArguments[1],
              targetId: auditArguments[2],
              actorId: auditArguments[3],
              requestId: auditArguments[11],
              environment: auditArguments[12],
              changedFields: JSON.parse(String(auditArguments[8])) as unknown,
              metadata: JSON.parse(String(auditArguments[9])) as unknown,
              contentDigest: matches ? contentDigest : 'b'.repeat(64),
              occurredAt: auditArguments[13]
            }
          ]
        }
        throw new Error(`Unexpected client query: ${statement}`)
      })
      const client = {
        $queryRawUnsafe: clientQuery,
        $transaction: vi.fn(
          async (callback: (tx: typeof transaction) => unknown) => {
            await callback(transaction)
            throw new Error('export commit acknowledgement was lost')
          }
        )
      } as unknown as PrismaClient
      const repository = createPrismaAdminQuestionSlice5Repository({
        auditEnvironment: 'TEST',
        client
      })
      const exportPromise = repository.exportQuestions(
        authority,
        exportAdminQuestionsRequestSchema.parse({ questionIds: [questionId] })
      )

      if (matches) {
        const result = await exportPromise
        expect(JSON.parse(result.canonicalBody)).toEqual(result.document)
        expect(result.auditEvidence).toMatchObject({
          questionCount: 1,
          versionCount: 1
        })
      } else {
        await expect(exportPromise).rejects.toMatchObject({
          code: 'SERVICE_UNAVAILABLE',
          disposition: 'COMMIT_UNKNOWN'
        })
      }
      expect(
        clientQuery.mock.calls.filter(([statement]) =>
          String(statement).includes('FROM "AdminAuditLog"')
        )
      ).toHaveLength(1)
    }
  )
})
