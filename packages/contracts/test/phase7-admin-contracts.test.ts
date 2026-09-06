/// <reference types="node" />

import { describe, expect, it } from 'vitest'

import {
  adminAuditLogItemSchema,
  adminImportValidationResponseSchema,
  adminQuestionVersionSummarySchema,
  applyQuestionImportErrorSchema,
  assertAdminImportApplyForRequest,
  assertAdminImportValidationForRequest,
  assertCreateQuestionReportForRequest,
  assertGetAdminQuestionForRequest,
  assertListAdminQuestionReportsForRequest,
  assertListAdminQuestionsForRequest,
  assertListAdminTagsForRequest,
  assertPreviewQuestionVersionForRequest,
  assertQuestionReportDescriptionDigest,
  createQuestionReportErrorCodeSchema,
  createQuestionReportErrorSchema,
  decodeAdminQuestionVersionCursor,
  diffQuestionVersionResponseSchema,
  encodeAdminQuestionVersionCursor,
  getAdminQuestionReportErrorCodeSchema,
  listAdminQuestionReportsErrorCodeSchema,
  listAdminQuestionsQuerySchema,
  normalizePhase7TagKey,
  phase7QuestionSearchSchema,
  previewQuestionVersionResponseSchema,
  questionReportDetailSchema,
  resolveAdminQuestionReportErrorCodeSchema,
  resolveAdminQuestionReportErrorSchema,
  triageAdminQuestionReportErrorCodeSchema,
  triageAdminQuestionReportErrorSchema,
  validateQuestionImportErrorSchema,
  type AdminImportItem,
  type Sha256TextPort
} from '../src/admin/phase7.js'

const IDS = {
  admin: '00000000-0000-4000-8000-000000000001',
  question: '00000000-0000-4000-8000-000000000002',
  version: '00000000-0000-4000-8000-000000000003',
  option1: '00000000-0000-4000-8000-000000000004',
  option2: '00000000-0000-4000-8000-000000000005',
  option3: '00000000-0000-4000-8000-000000000006',
  option4: '00000000-0000-4000-8000-000000000007',
  tag: '00000000-0000-4000-8000-000000000008',
  audit: '00000000-0000-4000-8000-000000000009',
  operation: '00000000-0000-4000-8000-00000000000a',
  request: '00000000-0000-4000-8000-00000000000b',
  report: '00000000-0000-4000-8000-00000000000c'
} as const

const adminActor = {
  kind: 'ACCOUNT',
  actorId: IDS.admin,
  role: 'ADMIN',
  label: 'ACTIVE_ADMIN'
} as const

const tag = {
  id: IDS.tag,
  label: '문법',
  normalizedName: '문법'
} as const

const iso = '2026-08-29T00:00:00.000Z'

const sha256Utf8 = async (value: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  )

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const importItem: AdminImportItem = {
  clientItemId: 'item-1',
  content: {
    level: 'N5',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    difficulty: 'NORMAL',
    questionText: '빈칸에 알맞은 표현을 고르세요.',
    passage: null,
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

const createDigestPort = (): {
  readonly port: Sha256TextPort
  readonly inputs: string[]
} => {
  const inputs: string[] = []
  return {
    inputs,
    port: {
      digestUtf8: async (value) => {
        inputs.push(value)
        return 'a'.repeat(64)
      }
    }
  }
}

describe('Phase 7 common and read contracts', () => {
  it('normalizes only tag ASCII case while question q remains NFC case-sensitive', () => {
    expect(normalizePhase7TagKey('  Ä  A  ')).toBe('Ä a')
    expect(phase7QuestionSearchSchema.parse('  Ａbc  ')).toBe('Ａbc')
  })

  it('requires a safe page and rejects unknown query keys', () => {
    expect(
      listAdminQuestionsQuerySchema.safeParse({
        page: Number.MAX_SAFE_INTEGER + 1
      }).success
    ).toBe(false)
    expect(
      listAdminQuestionsQuerySchema.safeParse({ unknown: 'value' }).success
    ).toBe(false)
  })

  it('requires exact remaining item cardinality for offset pages', () => {
    const question = {
      questionId: IDS.question,
      selectedVersionId: IDS.version,
      currentPublishedVersionId: null,
      openCandidateVersionId: IDS.version,
      versionNumber: 1,
      lifecycleStatus: 'ACTIVE',
      versionStatus: 'DRAFT',
      retirementKind: null,
      questionRowVersion: 1,
      versionRowVersion: 1,
      level: 'N5',
      subject: 'GRAMMAR',
      questionType: 'GRAMMAR_SELECT',
      difficulty: 'NORMAL',
      questionTextPreview: '문법 문제',
      tags: [tag],
      author: null,
      latestReviewer: null,
      createdAt: iso,
      updatedAt: iso,
      answerCount: 0,
      correctRateBasisPoints: null,
      openReportCount: 0
    }
    expect(() =>
      assertListAdminQuestionsForRequest(
        { page: 1, pageSize: 20 },
        {
          items: [question, question],
          page: 1,
          pageSize: 20,
          total: 1
        }
      )
    ).toThrow('total bounds')
  })

  it('rejects unknown query keys through shared get and preview assertions', () => {
    expect(() =>
      assertGetAdminQuestionForRequest(
        { questionId: IDS.question },
        { unexpected: true },
        null
      )
    ).toThrow()
    expect(() =>
      assertPreviewQuestionVersionForRequest(
        { versionId: IDS.version },
        { unexpected: true },
        null
      )
    ).toThrow()
  })

  it('round-trips canonical v1 version cursors and rejects padding', () => {
    const cursor = encodeAdminQuestionVersionCursor({
      versionNumber: 3,
      id: IDS.version
    })
    expect(decodeAdminQuestionVersionCursor(cursor)).toEqual({
      v: 1,
      versionNumber: 3,
      id: IDS.version
    })
    expect(() => decodeAdminQuestionVersionCursor(`${cursor}=`)).toThrow()
  })

  it('enforces persisted retirement timestamp/provenance semantics', () => {
    const version = {
      questionVersionId: IDS.version,
      versionNumber: 1,
      versionStatus: 'RETIRED',
      retirementKind: 'PUBLISHED_RETIREMENT',
      rowVersion: 2,
      provenance: 'SYSTEM_SEED',
      level: 'N5',
      subject: 'GRAMMAR',
      questionType: 'GRAMMAR_SELECT',
      difficulty: 'NORMAL',
      questionTextPreview: '문법 문제',
      tags: [tag],
      author: null,
      latestReviewer: null,
      publishedAt: iso,
      retiredAt: '2026-08-29T01:00:00.000Z',
      createdAt: iso,
      updatedAt: '2026-08-29T01:00:00.000Z'
    }
    expect(adminQuestionVersionSummarySchema.parse(version)).toMatchObject(
      version
    )
    expect(
      adminQuestionVersionSummarySchema.safeParse({
        ...version,
        retirementKind: 'QUESTION_ARCHIVE_ABANDONED',
        publishedAt: iso
      }).success
    ).toBe(false)
  })

  it('binds tag autocomplete to normalized prefix and strict order', () => {
    const secondTag = {
      id: '00000000-0000-4000-8000-00000000000d',
      label: '문법 활용',
      normalizedName: '문법 활용'
    }
    expect(
      assertListAdminTagsForRequest(
        { q: '문법', limit: 2 },
        { items: [tag, secondTag] }
      ).items
    ).toHaveLength(2)
    expect(() =>
      assertListAdminTagsForRequest(
        { q: '문법', limit: 2 },
        { items: [secondTag, tag] }
      )
    ).toThrow()
  })

  it('rejects preview option comparison duplicates', () => {
    const preview = {
      question: {
        id: IDS.question,
        questionVersionId: IDS.version,
        level: 'N5',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        passage: null,
        questionText: '문법 문제',
        options: [
          { id: IDS.option1, label: '1', text: 'です' },
          { id: IDS.option2, label: '2', text: ' です ' },
          { id: IDS.option3, label: '3', text: 'でした' },
          { id: IDS.option4, label: '4', text: 'ません' }
        ],
        difficulty: 'NORMAL',
        tags: [{ id: IDS.tag, label: '문법' }]
      },
      adminAnswer: {
        correctOptionId: IDS.option1,
        explanationKo: '설명',
        explanationJa: null
      }
    }
    expect(
      previewQuestionVersionResponseSchema.safeParse(preview).success
    ).toBe(false)
  })

  it('requires canonical unique tags on both sides of TAGS diffs', () => {
    const otherTag = {
      id: '00000000-0000-4000-8000-00000000000d',
      label: '가나',
      normalizedName: '가나'
    }
    expect(
      diffQuestionVersionResponseSchema.safeParse({
        baseVersionId: IDS.version,
        targetVersionId: '00000000-0000-4000-8000-00000000000e',
        changedFields: ['TAGS'],
        changes: [
          {
            field: 'TAGS',
            kind: 'TAGS',
            before: [tag, otherTag],
            after: [otherTag]
          }
        ]
      }).success
    ).toBe(false)
  })

  it('binds scalar diff values to the selected field taxonomy and limits', () => {
    const base = {
      baseVersionId: IDS.version,
      targetVersionId: '00000000-0000-4000-8000-00000000000e'
    }
    expect(
      diffQuestionVersionResponseSchema.safeParse({
        ...base,
        changedFields: ['LEVEL'],
        changes: [
          {
            field: 'LEVEL',
            kind: 'SCALAR',
            before: 'N5',
            after: 'N9'
          }
        ]
      }).success
    ).toBe(false)
    expect(
      diffQuestionVersionResponseSchema.safeParse({
        ...base,
        changedFields: ['QUESTION_TEXT'],
        changes: [
          {
            field: 'QUESTION_TEXT',
            kind: 'SCALAR',
            before: '문법 문제',
            after: ''
          }
        ]
      }).success
    ).toBe(false)
  })

  it('enforces the audit command evidence matrix', () => {
    const audit = {
      id: IDS.audit,
      command: 'REPORT_TRIAGE',
      targetType: 'QUESTION_REPORT',
      targetId: IDS.report,
      actor: adminActor,
      beforeState: 'OPEN',
      afterState: 'TRIAGED',

      beforeRowVersion: 1,
      afterRowVersion: 2,
      changedFields: ['ASSIGNEE', 'REPORT_STATUS'],
      metadata: { kind: 'NONE_V1' },
      contentDigest: 'a'.repeat(64),
      operationId: IDS.operation,
      requestId: IDS.request,
      environment: 'TEST',
      occurredAt: iso
    }
    expect(adminAuditLogItemSchema.parse(audit)).toMatchObject(audit)
    expect(
      adminAuditLogItemSchema.safeParse({
        ...audit,
        changedFields: ['REPORT_STATUS']
      }).success
    ).toBe(false)
  })
})

describe('Phase 7 future import and report contracts', () => {
  it('binds import validation digest, item count, pointer, and issue order', async () => {
    const { port, inputs } = createDigestPort()
    const response = await assertAdminImportValidationForRequest(
      port,
      { items: [importItem] },
      {
        valid: true,
        validationDigest: 'a'.repeat(64),
        itemCount: 1,
        errors: []
      }
    )
    expect(response.valid).toBe(true)
    expect(inputs[0]).toContain('nihongo-admin-import-v1\u0000')

    expect(
      adminImportValidationResponseSchema.safeParse({
        valid: false,
        validationDigest: 'a'.repeat(64),
        itemCount: 1,
        errors: [
          {
            itemIndex: 0,
            fieldPath: '/items/0/content/tagNames/1',
            code: 'DUPLICATE_TAG',
            message: 'b'
          },
          {
            itemIndex: 0,
            fieldPath: '/items/0/content/tagNames/0',
            code: 'DUPLICATE_TAG',
            message: 'a'
          }
        ]
      }).success
    ).toBe(false)
  })

  it('computes and verifies import apply positional mapping digest', async () => {
    const expectedPreimage =
      'nihongo-import-mapping-v1\u0000' +
      '[{"clientItemId":"item-1","questionId":"00000000-0000-4000-8000-000000000002","questionVersionId":"00000000-0000-4000-8000-000000000003"}]'
    const expectedDigest =
      'c46b0ef0cbb1c3cf64729fce77778a331d7fef3a2d26c4faf61953b2db56cbe0'
    const inputs: string[] = []
    const port: Sha256TextPort = {
      digestUtf8: async (value) => {
        inputs.push(value)
        return sha256Utf8(value)
      }
    }
    const assertion = await assertAdminImportApplyForRequest(
      port,
      { validationDigest: 'a'.repeat(64), items: [importItem] },
      {
        createdCount: 1,
        items: [
          {
            clientItemId: 'item-1',
            questionId: IDS.question,
            questionVersionId: IDS.version,
            lifecycleStatus: 'ACTIVE',
            versionStatus: 'DRAFT',
            questionRowVersion: 1,
            versionRowVersion: 1
          }
        ],
        occurredAt: iso
      },
      expectedDigest
    )
    expect(assertion.mappingDigest).toBe(expectedDigest)
    expect(inputs).toEqual([expectedPreimage])
  })

  it('binds report create initial state and validates description digest', async () => {
    const mutation = {
      id: IDS.report,
      questionId: IDS.question,
      questionVersionId: IDS.version,
      status: 'OPEN',
      rowVersion: 1,
      assignee: null,
      resolution: null,
      createdAt: iso,
      updatedAt: iso
    }
    expect(
      assertCreateQuestionReportForRequest(
        {
          questionVersionId: IDS.version,
          reason: 'OTHER',
          description: '설명'
        },
        mutation
      )
    ).toMatchObject(mutation)

    const detail = questionReportDetailSchema.parse({
      ...mutation,
      reason: 'OTHER',
      reporter: adminActor,
      description: '설명',
      descriptionDigest: 'a'.repeat(64)
    })
    const { port, inputs } = createDigestPort()
    await expect(
      assertQuestionReportDescriptionDigest(port, detail)
    ).resolves.toBe(undefined)
    expect(inputs[0]).toBe('nihongo-question-report-description-v1\u0000설명')
  })

  it('requires exact remaining report count and operation-specific errors', () => {
    const report = {
      id: IDS.report,
      questionId: IDS.question,
      questionVersionId: IDS.version,
      reason: 'OTHER',
      status: 'OPEN',
      rowVersion: 1,
      reporter: adminActor,
      assignee: null,
      createdAt: iso,
      updatedAt: iso
    }
    expect(() =>
      assertListAdminQuestionReportsForRequest(
        { page: 1, pageSize: 20 },
        {
          items: [report, report],
          page: 1,
          pageSize: 20,
          total: 1
        }
      )
    ).toThrow('total bounds')

    expect(
      listAdminQuestionReportsErrorCodeSchema.safeParse('INVALID_ID').success
    ).toBe(false)
    expect(
      getAdminQuestionReportErrorCodeSchema.safeParse('INVALID_ID').success
    ).toBe(true)
    expect(
      getAdminQuestionReportErrorCodeSchema.safeParse('VALIDATION_ERROR')
        .success
    ).toBe(false)
  })

  it('accepts every common JSON-write transport error and rejects CSRF', () => {
    expect(createQuestionReportErrorCodeSchema.options).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'INVALID_JSON',
      'INVALID_REQUEST',
      'REQUEST_TOO_LARGE',
      'VALIDATION_ERROR',
      'RESOURCE_NOT_FOUND',
      'QUESTION_REPORT_DUPLICATE',
      'UNTRUSTED_ORIGIN',
      'RATE_LIMITED',
      'INTERNAL_SERVER_ERROR',
      'SERVICE_UNAVAILABLE'
    ])
    expect(triageAdminQuestionReportErrorCodeSchema.options).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'ADMIN_REQUIRED',
      'INVALID_ID',
      'INVALID_JSON',
      'INVALID_REQUEST',
      'REQUEST_TOO_LARGE',
      'VALIDATION_ERROR',
      'RESOURCE_NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION',
      'UNTRUSTED_ORIGIN',
      'RATE_LIMITED',
      'INTERNAL_SERVER_ERROR',
      'SERVICE_UNAVAILABLE'
    ])
    expect(resolveAdminQuestionReportErrorCodeSchema.options).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'ADMIN_REQUIRED',
      'FRESH_ASSURANCE_REQUIRED',
      'INVALID_ID',
      'INVALID_JSON',
      'INVALID_REQUEST',
      'REQUEST_TOO_LARGE',
      'VALIDATION_ERROR',
      'RESOURCE_NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION',
      'UNTRUSTED_ORIGIN',
      'RATE_LIMITED',
      'INTERNAL_SERVER_ERROR',
      'SERVICE_UNAVAILABLE'
    ])

    const schemas = [
      validateQuestionImportErrorSchema,
      applyQuestionImportErrorSchema,
      createQuestionReportErrorSchema,
      triageAdminQuestionReportErrorSchema,
      resolveAdminQuestionReportErrorSchema
    ]
    const failure = {
      message: 'transport failure',
      requestId: IDS.request,
      retryable: false
    }
    const transportCodes = ['INVALID_REQUEST', 'UNTRUSTED_ORIGIN'] as const
    schemas.forEach((schema) => {
      transportCodes.forEach((code) => {
        expect(schema.safeParse({ ...failure, code }).success).toBe(true)
      })
      expect(
        schema.safeParse({ ...failure, code: 'INVALID_CSRF' }).success
      ).toBe(false)
    })
  })
})
