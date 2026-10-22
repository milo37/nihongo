import {
  adminImportApplyResponseSchema,
  adminImportValidationResponseSchema,
  adminQuestionExportContentDisposition,
  adminQuestionExportContentType,
  adminQuestionExportDocumentV1Schema,
  adminReviewRequestBatchResultSchema,
  getAdminQuestionReportResponseSchema,
  listAdminAuditLogResponseSchema,
  listAdminQuestionReportsResponseSchema,
  listAdminQuestionsResponseSchema,
  previewQuestionVersionResponseSchema,
  questionReportMutationResultSchema,
  type CreateAdminQuestionRequest
} from '@nihongo/contracts/admin/phase7'
import { describe, expect, it } from 'vitest'
import { DEMO_ADMIN_ID } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'

const ADMIN_BASE = 'http://localhost/api/v1/admin'
const REPORT_BASE = 'http://localhost/api/v1/question-reports'

const postJson = async (url: string, body: unknown): Promise<Response> =>
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost'
    },
    body: JSON.stringify(body)
  })

const requireOk = async (response: Response): Promise<unknown> => {
  const body: unknown = await response.json()
  if (!response.ok) {
    throw new Error(
      `Expected successful response, received ${response.status}: ${JSON.stringify(body)}`
    )
  }
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('x-request-id')).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  )
  return body
}

const loadImportFixture = async (): Promise<{
  content: CreateAdminQuestionRequest
  publishedQuestionId: string
  publishedVersionId: string
}> => {
  const list = listAdminQuestionsResponseSchema.parse(
    await requireOk(await fetch(`${ADMIN_BASE}/questions?pageSize=1`))
  )
  const seed = list.items[0]
  if (!seed) throw new Error('Phase 7 seed question is unavailable.')

  const preview = previewQuestionVersionResponseSchema.parse(
    await requireOk(
      await fetch(
        `${ADMIN_BASE}/question-versions/${seed.selectedVersionId}/preview`
      )
    )
  )
  const correctIndex = preview.question.options.findIndex(
    (option) => option.id === preview.adminAnswer.correctOptionId
  )
  if (correctIndex < 0) {
    throw new Error('Phase 7 seed correct option is unavailable.')
  }

  return {
    publishedQuestionId: seed.questionId,
    publishedVersionId: seed.selectedVersionId,
    content: {
      level: preview.question.level,
      subject: preview.question.subject,
      questionType: preview.question.questionType,
      difficulty: preview.question.difficulty,
      questionText: `${preview.question.questionText}\nSlice 5 ${crypto.randomUUID()}`,
      passage: preview.question.passage,
      explanationKo: preview.adminAnswer.explanationKo,
      explanationJa: preview.adminAnswer.explanationJa,
      tagNames: preview.question.tags.map((tag) => tag.label),
      options: preview.question.options.map((option, index) => ({
        clientOptionKey: `option-${index + 1}`,
        text: option.text
      })),
      correctOptionKey: `option-${correctIndex + 1}`
    }
  }
}

describe('Phase 7 Slice 5 canonical MSW flow', () => {
  it('validates/applies/imports, batches, exports, and resolves a learner report without legacy fallback', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const fixture = await loadImportFixture()
    const items = [
      {
        clientItemId: `slice-5-${crypto.randomUUID()}`,
        content: fixture.content
      }
    ]

    const validationResponse = await postJson(
      `${ADMIN_BASE}/questions/import-validation`,
      { items }
    )
    expect(validationResponse.status).toBe(200)
    const validation = adminImportValidationResponseSchema.parse(
      await requireOk(validationResponse)
    )
    expect(validation).toMatchObject({ valid: true, itemCount: 1, errors: [] })

    const applyResponse = await postJson(
      `${ADMIN_BASE}/questions/import-application`,
      { items, validationDigest: validation.validationDigest }
    )
    expect(applyResponse.status).toBe(201)
    const applied = adminImportApplyResponseSchema.parse(
      await requireOk(applyResponse)
    )
    const imported = applied.items[0]
    if (!imported) throw new Error('Imported item is unavailable.')

    const batchResponse = await postJson(
      `${ADMIN_BASE}/question-versions/review-request-batch`,
      {
        items: [
          {
            versionId: imported.questionVersionId,
            expectedRowVersion: imported.versionRowVersion,
            comment: '일괄 검수 요청'
          }
        ]
      }
    )
    expect(batchResponse.status).toBe(200)
    expect(
      adminReviewRequestBatchResultSchema.parse(await requireOk(batchResponse))
        .items[0]
    ).toMatchObject({
      questionId: imported.questionId,
      questionVersionId: imported.questionVersionId,
      versionStatus: 'IN_REVIEW',
      versionRowVersion: 2
    })

    const exportResponse = await postJson(`${ADMIN_BASE}/questions/export`, {
      questionIds: [imported.questionId]
    })
    expect(exportResponse.status).toBe(200)
    expect(exportResponse.headers.get('cache-control')).toBe(
      'private, no-store'
    )
    expect(exportResponse.headers.get('content-type')).toBe(
      adminQuestionExportContentType
    )
    expect(exportResponse.headers.get('content-disposition')).toBe(
      adminQuestionExportContentDisposition
    )
    const exported = adminQuestionExportDocumentV1Schema.parse(
      JSON.parse(await exportResponse.text()) as unknown
    )
    expect(exported.questions.map((question) => question.questionId)).toEqual([
      imported.questionId
    ])

    mockDatabase.loginAs('USER')
    const reportResponse = await postJson(REPORT_BASE, {
      questionVersionId: fixture.publishedVersionId,
      reason: 'OTHER',
      description: '학습 흐름에서 검토가 필요한 표현을 발견했습니다.'
    })
    expect(reportResponse.status).toBe(201)
    const createdReport = questionReportMutationResultSchema.parse(
      await requireOk(reportResponse)
    )
    expect(createdReport).toMatchObject({
      questionId: fixture.publishedQuestionId,
      questionVersionId: fixture.publishedVersionId,
      status: 'OPEN',
      rowVersion: 1,
      assignee: null,
      resolution: null
    })

    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const reportListRaw = await requireOk(
      await fetch(`${ADMIN_BASE}/question-reports?page=1&pageSize=20`)
    )
    expect(JSON.stringify(reportListRaw)).not.toContain('description')
    const reportList =
      listAdminQuestionReportsResponseSchema.parse(reportListRaw)
    expect(reportList.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: createdReport.id, status: 'OPEN' })
      ])
    )

    const reportDetail = getAdminQuestionReportResponseSchema.parse(
      await requireOk(
        await fetch(`${ADMIN_BASE}/question-reports/${createdReport.id}`)
      )
    )
    expect(reportDetail.description).toBe(
      '학습 흐름에서 검토가 필요한 표현을 발견했습니다.'
    )
    expect(reportDetail.descriptionDigest).toMatch(/^[0-9a-f]{64}$/u)

    const openQuestionList = listAdminQuestionsResponseSchema.parse(
      await requireOk(await fetch(`${ADMIN_BASE}/questions?pageSize=100`))
    )
    expect(
      openQuestionList.items.find(
        ({ questionId }) => questionId === fixture.publishedQuestionId
      )?.openReportCount
    ).toBe(1)

    const triageResponse = await postJson(
      `${ADMIN_BASE}/question-reports/${createdReport.id}/triage`,
      { expectedRowVersion: createdReport.rowVersion }
    )
    const triaged = questionReportMutationResultSchema.parse(
      await requireOk(triageResponse)
    )
    expect(triaged).toMatchObject({ status: 'TRIAGED', rowVersion: 2 })

    const resolutionResponse = await postJson(
      `${ADMIN_BASE}/question-reports/${createdReport.id}/resolution`,
      {
        expectedRowVersion: triaged.rowVersion,
        outcome: 'RESOLVED',
        reason: '내용을 검토하고 운영 기록을 종결했습니다.',
        remediationVersionId: null
      }
    )
    const resolved = questionReportMutationResultSchema.parse(
      await requireOk(resolutionResponse)
    )
    expect(resolved).toMatchObject({ status: 'RESOLVED', rowVersion: 3 })

    const closedQuestionList = listAdminQuestionsResponseSchema.parse(
      await requireOk(await fetch(`${ADMIN_BASE}/questions?pageSize=100`))
    )
    expect(
      closedQuestionList.items.find(
        ({ questionId }) => questionId === fixture.publishedQuestionId
      )?.openReportCount
    ).toBe(0)

    const audit = listAdminAuditLogResponseSchema.parse(
      await requireOk(await fetch(`${ADMIN_BASE}/audit-log?limit=100`))
    )
    expect(audit.items.map(({ command }) => command)).toEqual(
      expect.arrayContaining([
        'IMPORT_APPLY',
        'REVIEW_REQUEST_BATCH',
        'EXPORT',
        'REPORT_TRIAGE',
        'REPORT_RESOLUTION'
      ])
    )

    expect((await fetch('http://localhost/api/admin/question')).status).toBe(
      404
    )
  }, 10_000)
})
