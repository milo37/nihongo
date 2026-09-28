import { describe, expect, it } from 'vitest'

import {
  adminQuestionExportAttachmentHeadersSchema,
  adminQuestionExportContentDisposition,
  adminQuestionExportContentType,
  adminQuestionExportDocumentV1Schema,
  exportAdminQuestionsAttachmentBodyResponseSchema,
  approveQuestionVersionErrorCodeSchema,
  archiveAdminQuestionErrorCodeSchema,
  archiveAdminQuestionRequestSchema,
  assertAdminQuestionExportDocumentForRequest,
  assertAdminQuestionExportDocumentSemantics,
  assertApproveQuestionVersionResponse,
  assertArchiveAdminQuestionResponse,
  assertCreateAdminQuestionResponse,
  assertCreateAdminQuestionVersionResponse,
  assertPublishQuestionVersionResponse,
  assertRequestContentReviewBatchResponse,
  assertRequestContentReviewResponse,
  assertRequestQuestionChangesResponse,
  assertRetireQuestionVersionResponse,
  assertUpdateQuestionVersionResponse,
  assertWithdrawQuestionApprovalResponse,
  createAdminQuestionErrorCodeSchema,
  createAdminQuestionErrorSchema,
  createAdminQuestionRequestSchema,
  createAdminQuestionVersionErrorCodeSchema,
  createAdminQuestionVersionRequestSchema,
  exportAdminQuestionsErrorCodeSchema,
  exportAdminQuestionsRequestSchema,
  publishQuestionVersionErrorCodeSchema,
  reauthenticateAdminErrorCodeSchema,
  reauthenticateAdminRequestSchema,
  reauthenticateAdminResponseSchema,
  requestContentReviewBatchErrorCodeSchema,
  requestContentReviewBatchRequestSchema,
  requestContentReviewErrorCodeSchema,
  requestContentReviewRequestSchema,
  requestQuestionChangesErrorCodeSchema,
  requestQuestionChangesRequestSchema,
  retireQuestionVersionErrorCodeSchema,
  updateQuestionVersionErrorCodeSchema,
  updateQuestionVersionRequestSchema,
  withdrawQuestionApprovalErrorCodeSchema,
  type AdminQuestionExportDocumentV1,
  type AdminQuestionMutationResult
} from './phase7-commands.js'

const id = (index: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-${index.toString(16).padStart(12, '0')}`

const questionId = id(1)
const versionId = id(2)
const occurredAt = '2026-08-29T03:00:00.000Z'

const createContent = {
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  difficulty: 'NORMAL',
  questionText: '「山」の読み方を選んでください。',
  passage: null,
  explanationKo: '「山」は やま라고 읽습니다.',
  explanationJa: null,
  tagNames: ['kana'],
  options: [
    { clientOptionKey: 'a', text: 'やま' },
    { clientOptionKey: 'b', text: 'かわ' },
    { clientOptionKey: 'c', text: 'そら' },
    { clientOptionKey: 'd', text: 'みち' }
  ],
  correctOptionKey: 'a'
} as const

const updateContent = {
  level: createContent.level,
  subject: createContent.subject,
  questionType: createContent.questionType,
  difficulty: createContent.difficulty,
  questionText: createContent.questionText,
  passage: createContent.passage,
  explanationKo: createContent.explanationKo,
  explanationJa: createContent.explanationJa,
  tagNames: createContent.tagNames,
  options: [
    { id: id(10), ordinal: 4, text: 'やま' },
    { id: id(11), ordinal: 2, text: 'かわ' },
    { id: id(12), ordinal: 1, text: 'そら' },
    { id: id(13), ordinal: 3, text: 'みち' }
  ],
  correctOptionId: id(10)
} as const

const mutationResult = (
  status: AdminQuestionMutationResult['versionStatus'],
  rowVersion: number,
  overrides: Partial<AdminQuestionMutationResult> = {}
): AdminQuestionMutationResult => ({
  questionId,
  questionVersionId: versionId,
  lifecycleStatus: 'ACTIVE',
  versionStatus: status,
  questionRowVersion: 7,
  versionRowVersion: rowVersion,
  occurredAt,
  ...overrides
})

const exportDocument: AdminQuestionExportDocumentV1 = {
  schemaVersion: 'admin-question-export-v1',
  exportedAt: occurredAt,
  questions: [
    {
      questionId,
      lifecycleStatus: 'ACTIVE',
      currentPublishedVersionId: versionId,
      versions: [
        {
          questionVersionId: versionId,
          versionNumber: 1,
          versionStatus: 'PUBLISHED',
          content: {
            level: 'N5',
            subject: 'VOCABULARY',
            questionType: 'KANJI_READING',
            difficulty: 'NORMAL',
            passage: null,
            questionText: createContent.questionText,
            explanationKo: createContent.explanationKo,
            explanationJa: null,
            options: [
              { id: id(20), ordinal: 1, text: 'やま' },
              { id: id(21), ordinal: 2, text: 'かわ' },
              { id: id(22), ordinal: 3, text: 'そら' },
              { id: id(23), ordinal: 4, text: 'みち' }
            ],
            correctOptionId: id(20),
            tags: [{ id: id(30), label: 'Kana', normalizedName: 'kana' }]
          }
        }
      ]
    }
  ]
}

const digestPort = {
  digestUtf8: async (value: string): Promise<string> => {
    let state = 2_166_136_261
    for (const character of value) {
      state = Math.imul(state ^ (character.codePointAt(0) ?? 0), 16_777_619)
    }
    return (state >>> 0).toString(16).padStart(8, '0').repeat(8)
  }
}

const commonJsonWriteCodes = [
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'ADMIN_REQUIRED',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'REQUEST_TOO_LARGE',
  'VALIDATION_ERROR',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
] as const

const expectExactCodes = (
  actual: readonly string[],
  domainCodes: readonly string[]
): void => {
  const expected = new Set([...commonJsonWriteCodes, ...domainCodes])
  expect(actual.length).toBe(expected.size)
  expect(new Set(actual)).toEqual(expected)
}

describe('Phase 7 admin command contracts', () => {
  it('create/version/PATCH full content를 strict semantic input으로 닫는다', () => {
    expect(createAdminQuestionRequestSchema.parse(createContent)).toEqual(
      createContent
    )
    expect(
      createAdminQuestionRequestSchema.safeParse({
        ...createContent,
        authorActorId: id(99)
      }).success
    ).toBe(false)
    expect(
      createAdminQuestionRequestSchema.safeParse({
        ...createContent,
        options: [
          createContent.options[0],
          { ...createContent.options[1], clientOptionKey: 'a' },
          createContent.options[2],
          createContent.options[3]
        ]
      }).success
    ).toBe(false)

    expect(
      createAdminQuestionVersionRequestSchema.parse({
        ...createContent,
        expectedQuestionRowVersion: 4
      }).expectedQuestionRowVersion
    ).toBe(4)
    expect(
      createAdminQuestionVersionRequestSchema.safeParse({
        ...createContent,
        expectedQuestionRowVersion: 4,
        baseVersionId: versionId
      }).success
    ).toBe(false)

    expect(
      updateQuestionVersionRequestSchema
        .parse({
          ...updateContent,
          expectedRowVersion: 3
        })
        .options.map((option) => option.ordinal)
    ).toEqual([4, 2, 1, 3])
    expect(
      updateQuestionVersionRequestSchema.safeParse({
        ...updateContent,
        expectedRowVersion: 3,
        options: updateContent.options.map((option) => ({
          ...option,
          ordinal: 1
        }))
      }).success
    ).toBe(false)
    expect(
      updateQuestionVersionRequestSchema.safeParse({
        ...updateContent,
        expectedRowVersion: 3,
        correctOptionId: id(999)
      }).success
    ).toBe(false)
    expect(
      updateQuestionVersionRequestSchema.safeParse({
        ...updateContent,
        expectedRowVersion: 3,
        options: updateContent.options.map((option) => ({
          ...option,
          label: String(option.ordinal)
        }))
      }).success
    ).toBe(false)
  })

  it('small command, archive pair, batch, export와 opaque password 경계를 고정한다', () => {
    expect(
      archiveAdminQuestionRequestSchema.parse({
        expectedQuestionRowVersion: 2,
        expectedOpenCandidateVersionId: null,
        expectedOpenCandidateRowVersion: null
      })
    ).toMatchObject({ expectedQuestionRowVersion: 2 })
    expect(
      archiveAdminQuestionRequestSchema.safeParse({
        expectedQuestionRowVersion: 2,
        expectedOpenCandidateVersionId: versionId,
        expectedOpenCandidateRowVersion: null
      }).success
    ).toBe(false)

    expect(
      requestContentReviewRequestSchema.parse({
        expectedRowVersion: 1,
        comment: '  검수\r\n요청  '
      }).comment
    ).toBe('검수\n요청')

    expect(
      requestContentReviewRequestSchema.safeParse({
        expectedRowVersion: 1,
        comment: '가'.repeat(1000)
      }).success
    ).toBe(true)
    expect(
      requestContentReviewRequestSchema.safeParse({
        expectedRowVersion: 1,
        comment: '가'.repeat(1001)
      }).success
    ).toBe(false)
    expect(
      requestQuestionChangesRequestSchema.safeParse({
        expectedRowVersion: 1,
        reason: '가'.repeat(100)
      }).success
    ).toBe(true)
    expect(
      requestQuestionChangesRequestSchema.safeParse({
        expectedRowVersion: 1,
        reason: '가'.repeat(101)
      }).success
    ).toBe(false)

    const twentyItems = Array.from({ length: 20 }, (_, index) => ({
      versionId: id(100 + index),
      expectedRowVersion: index + 1
    }))
    expect(
      requestContentReviewBatchRequestSchema.parse({ items: twentyItems }).items
    ).toHaveLength(20)
    expect(
      requestContentReviewBatchRequestSchema.safeParse({
        items: [twentyItems[0], twentyItems[0]]
      }).success
    ).toBe(false)
    expect(
      requestContentReviewBatchRequestSchema.safeParse({
        items: [...twentyItems, { versionId: id(200), expectedRowVersion: 1 }]
      }).success
    ).toBe(false)

    const oneHundredIds = Array.from({ length: 100 }, (_, index) =>
      id(300 + index)
    )
    expect(
      exportAdminQuestionsRequestSchema.parse({ questionIds: oneHundredIds })
        .questionIds
    ).toHaveLength(100)
    expect(
      exportAdminQuestionsRequestSchema.safeParse({
        questionIds: [questionId, questionId.toUpperCase()]
      }).success
    ).toBe(false)
    expect(
      exportAdminQuestionsRequestSchema.safeParse({
        questionIds: [...oneHundredIds, id(500)]
      }).success
    ).toBe(false)

    const opaquePassword = '  1234567890  '
    expect(
      reauthenticateAdminRequestSchema.parse({ password: opaquePassword })
        .password
    ).toBe(opaquePassword)
    expect(
      reauthenticateAdminRequestSchema.safeParse({ password: '😀'.repeat(6) })
        .success
    ).toBe(true)
    expect(
      reauthenticateAdminRequestSchema.safeParse({ password: 'a'.repeat(11) })
        .success
    ).toBe(false)
    expect(
      reauthenticateAdminRequestSchema.safeParse({ password: 'a'.repeat(12) })
        .success
    ).toBe(true)
    expect(
      reauthenticateAdminRequestSchema.safeParse({ password: 'a'.repeat(128) })
        .success
    ).toBe(true)
    expect(
      reauthenticateAdminRequestSchema.safeParse({ password: 'a'.repeat(129) })
        .success
    ).toBe(false)
    expect(
      reauthenticateAdminRequestSchema.safeParse({ password: '\ud800' }).success
    ).toBe(false)
    expect(
      reauthenticateAdminRequestSchema.safeParse({
        password: opaquePassword,
        email: 'forbidden@example.com'
      }).success
    ).toBe(false)
  })

  it('단건 command 성공을 path/request ID·state·expected+1과 결합한다', () => {
    expect(
      assertCreateAdminQuestionResponse(
        createContent,
        mutationResult('DRAFT', 1, {
          questionVersionId: id(40),
          questionRowVersion: 1
        })
      ).versionStatus
    ).toBe('DRAFT')

    const createdVersion = mutationResult('DRAFT', 1, {
      questionVersionId: id(41),
      questionRowVersion: 6
    })
    expect(
      assertCreateAdminQuestionVersionResponse(
        { questionId },
        { ...createContent, expectedQuestionRowVersion: 5 },
        createdVersion
      ).questionRowVersion
    ).toBe(6)
    expect(() =>
      assertCreateAdminQuestionVersionResponse(
        { questionId: id(404) },
        { ...createContent, expectedQuestionRowVersion: 5 },
        createdVersion
      )
    ).toThrow()

    expect(
      assertUpdateQuestionVersionResponse(
        { versionId },
        { ...updateContent, expectedRowVersion: 2 },
        mutationResult('DRAFT', 3)
      ).versionRowVersion
    ).toBe(3)
    expect(
      assertRequestContentReviewResponse(
        { versionId },
        { expectedRowVersion: 3 },
        mutationResult('IN_REVIEW', 4)
      ).versionStatus
    ).toBe('IN_REVIEW')
    expect(
      assertRequestQuestionChangesResponse(
        { versionId },
        { expectedRowVersion: 4, reason: '설명 보강' },
        mutationResult('CHANGES_REQUESTED', 5)
      ).versionStatus
    ).toBe('CHANGES_REQUESTED')
    expect(
      assertApproveQuestionVersionResponse(
        { versionId },
        { expectedRowVersion: 5 },
        mutationResult('APPROVED', 6)
      ).versionStatus
    ).toBe('APPROVED')
    expect(
      assertWithdrawQuestionApprovalResponse(
        { versionId },
        { expectedRowVersion: 6, reason: '재검토' },
        mutationResult('CHANGES_REQUESTED', 7)
      ).versionStatus
    ).toBe('CHANGES_REQUESTED')

    expect(
      assertPublishQuestionVersionResponse(
        { versionId },
        { expectedRowVersion: 7, expectedQuestionRowVersion: 7 },
        mutationResult('PUBLISHED', 8, { questionRowVersion: 8 })
      ).versionStatus
    ).toBe('PUBLISHED')
    expect(() =>
      assertPublishQuestionVersionResponse(
        { versionId },
        { expectedRowVersion: 7, expectedQuestionRowVersion: 7 },
        mutationResult('PUBLISHED', 8, { questionRowVersion: 7 })
      )
    ).toThrow()

    expect(
      assertRetireQuestionVersionResponse(
        { versionId },
        { expectedRowVersion: 8, expectedQuestionRowVersion: 8 },
        mutationResult('RETIRED', 9, { questionRowVersion: 9 })
      ).versionStatus
    ).toBe('RETIRED')

    expect(
      assertArchiveAdminQuestionResponse(
        { questionId },
        {
          expectedQuestionRowVersion: 9,
          expectedOpenCandidateVersionId: null,
          expectedOpenCandidateRowVersion: null
        },
        mutationResult(null, 1, {
          questionVersionId: null,
          lifecycleStatus: 'ARCHIVED',
          versionRowVersion: null,
          questionRowVersion: 10
        })
      ).lifecycleStatus
    ).toBe('ARCHIVED')
  })

  it('batch 성공은 request 순서·version expected+1·단일 occurredAt을 강제한다', () => {
    const request = {
      items: [
        { versionId: id(51), expectedRowVersion: 1 },
        { versionId: id(52), expectedRowVersion: 4, comment: '확인' }
      ]
    }
    const response = {
      items: [
        mutationResult('IN_REVIEW', 2, { questionVersionId: id(51) }),
        mutationResult('IN_REVIEW', 5, { questionVersionId: id(52) })
      ]
    }
    expect(
      assertRequestContentReviewBatchResponse(request, response).items
    ).toHaveLength(2)
    expect(() =>
      assertRequestContentReviewBatchResponse(request, {
        items: [...response.items].reverse()
      })
    ).toThrow()
    expect(() =>
      assertRequestContentReviewBatchResponse(request, {
        items: [
          response.items[0],
          {
            ...response.items[1],
            occurredAt: '2026-08-29T03:00:01.000Z'
          }
        ]
      })
    ).toThrow()
  })

  it('export document의 request selection·canonical bytes·digest·semantic을 결합한다', async () => {
    const assertion = await assertAdminQuestionExportDocumentForRequest(
      digestPort,
      { questionIds: [questionId] },
      exportDocument
    )
    expect(assertion.questionCount).toBe(1)
    expect(assertion.versionCount).toBe(1)
    expect(assertion.selectionDigest).toMatch(/^[0-9a-f]{64}$/u)

    await expect(
      assertAdminQuestionExportDocumentForRequest(
        digestPort,
        { questionIds: [questionId] },
        exportDocument,
        {
          canonicalResponseBody: assertion.canonicalResponseBody,
          auditEvidence: {
            selectionDigest: assertion.selectionDigest,
            responseBodyDigest: assertion.responseBodyDigest,
            questionCount: 1,
            versionCount: 1
          }
        }
      )
    ).resolves.toMatchObject({ questionCount: 1, versionCount: 1 })

    await expect(
      assertAdminQuestionExportDocumentForRequest(
        digestPort,
        { questionIds: [id(999)] },
        exportDocument
      )
    ).rejects.toThrow()
    await expect(
      assertAdminQuestionExportDocumentForRequest(
        digestPort,
        { questionIds: [questionId] },
        exportDocument,
        { canonicalResponseBody: JSON.stringify(exportDocument) }
      )
    ).rejects.toThrow()
    await expect(
      assertAdminQuestionExportDocumentForRequest(
        digestPort,
        { questionIds: [questionId] },
        exportDocument,
        {
          auditEvidence: {
            selectionDigest: '0'.repeat(64),
            responseBodyDigest: assertion.responseBodyDigest,
            questionCount: 1,
            versionCount: 1
          }
        }
      )
    ).rejects.toThrow()

    expect(() =>
      assertAdminQuestionExportDocumentSemantics({
        ...exportDocument,
        questions: [
          {
            ...exportDocument.questions[0],
            currentPublishedVersionId: id(404)
          }
        ]
      })
    ).toThrow()
    expect(() =>
      assertAdminQuestionExportDocumentSemantics({
        ...exportDocument,
        questions: [
          {
            ...exportDocument.questions[0],
            versions: [
              {
                ...exportDocument.questions[0]!.versions[0],
                versionNumber: 2
              }
            ]
          }
        ]
      })
    ).toThrow()

    const duplicateVersionId = structuredClone(exportDocument)
    duplicateVersionId.questions.push({
      ...structuredClone(exportDocument.questions[0]!),
      questionId: id(40)
    })
    expect(() =>
      assertAdminQuestionExportDocumentSemantics(duplicateVersionId)
    ).toThrow()

    const duplicateOptionId = structuredClone(exportDocument)
    const duplicateOptionQuestion = structuredClone(
      exportDocument.questions[0]!
    )
    duplicateOptionQuestion.questionId = id(41)
    duplicateOptionQuestion.currentPublishedVersionId = id(42)
    duplicateOptionQuestion.versions[0]!.questionVersionId = id(42)
    duplicateOptionQuestion.versions[0]!.content.options =
      duplicateOptionQuestion.versions[0]!.content.options.map(
        (option, index) => ({
          ...option,
          id:
            index === 0
              ? exportDocument.questions[0]!.versions[0]!.content.options[0]!.id
              : id(50 + index)
        })
      )
    duplicateOptionQuestion.versions[0]!.content.correctOptionId =
      duplicateOptionQuestion.versions[0]!.content.options[0]!.id
    duplicateOptionId.questions.push(duplicateOptionQuestion)
    expect(() =>
      assertAdminQuestionExportDocumentSemantics(duplicateOptionId)
    ).toThrow()

    const duplicateTagId = structuredClone(exportDocument)
    duplicateTagId.questions[0]!.versions[0]!.content.tags.push({
      id: id(30),
      label: '문법',
      normalizedName: '문법'
    })
    expect(() =>
      assertAdminQuestionExportDocumentSemantics(duplicateTagId)
    ).toThrow()

    const duplicateTagName = structuredClone(exportDocument)
    duplicateTagName.questions[0]!.versions[0]!.content.tags.push({
      id: id(31),
      label: 'kana',
      normalizedName: 'kana'
    })
    expect(() =>
      assertAdminQuestionExportDocumentSemantics(duplicateTagName)
    ).toThrow()

    const mismatchedTagName = structuredClone(exportDocument)
    mismatchedTagName.questions[0]!.versions[0]!.content.tags[0] = {
      id: id(30),
      label: 'Kana',
      normalizedName: 'different'
    }
    expect(
      adminQuestionExportDocumentV1Schema.safeParse(mismatchedTagName).success
    ).toBe(false)

    const nonCanonicalTagOrder = structuredClone(exportDocument)
    nonCanonicalTagOrder.questions[0]!.versions[0]!.content.tags = [
      { id: id(32), label: 'Zulu', normalizedName: 'zulu' },
      { id: id(33), label: 'Alpha', normalizedName: 'alpha' }
    ]
    expect(() =>
      assertAdminQuestionExportDocumentSemantics(nonCanonicalTagOrder)
    ).toThrow()
    expect(
      adminQuestionExportDocumentV1Schema.safeParse({
        ...exportDocument,
        questions: [
          {
            ...exportDocument.questions[0],
            audit: { actorEmail: 'secret@example.com' }
          }
        ]
      }).success
    ).toBe(false)
    expect(
      adminQuestionExportAttachmentHeadersSchema.parse({
        'content-type': adminQuestionExportContentType,
        'content-disposition': adminQuestionExportContentDisposition
      })
    ).toEqual({
      'content-type': adminQuestionExportContentType,
      'content-disposition': adminQuestionExportContentDisposition
    })
    expect(
      exportAdminQuestionsAttachmentBodyResponseSchema.parse(
        JSON.stringify(exportDocument)
      )
    ).toBe(JSON.stringify(exportDocument))
    expect(() =>
      exportAdminQuestionsAttachmentBodyResponseSchema.parse('{')
    ).toThrow()
    expect(() =>
      exportAdminQuestionsAttachmentBodyResponseSchema.parse('{}')
    ).toThrow()
  })

  it('reauth success window를 정확히 5분으로 닫는다', () => {
    expect(
      reauthenticateAdminResponseSchema.parse({
        reauthenticatedAt: '2026-08-29T12:00:00+09:00',
        assuranceExpiresAt: '2026-08-29T12:05:00+09:00'
      })
    ).toEqual({
      reauthenticatedAt: '2026-08-29T03:00:00.000Z',
      assuranceExpiresAt: '2026-08-29T03:05:00.000Z'
    })
    expect(
      reauthenticateAdminResponseSchema.safeParse({
        reauthenticatedAt: occurredAt,
        assuranceExpiresAt: '2026-08-29T03:05:00.001Z'
      }).success
    ).toBe(false)
    expect(
      reauthenticateAdminResponseSchema.safeParse({
        reauthenticatedAt: occurredAt,
        assuranceExpiresAt: '2026-08-29T03:05:00.000Z',
        sessionToken: 'secret'
      }).success
    ).toBe(false)
  })

  it('13 command의 closed error union을 common transport와 domain code로 exact 고정한다', () => {
    expectExactCodes(createAdminQuestionErrorCodeSchema.options, [
      'DUPLICATE_QUESTION_CONTENT'
    ])
    expectExactCodes(createAdminQuestionVersionErrorCodeSchema.options, [
      'INVALID_ID',
      'RESOURCE_NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION',
      'DUPLICATE_QUESTION_CONTENT'
    ])
    expectExactCodes(updateQuestionVersionErrorCodeSchema.options, [
      'FORBIDDEN',
      'INVALID_ID',
      'RESOURCE_NOT_FOUND',
      'VERSION_CONFLICT',
      'QUESTION_VERSION_IMMUTABLE',
      'INVALID_STATE_TRANSITION',
      'DUPLICATE_QUESTION_CONTENT'
    ])
    expectExactCodes(archiveAdminQuestionErrorCodeSchema.options, [
      'FRESH_ASSURANCE_REQUIRED',
      'INVALID_ID',
      'RESOURCE_NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION'
    ])
    expectExactCodes(requestContentReviewErrorCodeSchema.options, [
      'FORBIDDEN',
      'INVALID_ID',
      'RESOURCE_NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION'
    ])
    expectExactCodes(requestQuestionChangesErrorCodeSchema.options, [
      'INVALID_ID',
      'RESOURCE_NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION',
      'SEPARATION_OF_DUTIES_VIOLATION'
    ])
    expectExactCodes(approveQuestionVersionErrorCodeSchema.options, [
      'FRESH_ASSURANCE_REQUIRED',
      'INVALID_ID',
      'RESOURCE_NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION',
      'SEPARATION_OF_DUTIES_VIOLATION'
    ])
    expectExactCodes(withdrawQuestionApprovalErrorCodeSchema.options, [
      'FRESH_ASSURANCE_REQUIRED',
      'INVALID_ID',
      'RESOURCE_NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION',
      'SEPARATION_OF_DUTIES_VIOLATION'
    ])
    expectExactCodes(publishQuestionVersionErrorCodeSchema.options, [
      'FRESH_ASSURANCE_REQUIRED',
      'INVALID_ID',
      'RESOURCE_NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION',
      'SEPARATION_OF_DUTIES_VIOLATION',
      'DUPLICATE_QUESTION_CONTENT'
    ])
    expectExactCodes(retireQuestionVersionErrorCodeSchema.options, [
      'FRESH_ASSURANCE_REQUIRED',
      'INVALID_ID',
      'RESOURCE_NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION'
    ])
    expectExactCodes(requestContentReviewBatchErrorCodeSchema.options, [
      'FRESH_ASSURANCE_REQUIRED',
      'FORBIDDEN',
      'RESOURCE_NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION'
    ])
    expectExactCodes(exportAdminQuestionsErrorCodeSchema.options, [
      'FRESH_ASSURANCE_REQUIRED',
      'RESOURCE_NOT_FOUND'
    ])
    expectExactCodes(reauthenticateAdminErrorCodeSchema.options, [
      'REAUTHENTICATION_FAILED'
    ])

    expect(
      createAdminQuestionErrorSchema.safeParse({
        code: 'DUPLICATE_QUESTION_CONTENT',
        message: 'duplicate',
        requestId: id(700),
        retryable: false
      }).success
    ).toBe(true)
    expect(
      createAdminQuestionErrorSchema.safeParse({
        code: 'INVALID_CSRF',
        message: 'forbidden',
        requestId: id(700),
        retryable: false
      }).success
    ).toBe(false)
    expect(
      createAdminQuestionErrorSchema.safeParse({
        code: 'VALIDATION_ERROR',
        message: 'invalid',
        requestId: id(700),
        retryable: false,
        stack: 'secret'
      }).success
    ).toBe(false)
  })
})
