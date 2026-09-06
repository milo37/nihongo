import { z } from 'zod'

import { isoDateTimeSchema } from '../common/date.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  canonicalizeJson,
  createPhase7TextSchema,
  positiveSafeIntegerSchema,
  questionLifecycleStatusSchema,
  questionVersionStatusSchema,
  sha256DomainSeparated,
  sha256HexSchema,
  sha256Text,
  type CanonicalJsonValue,
  type Sha256TextPort
} from '../common/phase7.js'
import { adminTagSummarySchema, assertAdminTagList } from './phase7-model.js'
import {
  adminQuestionContentInputSchema,
  adminQuestionContentStructureInputSchema
} from './phase7-future.js'
import { isApplicablePhase7ContentType } from './phase7-read.js'
import { createPhase7OperationErrorSchema } from './phase7-error-policy.js'

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
            text: createPhase7TextSchema({
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

export const adminQuestionUpdateContentInputSchema =
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

const reviewCommentSchema = createPhase7TextSchema({
  maxScalars: 1000,
  multiline: true
})
const reviewReasonSchema = createPhase7TextSchema({
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

export const adminReviewRequestBatchItemSchema = z
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

export const adminReauthenticationPasswordSchema = z
  .string()
  .refine((password) => password.length >= 12 && password.length <= 128, {
    message: 'password는 UTF-16 code-unit 길이 12..128이어야 합니다.'
  })
  .refine((password) => !/[\ud800-\udfff]/u.test(password), {
    message: 'password는 unpaired surrogate를 포함할 수 없습니다.'
  })

export const reauthenticateAdminRequestSchema = z
  .object({ password: adminReauthenticationPasswordSchema })
  .strict()

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

export const adminReviewRequestBatchResultSchema = z
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

export const adminReauthenticationResultSchema = z
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

export const assertReauthenticateAdminResponse = (
  rawRequest: unknown,
  rawResponse: unknown
): AdminReauthenticationResult => {
  reauthenticateAdminRequestSchema.parse(rawRequest)
  return reauthenticateAdminResponseSchema.parse(rawResponse)
}

export const adminQuestionExportOptionSchema = z
  .object({
    id: opaqueIdSchema,
    ordinal: z.number().int().min(1).max(4),
    text: createPhase7TextSchema({ maxScalars: 500, multiline: true })
  })
  .strict()

export const adminQuestionExportContentSchema = z
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

export const adminQuestionExportVersionSchema = z
  .object({
    questionVersionId: opaqueIdSchema,
    versionNumber: positiveSafeIntegerSchema,
    versionStatus: questionVersionStatusSchema,
    content: adminQuestionExportContentSchema
  })
  .strict()

export const adminQuestionExportQuestionSchema = z
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

const normalizeOptionComparison = (value: string): string =>
  value.normalize('NFKC').trim().replace(/\s+/gu, ' ')

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
        !isApplicablePhase7ContentType(
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
        const normalizedText = normalizeOptionComparison(option.text)
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

export const adminQuestionExportAuditEvidenceSchema = z
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

export const createAdminQuestionExportSelectionDigest = async (
  port: Sha256TextPort,
  questionIds: readonly string[]
): Promise<string> =>
  sha256DomainSeparated(
    port,
    'nihongo-export-selection-v1',
    canonicalizeJson({ questionIds: [...questionIds] })
  )

export const createAdminQuestionExportResponseBodyDigest = async (
  port: Sha256TextPort,
  canonicalResponseBody: string
): Promise<string> => sha256Text(port, canonicalResponseBody)

export interface AdminQuestionExportAssertionOptions {
  readonly canonicalResponseBody?: string
  readonly auditEvidence?: unknown
}

export interface AdminQuestionExportAssertion {
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
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const createAdminQuestionErrorSchema = createPhase7OperationErrorSchema(
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
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const createAdminQuestionVersionErrorSchema =
  createPhase7OperationErrorSchema(
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
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const updateQuestionVersionErrorSchema =
  createPhase7OperationErrorSchema(
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
export const archiveAdminQuestionErrorSchema = createPhase7OperationErrorSchema(
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
export const requestContentReviewErrorSchema = createPhase7OperationErrorSchema(
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
  createPhase7OperationErrorSchema(
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
  createPhase7OperationErrorSchema(
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
  createPhase7OperationErrorSchema(
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
  createPhase7OperationErrorSchema(
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
  createPhase7OperationErrorSchema(
    'retireQuestionVersion',
    retireQuestionVersionErrorCodeSchema
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
  createPhase7OperationErrorSchema(
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
export const exportAdminQuestionsErrorSchema = createPhase7OperationErrorSchema(
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
export const reauthenticateAdminErrorSchema = createPhase7OperationErrorSchema(
  'reauthenticateAdmin',
  reauthenticateAdminErrorCodeSchema
)

export type CreateAdminQuestionRequest = z.output<
  typeof createAdminQuestionRequestSchema
>
export type CreateAdminQuestionVersionParams = z.output<
  typeof createAdminQuestionVersionParamsSchema
>
export type CreateAdminQuestionVersionRequest = z.output<
  typeof createAdminQuestionVersionRequestSchema
>
export type ArchiveAdminQuestionParams = z.output<
  typeof archiveAdminQuestionParamsSchema
>
export type ArchiveAdminQuestionRequest = z.output<
  typeof archiveAdminQuestionRequestSchema
>
export type AdminQuestionUpdateContentInput = z.output<
  typeof adminQuestionUpdateContentInputSchema
>
export type UpdateQuestionVersionParams = z.output<
  typeof updateQuestionVersionParamsSchema
>
export type UpdateQuestionVersionRequest = z.output<
  typeof updateQuestionVersionRequestSchema
>
export type RequestContentReviewParams = z.output<
  typeof requestContentReviewParamsSchema
>
export type RequestContentReviewRequest = z.output<
  typeof requestContentReviewRequestSchema
>
export type RequestQuestionChangesParams = z.output<
  typeof requestQuestionChangesParamsSchema
>
export type RequestQuestionChangesRequest = z.output<
  typeof requestQuestionChangesRequestSchema
>
export type ApproveQuestionVersionParams = z.output<
  typeof approveQuestionVersionParamsSchema
>
export type ApproveQuestionVersionRequest = z.output<
  typeof approveQuestionVersionRequestSchema
>
export type WithdrawQuestionApprovalParams = z.output<
  typeof withdrawQuestionApprovalParamsSchema
>
export type WithdrawQuestionApprovalRequest = z.output<
  typeof withdrawQuestionApprovalRequestSchema
>
export type PublishQuestionVersionParams = z.output<
  typeof publishQuestionVersionParamsSchema
>
export type PublishQuestionVersionRequest = z.output<
  typeof publishQuestionVersionRequestSchema
>
export type RetireQuestionVersionParams = z.output<
  typeof retireQuestionVersionParamsSchema
>
export type RetireQuestionVersionRequest = z.output<
  typeof retireQuestionVersionRequestSchema
>
export type AdminReviewRequestBatchItem = z.output<
  typeof adminReviewRequestBatchItemSchema
>
export type RequestContentReviewBatchRequest = z.output<
  typeof requestContentReviewBatchRequestSchema
>
export type ExportAdminQuestionsRequest = z.output<
  typeof exportAdminQuestionsRequestSchema
>
export type ReauthenticateAdminRequest = z.output<
  typeof reauthenticateAdminRequestSchema
>

export type AdminQuestionMutationResult = z.output<
  typeof adminQuestionMutationResultSchema
>
export type CreateAdminQuestionResponse = z.output<
  typeof createAdminQuestionResponseSchema
>
export type CreateAdminQuestionVersionResponse = z.output<
  typeof createAdminQuestionVersionResponseSchema
>
export type UpdateQuestionVersionResponse = z.output<
  typeof updateQuestionVersionResponseSchema
>
export type RequestContentReviewResponse = z.output<
  typeof requestContentReviewResponseSchema
>
export type RequestQuestionChangesResponse = z.output<
  typeof requestQuestionChangesResponseSchema
>
export type ApproveQuestionVersionResponse = z.output<
  typeof approveQuestionVersionResponseSchema
>
export type WithdrawQuestionApprovalResponse = z.output<
  typeof withdrawQuestionApprovalResponseSchema
>
export type PublishQuestionVersionResponse = z.output<
  typeof publishQuestionVersionResponseSchema
>
export type RetireQuestionVersionResponse = z.output<
  typeof retireQuestionVersionResponseSchema
>
export type ArchiveAdminQuestionResponse = z.output<
  typeof archiveAdminQuestionResponseSchema
>
export type AdminReviewRequestBatchResult = z.output<
  typeof adminReviewRequestBatchResultSchema
>
export type RequestContentReviewBatchResponse = z.output<
  typeof requestContentReviewBatchResponseSchema
>
export type AdminReauthenticationResult = z.output<
  typeof adminReauthenticationResultSchema
>

export type AdminQuestionExportOption = z.output<
  typeof adminQuestionExportOptionSchema
>
export type AdminQuestionExportContent = z.output<
  typeof adminQuestionExportContentSchema
>
export type AdminQuestionExportVersion = z.output<
  typeof adminQuestionExportVersionSchema
>
export type AdminQuestionExportQuestion = z.output<
  typeof adminQuestionExportQuestionSchema
>
export type AdminQuestionExportDocumentV1 = z.output<
  typeof adminQuestionExportDocumentV1Schema
>
export type ExportAdminQuestionsResponse = z.output<
  typeof exportAdminQuestionsResponseSchema
>
export type AdminQuestionExportAuditEvidence = z.output<
  typeof adminQuestionExportAuditEvidenceSchema
>

export type CreateAdminQuestionErrorCode = z.output<
  typeof createAdminQuestionErrorCodeSchema
>
export type CreateAdminQuestionVersionErrorCode = z.output<
  typeof createAdminQuestionVersionErrorCodeSchema
>
export type UpdateQuestionVersionErrorCode = z.output<
  typeof updateQuestionVersionErrorCodeSchema
>
export type ArchiveAdminQuestionErrorCode = z.output<
  typeof archiveAdminQuestionErrorCodeSchema
>
export type RequestContentReviewErrorCode = z.output<
  typeof requestContentReviewErrorCodeSchema
>
export type RequestQuestionChangesErrorCode = z.output<
  typeof requestQuestionChangesErrorCodeSchema
>
export type ApproveQuestionVersionErrorCode = z.output<
  typeof approveQuestionVersionErrorCodeSchema
>
export type WithdrawQuestionApprovalErrorCode = z.output<
  typeof withdrawQuestionApprovalErrorCodeSchema
>
export type PublishQuestionVersionErrorCode = z.output<
  typeof publishQuestionVersionErrorCodeSchema
>
export type RetireQuestionVersionErrorCode = z.output<
  typeof retireQuestionVersionErrorCodeSchema
>
export type RequestContentReviewBatchErrorCode = z.output<
  typeof requestContentReviewBatchErrorCodeSchema
>
export type ExportAdminQuestionsErrorCode = z.output<
  typeof exportAdminQuestionsErrorCodeSchema
>
export type ReauthenticateAdminErrorCode = z.output<
  typeof reauthenticateAdminErrorCodeSchema
>

export type CreateAdminQuestionError = z.output<
  typeof createAdminQuestionErrorSchema
>
export type CreateAdminQuestionVersionError = z.output<
  typeof createAdminQuestionVersionErrorSchema
>
export type UpdateQuestionVersionError = z.output<
  typeof updateQuestionVersionErrorSchema
>
export type ArchiveAdminQuestionError = z.output<
  typeof archiveAdminQuestionErrorSchema
>
export type RequestContentReviewError = z.output<
  typeof requestContentReviewErrorSchema
>
export type RequestQuestionChangesError = z.output<
  typeof requestQuestionChangesErrorSchema
>
export type ApproveQuestionVersionError = z.output<
  typeof approveQuestionVersionErrorSchema
>
export type WithdrawQuestionApprovalError = z.output<
  typeof withdrawQuestionApprovalErrorSchema
>
export type PublishQuestionVersionError = z.output<
  typeof publishQuestionVersionErrorSchema
>
export type RetireQuestionVersionError = z.output<
  typeof retireQuestionVersionErrorSchema
>
export type RequestContentReviewBatchError = z.output<
  typeof requestContentReviewBatchErrorSchema
>
export type ExportAdminQuestionsError = z.output<
  typeof exportAdminQuestionsErrorSchema
>
export type ReauthenticateAdminError = z.output<
  typeof reauthenticateAdminErrorSchema
>
