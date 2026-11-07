import { z } from 'zod'

import { isoDateTimeSchema } from '../common/date.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  canonicalizeJson,
  createContentTextSchema,
  normalizeContentOptionComparison,
  positiveSafeIntegerSchema,
  questionLifecycleStatusSchema,
  questionVersionStatusSchema,
  sha256DomainSeparated,
  sha256HexSchema,
  sha256Text,
  type CanonicalJsonValue,
  type Sha256TextPort
} from '../common/content-validation.js'
import { adminTagSummarySchema, assertAdminTagList } from './content-model.js'
import {
  adminQuestionContentInputSchema,
  adminQuestionContentStructureInputSchema
} from './content-future.js'
import { isApplicableQuestionContentType } from './content-read.js'
import { createContentOperationErrorSchema } from './content-error-policy.js'

const addIssue = (
  context: z.core.$RefinementCtx,
  path: PropertyKey[],
  message: string
): void => context.addIssue({ code: 'custom', path, message })

const versionParamsSchema = z.object({ versionId: opaqueIdSchema }).strict()
const questionParamsSchema = z.object({ questionId: opaqueIdSchema }).strict()

export const createAdminQuestionRequestSchema = adminQuestionContentInputSchema

export const createAdminQuestionVersionParamsSchema = questionParamsSchema
export const createAdminQuestionVersionRequestSchema =
  adminQuestionContentInputSchema.safeExtend({
    expectedQuestionRowVersion: positiveSafeIntegerSchema
  })

export const archiveAdminQuestionParamsSchema = questionParamsSchema
export const archiveAdminQuestionRequestSchema = z
  .object({
    expectedQuestionRowVersion: positiveSafeIntegerSchema,
    expectedOpenCandidateVersionId: opaqueIdSchema.nullable(),
    expectedOpenCandidateRowVersion: positiveSafeIntegerSchema.nullable()
  })
  .strict()
  .superRefine((request, context) => {
    if (
      (request.expectedOpenCandidateVersionId === null) !==
      (request.expectedOpenCandidateRowVersion === null)
    ) {
      addIssue(
        context,
        ['expectedOpenCandidateRowVersion'],
        'open candidate ID와 rowVersion은 함께 null이거나 함께 존재해야 합니다.'
      )
    }
  })

const adminQuestionUpdateContentStructureInputSchema = z
  .object({
    level: adminQuestionContentStructureInputSchema.shape.level,
    subject: adminQuestionContentStructureInputSchema.shape.subject,
    questionType: adminQuestionContentStructureInputSchema.shape.questionType,
    difficulty: adminQuestionContentStructureInputSchema.shape.difficulty,
    questionText: adminQuestionContentStructureInputSchema.shape.questionText,
    passage: adminQuestionContentStructureInputSchema.shape.passage,
    explanationKo: adminQuestionContentStructureInputSchema.shape.explanationKo,
    explanationJa: adminQuestionContentStructureInputSchema.shape.explanationJa,
    tagNames: adminQuestionContentStructureInputSchema.shape.tagNames,
    options: z
      .array(
        z
          .object({
            id: opaqueIdSchema,
            ordinal: z.number().int().min(1).max(4),
            text: createContentTextSchema({
              maxScalars: 500,
              multiline: true
            })
          })
          .strict()
      )
      .length(4),
    correctOptionId: opaqueIdSchema
  })
  .strict()

const remapCreateContentIssuePath = (
  path: readonly PropertyKey[]
): PropertyKey[] => {
  if (path[0] === 'correctOptionKey') {
    return ['correctOptionId', ...path.slice(1)]
  }
  if (path[0] === 'options' && path[2] === 'clientOptionKey') {
    return ['options', path[1] ?? 0, 'id', ...path.slice(3)]
  }
  return [...path]
}

const adminQuestionUpdateContentInputSchema =
  adminQuestionUpdateContentStructureInputSchema.superRefine(
    (content, context) => {
      const orderedOrdinals = content.options
        .map((option) => option.ordinal)
        .sort((left, right) => left - right)
      if (orderedOrdinals.some((ordinal, index) => ordinal !== index + 1)) {
        addIssue(
          context,
          ['options'],
          'option ordinal은 1..4의 permutation이어야 합니다.'
        )
      }

      const clientKeyByOptionId = new Map<string, string>()
      content.options.forEach((option) => {
        if (!clientKeyByOptionId.has(option.id)) {
          clientKeyByOptionId.set(
            option.id,
            `option-${clientKeyByOptionId.size + 1}`
          )
        }
      })

      const createContent = adminQuestionContentInputSchema.safeParse({
        level: content.level,
        subject: content.subject,
        questionType: content.questionType,
        difficulty: content.difficulty,
        questionText: content.questionText,
        passage: content.passage,
        explanationKo: content.explanationKo,
        explanationJa: content.explanationJa,
        tagNames: content.tagNames,
        options: content.options.map((option) => ({
          clientOptionKey: clientKeyByOptionId.get(option.id),
          text: option.text
        })),
        correctOptionKey:
          clientKeyByOptionId.get(content.correctOptionId) ?? 'missing-option'
      })

      if (!createContent.success) {
        createContent.error.issues.forEach((issue) => {
          addIssue(
            context,
            remapCreateContentIssuePath(issue.path),
            issue.message
          )
        })
      }
    }
  )

export const updateQuestionVersionParamsSchema = versionParamsSchema
export const updateQuestionVersionRequestSchema =
  adminQuestionUpdateContentInputSchema.safeExtend({
    expectedRowVersion: positiveSafeIntegerSchema
  })

const reviewCommentSchema = createContentTextSchema({
  maxScalars: 1000,
  multiline: true
})
const reviewReasonSchema = createContentTextSchema({
  maxScalars: 100,
  multiline: true
})

export const requestContentReviewParamsSchema = versionParamsSchema
export const requestContentReviewRequestSchema = z
  .object({
    expectedRowVersion: positiveSafeIntegerSchema,
    comment: reviewCommentSchema.optional()
  })
  .strict()

export const requestQuestionChangesParamsSchema = versionParamsSchema
export const requestQuestionChangesRequestSchema = z
  .object({
    expectedRowVersion: positiveSafeIntegerSchema,
    reason: reviewReasonSchema,
    comment: reviewCommentSchema.optional()
  })
  .strict()

export const approveQuestionVersionParamsSchema = versionParamsSchema
export const approveQuestionVersionRequestSchema = z
  .object({
    expectedRowVersion: positiveSafeIntegerSchema,
    comment: reviewCommentSchema.optional()
  })
  .strict()

export const withdrawQuestionApprovalParamsSchema = versionParamsSchema
export const withdrawQuestionApprovalRequestSchema = z
  .object({
    expectedRowVersion: positiveSafeIntegerSchema,
    reason: reviewReasonSchema,
    comment: reviewCommentSchema.optional()
  })
  .strict()

const publicationRequestSchema = z
  .object({
    expectedRowVersion: positiveSafeIntegerSchema,
    expectedQuestionRowVersion: positiveSafeIntegerSchema
  })
  .strict()

export const publishQuestionVersionParamsSchema = versionParamsSchema
export const publishQuestionVersionRequestSchema = publicationRequestSchema
export const retireQuestionVersionParamsSchema = versionParamsSchema
export const retireQuestionVersionRequestSchema = publicationRequestSchema

const adminReviewRequestBatchItemSchema = z
  .object({
    versionId: opaqueIdSchema,
    expectedRowVersion: positiveSafeIntegerSchema,
    comment: reviewCommentSchema.optional()
  })
  .strict()

export const requestContentReviewBatchRequestSchema = z
  .object({
    items: z.array(adminReviewRequestBatchItemSchema).min(1).max(20)
  })
  .strict()
  .superRefine((request, context) => {
    const versionIds = new Set<string>()
    request.items.forEach((item, index) => {
      if (versionIds.has(item.versionId)) {
        addIssue(
          context,
          ['items', index, 'versionId'],
          'batch versionId는 고유해야 합니다.'
        )
      }
      versionIds.add(item.versionId)
    })
  })

export const exportAdminQuestionsRequestSchema = z
  .object({
    questionIds: z.array(opaqueIdSchema).min(1).max(100)
  })
  .strict()
  .superRefine((request, context) => {
    const questionIds = new Set<string>()
    request.questionIds.forEach((questionId, index) => {
      if (questionIds.has(questionId)) {
        addIssue(
          context,
          ['questionIds', index],
          'export questionId는 고유해야 합니다.'
        )
      }
      questionIds.add(questionId)
    })
  })

// Retired public operation: ADMIN_FRESH SSO is the sole replacement.
export const reauthenticateAdminRequestSchema = z.never()

export const adminQuestionMutationResultSchema = z
  .object({
    questionId: opaqueIdSchema,
    questionVersionId: opaqueIdSchema.nullable(),
    lifecycleStatus: questionLifecycleStatusSchema,
    versionStatus: questionVersionStatusSchema.nullable(),
    questionRowVersion: positiveSafeIntegerSchema,
    versionRowVersion: positiveSafeIntegerSchema.nullable(),
    occurredAt: isoDateTimeSchema
  })
  .strict()
  .superRefine((result, context) => {
    const nullableVersionFields = [
      result.questionVersionId,
      result.versionStatus,
      result.versionRowVersion
    ]
    const nullCount = nullableVersionFields.filter(
      (value) => value === null
    ).length
    if (nullCount !== 0 && nullCount !== nullableVersionFields.length) {
      addIssue(
        context,
        ['questionVersionId'],
        'version result fields는 모두 null이거나 모두 존재해야 합니다.'
      )
    }
  })

const activeMutationResultSchema = adminQuestionMutationResultSchema.refine(
  (result) =>
    result.lifecycleStatus === 'ACTIVE' &&
    result.questionVersionId !== null &&
    result.versionStatus !== null &&
    result.versionRowVersion !== null,
  {
    path: ['lifecycleStatus'],
    message: 'non-archive mutation result는 ACTIVE version result여야 합니다.'
  }
)

export const createAdminQuestionResponseSchema =
  activeMutationResultSchema.refine(
    (result) =>
      result.versionStatus === 'DRAFT' &&
      result.questionRowVersion === 1 &&
      result.versionRowVersion === 1,
    {
      path: ['versionStatus'],
      message: 'create result는 ACTIVE DRAFT와 initial rowVersion이어야 합니다.'
    }
  )

export const createAdminQuestionVersionResponseSchema =
  activeMutationResultSchema.refine(
    (result) =>
      result.versionStatus === 'DRAFT' && result.versionRowVersion === 1,
    {
      path: ['versionStatus'],
      message:
        'create version result는 DRAFT/version rowVersion 1이어야 합니다.'
    }
  )

export const updateQuestionVersionResponseSchema =
  activeMutationResultSchema.refine(
    (result) =>
      result.versionStatus === 'DRAFT' ||
      result.versionStatus === 'CHANGES_REQUESTED',
    {
      path: ['versionStatus'],
      message: 'PATCH result는 editable state를 유지해야 합니다.'
    }
  )

const inReviewMutationResultSchema = activeMutationResultSchema.refine(
  (result) => result.versionStatus === 'IN_REVIEW',
  {
    path: ['versionStatus'],
    message: 'review request result는 IN_REVIEW여야 합니다.'
  }
)
export const requestContentReviewResponseSchema = inReviewMutationResultSchema

const changesRequestedMutationResultSchema = activeMutationResultSchema.refine(
  (result) => result.versionStatus === 'CHANGES_REQUESTED',
  {
    path: ['versionStatus'],
    message: 'change result는 CHANGES_REQUESTED여야 합니다.'
  }
)
export const requestQuestionChangesResponseSchema =
  changesRequestedMutationResultSchema
export const withdrawQuestionApprovalResponseSchema =
  changesRequestedMutationResultSchema

export const approveQuestionVersionResponseSchema =
  activeMutationResultSchema.refine(
    (result) => result.versionStatus === 'APPROVED',
    {
      path: ['versionStatus'],
      message: 'approval result는 APPROVED여야 합니다.'
    }
  )

export const publishQuestionVersionResponseSchema =
  activeMutationResultSchema.refine(
    (result) => result.versionStatus === 'PUBLISHED',
    {
      path: ['versionStatus'],
      message: 'publication result는 PUBLISHED여야 합니다.'
    }
  )

export const retireQuestionVersionResponseSchema =
  activeMutationResultSchema.refine(
    (result) => result.versionStatus === 'RETIRED',
    {
      path: ['versionStatus'],
      message: 'retirement result는 RETIRED여야 합니다.'
    }
  )

export const archiveAdminQuestionResponseSchema =
  adminQuestionMutationResultSchema.refine(
    (result) =>
      result.lifecycleStatus === 'ARCHIVED' &&
      result.questionVersionId === null &&
      result.versionStatus === null &&
      result.versionRowVersion === null,
    {
      path: ['lifecycleStatus'],
      message: 'archive result는 ARCHIVED aggregate-only result여야 합니다.'
    }
  )

const adminReviewRequestBatchResultSchema = z
  .object({
    items: z.array(requestContentReviewResponseSchema).min(1).max(20)
  })
  .strict()
  .superRefine((result, context) => {
    const versionIds = new Set<string>()
    const occurredAt = result.items[0]?.occurredAt
    result.items.forEach((item, index) => {
      if (versionIds.has(item.questionVersionId ?? '')) {
        addIssue(
          context,
          ['items', index, 'questionVersionId'],
          'batch result version ID는 고유해야 합니다.'
        )
      }
      if (item.occurredAt !== occurredAt) {
        addIssue(
          context,
          ['items', index, 'occurredAt'],
          'batch result는 하나의 occurredAt을 공유해야 합니다.'
        )
      }
      versionIds.add(item.questionVersionId ?? '')
    })
  })
export const requestContentReviewBatchResponseSchema =
  adminReviewRequestBatchResultSchema

const adminReauthenticationResultSchema = z
  .object({
    reauthenticatedAt: isoDateTimeSchema,
    assuranceExpiresAt: isoDateTimeSchema
  })
  .strict()
  .superRefine((result, context) => {
    if (
      Date.parse(result.assuranceExpiresAt) !==
      Date.parse(result.reauthenticatedAt) + 300_000
    ) {
      addIssue(
        context,
        ['assuranceExpiresAt'],
        'assuranceExpiresAt은 reauthenticatedAt보다 정확히 5분 뒤여야 합니다.'
      )
    }
  })
export const reauthenticateAdminResponseSchema =
  adminReauthenticationResultSchema

const assertVersionResultCorrelation = (
  pathVersionId: string,
  expectedVersionRowVersion: number,
  response: AdminQuestionMutationResult
): void => {
  if (
    response.questionVersionId !== pathVersionId ||
    response.versionRowVersion !== expectedVersionRowVersion
  ) {
    throw new Error(
      'mutation result가 path version/expected rowVersion과 다릅니다.'
    )
  }
}

export const assertCreateAdminQuestionResponse = (
  rawRequest: unknown,
  rawResponse: unknown
): CreateAdminQuestionResponse => {
  createAdminQuestionRequestSchema.parse(rawRequest)
  return createAdminQuestionResponseSchema.parse(rawResponse)
}

export const assertCreateAdminQuestionVersionResponse = (
  rawParams: unknown,
  rawRequest: unknown,
  rawResponse: unknown
): CreateAdminQuestionVersionResponse => {
  const params = createAdminQuestionVersionParamsSchema.parse(rawParams)
  const request = createAdminQuestionVersionRequestSchema.parse(rawRequest)
  const response = createAdminQuestionVersionResponseSchema.parse(rawResponse)
  if (
    response.questionId !== params.questionId ||
    response.questionRowVersion !== request.expectedQuestionRowVersion + 1
  ) {
    throw new Error(
      'create version result가 path/Question rowVersion과 다릅니다.'
    )
  }
  return response
}

export const assertUpdateQuestionVersionResponse = (
  rawParams: unknown,
  rawRequest: unknown,
  rawResponse: unknown
): UpdateQuestionVersionResponse => {
  const params = updateQuestionVersionParamsSchema.parse(rawParams)
  const request = updateQuestionVersionRequestSchema.parse(rawRequest)
  const response = updateQuestionVersionResponseSchema.parse(rawResponse)
  assertVersionResultCorrelation(
    params.versionId,
    request.expectedRowVersion + 1,
    response
  )
  return response
}

export const assertRequestContentReviewResponse = (
  rawParams: unknown,
  rawRequest: unknown,
  rawResponse: unknown
): RequestContentReviewResponse => {
  const params = requestContentReviewParamsSchema.parse(rawParams)
  const request = requestContentReviewRequestSchema.parse(rawRequest)
  const response = requestContentReviewResponseSchema.parse(rawResponse)
  assertVersionResultCorrelation(
    params.versionId,
    request.expectedRowVersion + 1,
    response
  )
  return response
}

export const assertRequestQuestionChangesResponse = (
  rawParams: unknown,
  rawRequest: unknown,
  rawResponse: unknown
): RequestQuestionChangesResponse => {
  const params = requestQuestionChangesParamsSchema.parse(rawParams)
  const request = requestQuestionChangesRequestSchema.parse(rawRequest)
  const response = requestQuestionChangesResponseSchema.parse(rawResponse)
  assertVersionResultCorrelation(
    params.versionId,
    request.expectedRowVersion + 1,
    response
  )
  return response
}

export const assertApproveQuestionVersionResponse = (
  rawParams: unknown,
  rawRequest: unknown,
  rawResponse: unknown
): ApproveQuestionVersionResponse => {
  const params = approveQuestionVersionParamsSchema.parse(rawParams)
  const request = approveQuestionVersionRequestSchema.parse(rawRequest)
  const response = approveQuestionVersionResponseSchema.parse(rawResponse)
  assertVersionResultCorrelation(
    params.versionId,
    request.expectedRowVersion + 1,
    response
  )
  return response
}

export const assertWithdrawQuestionApprovalResponse = (
  rawParams: unknown,
  rawRequest: unknown,
  rawResponse: unknown
): WithdrawQuestionApprovalResponse => {
  const params = withdrawQuestionApprovalParamsSchema.parse(rawParams)
  const request = withdrawQuestionApprovalRequestSchema.parse(rawRequest)
  const response = withdrawQuestionApprovalResponseSchema.parse(rawResponse)
  assertVersionResultCorrelation(
    params.versionId,
    request.expectedRowVersion + 1,
    response
  )
  return response
}

export const assertPublishQuestionVersionResponse = (
  rawParams: unknown,
  rawRequest: unknown,
  rawResponse: unknown
): PublishQuestionVersionResponse => {
  const params = publishQuestionVersionParamsSchema.parse(rawParams)
  const request = publishQuestionVersionRequestSchema.parse(rawRequest)
  const response = publishQuestionVersionResponseSchema.parse(rawResponse)
  assertVersionResultCorrelation(
    params.versionId,
    request.expectedRowVersion + 1,
    response
  )
  if (response.questionRowVersion !== request.expectedQuestionRowVersion + 1) {
    throw new Error(
      'publication result Question rowVersion이 request와 다릅니다.'
    )
  }
  return response
}

export const assertRetireQuestionVersionResponse = (
  rawParams: unknown,
  rawRequest: unknown,
  rawResponse: unknown
): RetireQuestionVersionResponse => {
  const params = retireQuestionVersionParamsSchema.parse(rawParams)
  const request = retireQuestionVersionRequestSchema.parse(rawRequest)
  const response = retireQuestionVersionResponseSchema.parse(rawResponse)
  assertVersionResultCorrelation(
    params.versionId,
    request.expectedRowVersion + 1,
    response
  )
  if (response.questionRowVersion !== request.expectedQuestionRowVersion + 1) {
    throw new Error(
      'retirement result Question rowVersion이 request와 다릅니다.'
    )
  }
  return response
}

export const assertArchiveAdminQuestionResponse = (
  rawParams: unknown,
  rawRequest: unknown,
  rawResponse: unknown
): ArchiveAdminQuestionResponse => {
  const params = archiveAdminQuestionParamsSchema.parse(rawParams)
  const request = archiveAdminQuestionRequestSchema.parse(rawRequest)
  const response = archiveAdminQuestionResponseSchema.parse(rawResponse)
  if (
    response.questionId !== params.questionId ||
    response.questionRowVersion !== request.expectedQuestionRowVersion + 1
  ) {
    throw new Error('archive result가 path/Question rowVersion과 다릅니다.')
  }
  return response
}

export const assertRequestContentReviewBatchResponse = (
  rawRequest: unknown,
  rawResponse: unknown
): AdminReviewRequestBatchResult => {
  const request = requestContentReviewBatchRequestSchema.parse(rawRequest)
  const response = adminReviewRequestBatchResultSchema.parse(rawResponse)
  if (
    response.items.length !== request.items.length ||
    response.items.some((item, index) => {
      const requested = request.items[index]
      return (
        requested === undefined ||
        item.questionVersionId !== requested.versionId ||
        item.versionRowVersion !== requested.expectedRowVersion + 1
      )
    })
  ) {
    throw new Error(
      'batch result가 request order/version rowVersion과 다릅니다.'
    )
  }
  return response
}

const adminQuestionExportOptionSchema = z
  .object({
    id: opaqueIdSchema,
    ordinal: z.number().int().min(1).max(4),
    text: createContentTextSchema({ maxScalars: 500, multiline: true })
  })
  .strict()

const adminQuestionExportContentSchema = z
  .object({
    level: adminQuestionContentStructureInputSchema.shape.level,
    subject: adminQuestionContentStructureInputSchema.shape.subject,
    questionType: adminQuestionContentStructureInputSchema.shape.questionType,
    difficulty: adminQuestionContentStructureInputSchema.shape.difficulty,
    passage: adminQuestionContentStructureInputSchema.shape.passage,
    questionText: adminQuestionContentStructureInputSchema.shape.questionText,
    explanationKo: adminQuestionContentStructureInputSchema.shape.explanationKo,
    explanationJa: adminQuestionContentStructureInputSchema.shape.explanationJa,
    options: z.array(adminQuestionExportOptionSchema).length(4),
    correctOptionId: opaqueIdSchema,
    tags: z.array(adminTagSummarySchema).min(1).max(12)
  })
  .strict()

const adminQuestionExportVersionSchema = z
  .object({
    questionVersionId: opaqueIdSchema,
    versionNumber: positiveSafeIntegerSchema,
    versionStatus: questionVersionStatusSchema,
    content: adminQuestionExportContentSchema
  })
  .strict()

const adminQuestionExportQuestionSchema = z
  .object({
    questionId: opaqueIdSchema,
    lifecycleStatus: questionLifecycleStatusSchema,
    currentPublishedVersionId: opaqueIdSchema.nullable(),
    versions: z.array(adminQuestionExportVersionSchema).min(1)
  })
  .strict()

export const adminQuestionExportDocumentV1Schema = z
  .object({
    schemaVersion: z.literal('admin-question-export-v1'),
    exportedAt: isoDateTimeSchema,
    questions: z.array(adminQuestionExportQuestionSchema).min(1).max(100)
  })
  .strict()
export const exportAdminQuestionsResponseSchema =
  adminQuestionExportDocumentV1Schema

export const exportAdminQuestionsAttachmentBodyResponseSchema = z
  .string()
  .superRefine((body, context) => {
    let document: unknown
    try {
      document = JSON.parse(body) as unknown
    } catch {
      addIssue(context, [], 'export attachment는 올바른 JSON이어야 합니다.')
      return
    }
    if (!adminQuestionExportDocumentV1Schema.safeParse(document).success) {
      addIssue(
        context,
        [],
        'export attachment는 admin-question-export-v1 문서여야 합니다.'
      )
    }
  })

const openQuestionVersionStatuses = new Set([
  'DRAFT',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED'
])

export const assertAdminQuestionExportDocumentSemantics = (
  rawDocument: unknown
): AdminQuestionExportDocumentV1 => {
  const document = adminQuestionExportDocumentV1Schema.parse(rawDocument)
  const questionIds = new Set<string>()
  const questionVersionIds = new Set<string>()
  const optionIds = new Set<string>()

  document.questions.forEach((question) => {
    if (questionIds.has(question.questionId)) {
      throw new Error('export document Question ID는 고유해야 합니다.')
    }
    questionIds.add(question.questionId)

    const openVersions = question.versions.filter((version) =>
      openQuestionVersionStatuses.has(version.versionStatus)
    )
    const publishedVersions = question.versions.filter(
      (version) => version.versionStatus === 'PUBLISHED'
    )

    if (question.lifecycleStatus === 'ACTIVE') {
      const publishedPointerIsValid =
        question.currentPublishedVersionId === null
          ? publishedVersions.length === 0
          : publishedVersions.length === 1 &&
            publishedVersions[0]?.questionVersionId ===
              question.currentPublishedVersionId
      if (!publishedPointerIsValid || openVersions.length > 1) {
        throw new Error(
          'ACTIVE export Question의 published pointer/open candidate가 유효하지 않습니다.'
        )
      }
    } else if (
      question.currentPublishedVersionId !== null ||
      openVersions.length !== 0 ||
      publishedVersions.length !== 0
    ) {
      throw new Error(
        'ARCHIVED export Question은 pointer/open/PUBLISHED version을 가질 수 없습니다.'
      )
    }

    question.versions.forEach((version, versionIndex) => {
      if (version.versionNumber !== versionIndex + 1) {
        throw new Error(
          'export versions는 versionNumber 1..N contiguous ASC여야 합니다.'
        )
      }
      if (questionVersionIds.has(version.questionVersionId)) {
        throw new Error(
          'export document QuestionVersion ID는 document-global unique여야 합니다.'
        )
      }
      questionVersionIds.add(version.questionVersionId)

      const content = version.content
      const passageIsValid =
        content.subject === 'READING'
          ? content.passage !== null
          : content.questionType === 'TEXT_GRAMMAR' || content.passage === null
      if (
        !isApplicableQuestionContentType(
          content.level,
          content.subject,
          content.questionType
        ) ||
        !passageIsValid
      ) {
        throw new Error(
          'export version content applicability가 유효하지 않습니다.'
        )
      }

      const normalizedOptionTexts = new Set<string>()
      const versionOptionIds = new Set<string>()
      content.options.forEach((option, optionIndex) => {
        if (option.ordinal !== optionIndex + 1) {
          throw new Error('export options는 ordinal 1..4 ASC여야 합니다.')
        }
        if (optionIds.has(option.id)) {
          throw new Error(
            'export QuestionOption ID는 document-global unique여야 합니다.'
          )
        }
        const normalizedText = normalizeContentOptionComparison(option.text)
        if (normalizedOptionTexts.has(normalizedText)) {
          throw new Error('export option text는 normalized unique여야 합니다.')
        }
        optionIds.add(option.id)
        versionOptionIds.add(option.id)
        normalizedOptionTexts.add(normalizedText)
      })
      if (!versionOptionIds.has(content.correctOptionId)) {
        throw new Error(
          'export correctOptionId는 같은 version option ID여야 합니다.'
        )
      }
      assertAdminTagList(content.tags, [
        'questions',
        question.questionId,
        'versions',
        version.questionVersionId,
        'content',
        'tags'
      ])
    })
  })

  return document
}

export const adminQuestionExportContentType =
  'application/json; charset=utf-8' as const
export const adminQuestionExportContentDisposition =
  'attachment; filename="nihongo-admin-questions-v1.json"' as const
export const adminQuestionExportAttachmentHeadersSchema = z
  .object({
    'content-type': z.literal(adminQuestionExportContentType),
    'content-disposition': z.literal(adminQuestionExportContentDisposition)
  })
  .strict()

const adminQuestionExportAuditEvidenceSchema = z
  .object({
    selectionDigest: sha256HexSchema,
    responseBodyDigest: sha256HexSchema,
    questionCount: z.number().int().min(1).max(100),
    versionCount: positiveSafeIntegerSchema
  })
  .strict()
  .refine((evidence) => evidence.versionCount >= evidence.questionCount, {
    path: ['versionCount'],
    message: 'versionCount는 questionCount 이상이어야 합니다.'
  })

const createAdminQuestionExportSelectionDigest = async (
  port: Sha256TextPort,
  questionIds: readonly string[]
): Promise<string> =>
  sha256DomainSeparated(
    port,
    'nihongo-export-selection-v1',
    canonicalizeJson({ questionIds: [...questionIds] })
  )

const createAdminQuestionExportResponseBodyDigest = async (
  port: Sha256TextPort,
  canonicalResponseBody: string
): Promise<string> => sha256Text(port, canonicalResponseBody)

interface AdminQuestionExportAssertionOptions {
  readonly canonicalResponseBody?: string
  readonly auditEvidence?: unknown
}

interface AdminQuestionExportAssertion {
  readonly document: AdminQuestionExportDocumentV1
  readonly canonicalResponseBody: string
  readonly selectionDigest: string
  readonly responseBodyDigest: string
  readonly questionCount: number
  readonly versionCount: number
}

export const assertAdminQuestionExportDocumentForRequest = async (
  port: Sha256TextPort,
  rawRequest: unknown,
  rawDocument: unknown,
  options: AdminQuestionExportAssertionOptions = {}
): Promise<AdminQuestionExportAssertion> => {
  const request = exportAdminQuestionsRequestSchema.parse(rawRequest)
  const document = assertAdminQuestionExportDocumentSemantics(rawDocument)
  if (
    document.questions.length !== request.questionIds.length ||
    document.questions.some(
      (question, index) => question.questionId !== request.questionIds[index]
    )
  ) {
    throw new Error(
      'export document가 request question order/selection과 다릅니다.'
    )
  }

  const canonicalResponseBody = canonicalizeJson(
    document as unknown as CanonicalJsonValue
  )
  if (
    options.canonicalResponseBody !== undefined &&
    options.canonicalResponseBody !== canonicalResponseBody
  ) {
    throw new Error(
      'export raw response body가 RFC 8785 canonical bytes가 아닙니다.'
    )
  }

  const [selectionDigest, responseBodyDigest] = await Promise.all([
    createAdminQuestionExportSelectionDigest(port, request.questionIds),
    createAdminQuestionExportResponseBodyDigest(port, canonicalResponseBody)
  ])
  const questionCount = document.questions.length
  const versionCount = document.questions.reduce(
    (count, question) => count + question.versions.length,
    0
  )

  if (options.auditEvidence !== undefined) {
    const evidence = adminQuestionExportAuditEvidenceSchema.parse(
      options.auditEvidence
    )
    if (
      evidence.selectionDigest !== selectionDigest ||
      evidence.responseBodyDigest !== responseBodyDigest ||
      evidence.questionCount !== questionCount ||
      evidence.versionCount !== versionCount
    ) {
      throw new Error(
        'export audit evidence가 request/document/body와 다릅니다.'
      )
    }
  }

  return {
    document,
    canonicalResponseBody,
    selectionDigest,
    responseBodyDigest,
    questionCount,
    versionCount
  }
}

export const createAdminQuestionErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'ADMIN_REQUIRED',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'REQUEST_TOO_LARGE',
  'VALIDATION_ERROR',
  'DUPLICATE_QUESTION_CONTENT',
  'TAG_SUBJECT_MISMATCH',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const createAdminQuestionErrorSchema = createContentOperationErrorSchema(
  'createAdminQuestion',
  createAdminQuestionErrorCodeSchema
)

export const createAdminQuestionVersionErrorCodeSchema = z.enum([
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
  'DUPLICATE_QUESTION_CONTENT',
  'TAG_SUBJECT_MISMATCH',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const createAdminQuestionVersionErrorSchema =
  createContentOperationErrorSchema(
    'createAdminQuestionVersion',
    createAdminQuestionVersionErrorCodeSchema
  )

export const updateQuestionVersionErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'ADMIN_REQUIRED',
  'FORBIDDEN',
  'INVALID_ID',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'REQUEST_TOO_LARGE',
  'VALIDATION_ERROR',
  'RESOURCE_NOT_FOUND',
  'VERSION_CONFLICT',
  'QUESTION_VERSION_IMMUTABLE',
  'INVALID_STATE_TRANSITION',
  'DUPLICATE_QUESTION_CONTENT',
  'TAG_SUBJECT_MISMATCH',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const updateQuestionVersionErrorSchema =
  createContentOperationErrorSchema(
    'updateQuestionVersion',
    updateQuestionVersionErrorCodeSchema
  )

export const archiveAdminQuestionErrorCodeSchema = z.enum([
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
export const archiveAdminQuestionErrorSchema =
  createContentOperationErrorSchema(
    'archiveAdminQuestion',
    archiveAdminQuestionErrorCodeSchema
  )

export const requestContentReviewErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'ADMIN_REQUIRED',
  'FORBIDDEN',
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
export const requestContentReviewErrorSchema =
  createContentOperationErrorSchema(
    'requestContentReview',
    requestContentReviewErrorCodeSchema
  )

export const requestQuestionChangesErrorCodeSchema = z.enum([
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
  'SEPARATION_OF_DUTIES_VIOLATION',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const requestQuestionChangesErrorSchema =
  createContentOperationErrorSchema(
    'requestQuestionChanges',
    requestQuestionChangesErrorCodeSchema
  )

export const approveQuestionVersionErrorCodeSchema = z.enum([
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
  'SEPARATION_OF_DUTIES_VIOLATION',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const approveQuestionVersionErrorSchema =
  createContentOperationErrorSchema(
    'approveQuestionVersion',
    approveQuestionVersionErrorCodeSchema
  )

export const withdrawQuestionApprovalErrorCodeSchema = z.enum([
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
  'SEPARATION_OF_DUTIES_VIOLATION',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const withdrawQuestionApprovalErrorSchema =
  createContentOperationErrorSchema(
    'withdrawQuestionApproval',
    withdrawQuestionApprovalErrorCodeSchema
  )

export const publishQuestionVersionErrorCodeSchema = z.enum([
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
  'SEPARATION_OF_DUTIES_VIOLATION',
  'DUPLICATE_QUESTION_CONTENT',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const publishQuestionVersionErrorSchema =
  createContentOperationErrorSchema(
    'publishQuestionVersion',
    publishQuestionVersionErrorCodeSchema
  )

export const retireQuestionVersionErrorCodeSchema = z.enum([
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
export const retireQuestionVersionErrorSchema =
  createContentOperationErrorSchema(
    'retireQuestionVersion',
    retireQuestionVersionErrorCodeSchema
  )

/** Request-wide failures only; item outcomes are in the 200 response. */
export const publishQuestionVersionBatchErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'ADMIN_REQUIRED',
  'FRESH_ASSURANCE_REQUIRED',
  'FORBIDDEN',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'REQUEST_TOO_LARGE',
  'VALIDATION_ERROR',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const publishQuestionVersionBatchErrorSchema =
  createContentOperationErrorSchema(
    'publishQuestionVersionBatch',
    publishQuestionVersionBatchErrorCodeSchema
  )

export const approveQuestionVersionBatchErrorCodeSchema =
  publishQuestionVersionBatchErrorCodeSchema
export const approveQuestionVersionBatchErrorSchema =
  createContentOperationErrorSchema(
    'approveQuestionVersionBatch',
    approveQuestionVersionBatchErrorCodeSchema
  )

export const requestContentReviewBatchErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'ADMIN_REQUIRED',
  'FRESH_ASSURANCE_REQUIRED',
  'FORBIDDEN',
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
export const requestContentReviewBatchErrorSchema =
  createContentOperationErrorSchema(
    'requestContentReviewBatch',
    requestContentReviewBatchErrorCodeSchema
  )

export const exportAdminQuestionsErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'ADMIN_REQUIRED',
  'FRESH_ASSURANCE_REQUIRED',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'REQUEST_TOO_LARGE',
  'VALIDATION_ERROR',
  'RESOURCE_NOT_FOUND',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const exportAdminQuestionsErrorSchema =
  createContentOperationErrorSchema(
    'exportAdminQuestions',
    exportAdminQuestionsErrorCodeSchema
  )

export const reauthenticateAdminErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'ADMIN_REQUIRED',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'REQUEST_TOO_LARGE',
  'VALIDATION_ERROR',
  'REAUTHENTICATION_FAILED',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const reauthenticateAdminErrorSchema = createContentOperationErrorSchema(
  'reauthenticateAdmin',
  reauthenticateAdminErrorCodeSchema
)

export type CreateAdminQuestionRequest = z.output<
  typeof createAdminQuestionRequestSchema
>
export type CreateAdminQuestionVersionRequest = z.output<
  typeof createAdminQuestionVersionRequestSchema
>
export type ArchiveAdminQuestionRequest = z.output<
  typeof archiveAdminQuestionRequestSchema
>
export type UpdateQuestionVersionRequest = z.output<
  typeof updateQuestionVersionRequestSchema
>
export type RequestContentReviewRequest = z.output<
  typeof requestContentReviewRequestSchema
>
export type RequestQuestionChangesRequest = z.output<
  typeof requestQuestionChangesRequestSchema
>
export type ApproveQuestionVersionRequest = z.output<
  typeof approveQuestionVersionRequestSchema
>
export type WithdrawQuestionApprovalRequest = z.output<
  typeof withdrawQuestionApprovalRequestSchema
>
export type PublishQuestionVersionRequest = z.output<
  typeof publishQuestionVersionRequestSchema
>
export type RetireQuestionVersionRequest = z.output<
  typeof retireQuestionVersionRequestSchema
>
export type RequestContentReviewBatchRequest = z.output<
  typeof requestContentReviewBatchRequestSchema
>
export type ExportAdminQuestionsRequest = z.output<
  typeof exportAdminQuestionsRequestSchema
>

export type AdminQuestionMutationResult = z.output<
  typeof adminQuestionMutationResultSchema
>
export type CreateAdminQuestionResponse = z.output<
  typeof createAdminQuestionResponseSchema
>
type CreateAdminQuestionVersionResponse = z.output<
  typeof createAdminQuestionVersionResponseSchema
>
type UpdateQuestionVersionResponse = z.output<
  typeof updateQuestionVersionResponseSchema
>
type RequestContentReviewResponse = z.output<
  typeof requestContentReviewResponseSchema
>
type RequestQuestionChangesResponse = z.output<
  typeof requestQuestionChangesResponseSchema
>
type ApproveQuestionVersionResponse = z.output<
  typeof approveQuestionVersionResponseSchema
>
type WithdrawQuestionApprovalResponse = z.output<
  typeof withdrawQuestionApprovalResponseSchema
>
type PublishQuestionVersionResponse = z.output<
  typeof publishQuestionVersionResponseSchema
>
type RetireQuestionVersionResponse = z.output<
  typeof retireQuestionVersionResponseSchema
>
type ArchiveAdminQuestionResponse = z.output<
  typeof archiveAdminQuestionResponseSchema
>
export type AdminReviewRequestBatchResult = z.output<
  typeof adminReviewRequestBatchResultSchema
>
export type AdminReauthenticationResult = z.output<
  typeof adminReauthenticationResultSchema
>
export type AdminQuestionExportDocumentV1 = z.output<
  typeof adminQuestionExportDocumentV1Schema
>
export type AdminQuestionExportAuditEvidence = z.output<
  typeof adminQuestionExportAuditEvidenceSchema
>
