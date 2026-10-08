import { z } from 'zod'

import { isoDateTimeSchema } from '../common/date.js'
import {
  jlptLevelSchema,
  questionDifficultySchema,
  questionSubjectSchema,
  questionTypeSchema
} from '../common/enum.js'
import { opaqueIdSchema, requestIdSchema } from '../common/id.js'
import {
  adminQuestionVersionCursorSchema,
  decodeAdminQuestionVersionCursor,
  decodePhase7OccurredAtCursor,
  encodeAdminQuestionVersionCursor,
  encodePhase7OccurredAtCursor,
  phase7OccurredAtCursorSchema
} from '../common/phase7-cursor.js'
import {
  accountActorSnapshotSchema,
  assertPhase7DateRange,
  canonicalizeJson,
  compareUnicodeScalars,
  createPhase7TextSchema,
  normalizePhase7OptionComparison,
  nonNegativeSafeIntegerSchema,
  isWellFormedPhase7Text,
  normalizePhase7Text,
  normalizePhase7TagKey,
  phase7QuestionSearchSchema,
  phase7TagKeySchema,
  positiveSafeIntegerSchema,
  questionLifecycleStatusSchema,
  questionVersionStatusSchema,
  safeActorSnapshotSchema,
  sha256HexSchema,
  type CanonicalJsonValue,
  type Sha256TextPort
} from '../common/phase7.js'
import { publicPracticeQuestionSchema } from '../question/get-question.js'
import {
  adminAuditCommandSchema,
  adminContentReviewItemSchema,
  adminQuestionDetailSchema,
  adminQuestionSortSchema,
  adminQuestionSummarySchema,
  adminQuestionVersionConnectionSchema,
  adminQuestionVersionSummarySchema,
  adminTagSummarySchema,
  compareAdminTags,
  assertAdminTagList,
  contentReviewConnectionSchema,
  type AdminContentReviewItem,
  type AdminQuestionDetail,
  type AdminQuestionSummary,
  type AdminQuestionVersionSummary
} from './phase7-model.js'
import { createPhase7OperationErrorSchema } from './phase7-error-policy.js'

const addIssue = (
  context: z.core.$RefinementCtx,
  path: PropertyKey[],
  message: string
): void => context.addIssue({ code: 'custom', path, message })

const phase7ReadBaseErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'ADMIN_REQUIRED',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

const phase7ReadEntityErrorCodeSchema = z.enum([
  ...phase7ReadBaseErrorCodeSchema.options,
  'INVALID_ID',
  'RESOURCE_NOT_FOUND'
])

const pageQueryFields = {
  page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
}

const refineDateRanges = (
  query: {
    readonly createdFrom?: string | undefined
    readonly createdTo?: string | undefined
    readonly updatedFrom?: string | undefined
    readonly updatedTo?: string | undefined
    readonly occurredFrom?: string | undefined
    readonly occurredTo?: string | undefined
  },
  context: z.core.$RefinementCtx
): void => {
  const ranges = [
    ['createdFrom', query.createdFrom, query.createdTo],
    ['updatedFrom', query.updatedFrom, query.updatedTo],
    ['occurredFrom', query.occurredFrom, query.occurredTo]
  ] as const

  ranges.forEach(([path, from, to]) => {
    try {
      assertPhase7DateRange(from, to)
    } catch (error) {
      addIssue(
        context,
        [path],
        error instanceof Error ? error.message : 'invalid date range'
      )
    }
  })
}

export const listAdminQuestionsOperationId = 'admin.listAdminQuestions' as const
export const getAdminQuestionOperationId = 'admin.getAdminQuestion' as const
export const listAdminTagsOperationId = 'admin.listAdminTags' as const
export const previewQuestionVersionOperationId =
  'admin.previewQuestionVersion' as const
export const diffQuestionVersionOperationId =
  'admin.diffQuestionVersion' as const
export const listAdminQuestionVersionsOperationId =
  'admin.listAdminQuestionVersions' as const
export const listQuestionVersionReviewsOperationId =
  'admin.listQuestionVersionReviews' as const
export const listAdminAuditLogOperationId = 'admin.listAdminAuditLog' as const

export const listAdminQuestionsQuerySchema = z
  .object({
    q: phase7QuestionSearchSchema.optional(),
    level: jlptLevelSchema.optional(),
    subject: questionSubjectSchema.optional(),
    questionType: questionTypeSchema.optional(),
    difficulty: questionDifficultySchema.optional(),
    lifecycleStatus: questionLifecycleStatusSchema.optional(),
    versionStatus: questionVersionStatusSchema.optional(),
    tag: phase7TagKeySchema.optional(),
    authorActorId: opaqueIdSchema.optional(),
    reviewerActorId: opaqueIdSchema.optional(),
    createdFrom: isoDateTimeSchema.optional(),
    createdTo: isoDateTimeSchema.optional(),
    updatedFrom: isoDateTimeSchema.optional(),
    updatedTo: isoDateTimeSchema.optional(),
    sort: adminQuestionSortSchema.default('UPDATED_DESC'),
    ...pageQueryFields
  })
  .strict()
  .superRefine(refineDateRanges)

export const listAdminQuestionsResponseSchema = z
  .object({
    items: z.array(adminQuestionSummarySchema),
    page: positiveSafeIntegerSchema,
    pageSize: z.number().int().min(1).max(100),
    total: nonNegativeSafeIntegerSchema
  })
  .strict()

export const listAdminQuestionsErrorCodeSchema = phase7ReadBaseErrorCodeSchema
export const listAdminQuestionsErrorSchema = createPhase7OperationErrorSchema(
  'listAdminQuestions',
  listAdminQuestionsErrorCodeSchema
)

export const getAdminQuestionParamsSchema = z
  .object({ questionId: opaqueIdSchema })
  .strict()
export const getAdminQuestionQuerySchema = z.object({}).strict()
export const getAdminQuestionResponseSchema = adminQuestionDetailSchema
export const getAdminQuestionErrorCodeSchema = phase7ReadEntityErrorCodeSchema
export const getAdminQuestionErrorSchema = createPhase7OperationErrorSchema(
  'getAdminQuestion',
  getAdminQuestionErrorCodeSchema
)

export const listAdminTagsQuerySchema = z
  .object({
    q: phase7TagKeySchema,
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
  .strict()
export const listAdminTagsResponseSchema = z
  .object({ items: z.array(adminTagSummarySchema).max(50) })
  .strict()
export const listAdminTagsErrorCodeSchema = phase7ReadBaseErrorCodeSchema
export const listAdminTagsErrorSchema = createPhase7OperationErrorSchema(
  'listAdminTags',
  listAdminTagsErrorCodeSchema
)

export const previewQuestionVersionParamsSchema = z
  .object({ versionId: opaqueIdSchema })
  .strict()
export const previewQuestionVersionQuerySchema = z.object({}).strict()

export const isApplicablePhase7ContentType = (
  level: z.output<typeof jlptLevelSchema>,
  subject: z.output<typeof questionSubjectSchema>,
  questionType: z.output<typeof questionTypeSchema>
): boolean => {
  const vocabularyTypes = [
    'KANJI_READING',
    'ORTHOGRAPHY',
    'CONTEXT_VOCABULARY',
    'PARAPHRASE',
    'WORD_USAGE'
  ]
  const grammarTypes = ['GRAMMAR_SELECT', 'SENTENCE_ORDER', 'TEXT_GRAMMAR']
  if (subject === 'VOCABULARY') return vocabularyTypes.includes(questionType)
  if (subject === 'GRAMMAR') return grammarTypes.includes(questionType)
  if (['N5', 'N4'].includes(level)) {
    return ['SHORT_READING', 'INFO_RETRIEVAL'].includes(questionType)
  }
  if (level === 'N3') {
    return ['SHORT_READING', 'MEDIUM_READING', 'INFO_RETRIEVAL'].includes(
      questionType
    )
  }
  return ['MEDIUM_READING', 'LONG_READING', 'INFO_RETRIEVAL'].includes(
    questionType
  )
}

export const previewQuestionVersionResponseSchema = z
  .object({
    question: publicPracticeQuestionSchema,
    adminAnswer: z
      .object({
        correctOptionId: opaqueIdSchema,
        explanationKo: createPhase7TextSchema({
          maxScalars: 5000,
          multiline: true
        }),
        explanationJa: createPhase7TextSchema({
          maxScalars: 5000,
          multiline: true
        }).nullable()
      })
      .strict()
  })
  .strict()
  .superRefine((preview, context) => {
    const { question } = preview
    if (
      !isApplicablePhase7ContentType(
        question.level,
        question.subject,
        question.questionType
      )
    ) {
      addIssue(
        context,
        ['question', 'questionType'],
        'level/subject/questionType 조합이 유효하지 않습니다.'
      )
    }
    const passageIsValid =
      question.subject === 'READING'
        ? question.passage !== null
        : question.questionType === 'TEXT_GRAMMAR' || question.passage === null
    if (!passageIsValid) {
      addIssue(
        context,
        ['question', 'passage'],
        'passage applicability가 유효하지 않습니다.'
      )
    }
    if (
      !question.options.some(
        (option) => option.id === preview.adminAnswer.correctOptionId
      )
    ) {
      addIssue(
        context,
        ['adminAnswer', 'correctOptionId'],
        'correct option은 보기 안에 있어야 합니다.'
      )
    }
    const optionTexts = new Set<string>()
    question.options.forEach((option, index) => {
      const normalized = normalizePhase7OptionComparison(option.text)
      if (optionTexts.has(normalized)) {
        addIssue(
          context,
          ['question', 'options', index, 'text'],
          '보기 text는 고유해야 합니다.'
        )
      }
      optionTexts.add(normalized)
    })
  })

export const previewQuestionVersionErrorCodeSchema =
  phase7ReadEntityErrorCodeSchema
export const previewQuestionVersionErrorSchema =
  createPhase7OperationErrorSchema(
    'previewQuestionVersion',
    previewQuestionVersionErrorCodeSchema
  )

export const diffQuestionVersionParamsSchema = z
  .object({ versionId: opaqueIdSchema })
  .strict()
export const diffQuestionVersionQuerySchema = z
  .object({ baseVersionId: opaqueIdSchema })
  .strict()

export const scalarDiffFieldSchema = z.enum([
  'LEVEL',
  'SUBJECT',
  'QUESTION_TYPE',
  'DIFFICULTY',
  'PASSAGE',
  'QUESTION_TEXT',
  'EXPLANATION_KO',
  'EXPLANATION_JA'
])
export const diffFieldSchema = z.enum([
  ...scalarDiffFieldSchema.options,
  'OPTIONS',
  'TAGS'
])
export const phase7DiffFieldOrder = [...diffFieldSchema.options] as const

const createCanonicalDiffTextSchema = (maximum: number) =>
  z
    .string()
    .refine(
      (value) =>
        isWellFormedPhase7Text(value) &&
        normalizePhase7Text(value) === value &&
        [...value].length >= 1 &&
        [...value].length <= maximum,
      { message: `canonical Phase 7 text ${maximum} scalar 이하여야 합니다.` }
    )

const scalarVersionDiffSchema = z.union([
  z
    .object({
      field: z.literal('LEVEL'),
      kind: z.literal('SCALAR'),
      before: jlptLevelSchema.nullable(),
      after: jlptLevelSchema.nullable()
    })
    .strict(),
  z
    .object({
      field: z.literal('SUBJECT'),
      kind: z.literal('SCALAR'),
      before: questionSubjectSchema.nullable(),
      after: questionSubjectSchema.nullable()
    })
    .strict(),
  z
    .object({
      field: z.literal('QUESTION_TYPE'),
      kind: z.literal('SCALAR'),
      before: questionTypeSchema.nullable(),
      after: questionTypeSchema.nullable()
    })
    .strict(),
  z
    .object({
      field: z.literal('DIFFICULTY'),
      kind: z.literal('SCALAR'),
      before: questionDifficultySchema.nullable(),
      after: questionDifficultySchema.nullable()
    })
    .strict(),
  z
    .object({
      field: z.literal('PASSAGE'),
      kind: z.literal('SCALAR'),
      before: createCanonicalDiffTextSchema(10_000).nullable(),
      after: createCanonicalDiffTextSchema(10_000).nullable()
    })
    .strict(),
  z
    .object({
      field: z.literal('QUESTION_TEXT'),
      kind: z.literal('SCALAR'),
      before: createCanonicalDiffTextSchema(2000).nullable(),
      after: createCanonicalDiffTextSchema(2000).nullable()
    })
    .strict(),
  z
    .object({
      field: z.literal('EXPLANATION_KO'),
      kind: z.literal('SCALAR'),
      before: createCanonicalDiffTextSchema(5000).nullable(),
      after: createCanonicalDiffTextSchema(5000).nullable()
    })
    .strict(),
  z
    .object({
      field: z.literal('EXPLANATION_JA'),
      kind: z.literal('SCALAR'),
      before: createCanonicalDiffTextSchema(5000).nullable(),
      after: createCanonicalDiffTextSchema(5000).nullable()
    })
    .strict()
])

const optionDiffValueSchema = z
  .object({
    ordinal: z.number().int().min(1).max(4),
    text: createCanonicalDiffTextSchema(500),
    isCorrect: z.boolean()
  })
  .strict()

const optionDiffArraySchema = z
  .array(optionDiffValueSchema)
  .length(4)
  .superRefine((options, context) => {
    const texts = new Set<string>()
    options.forEach((option, index) => {
      if (option.ordinal !== index + 1) {
        addIssue(context, [index, 'ordinal'], 'ordinal은 1..4 순서여야 합니다.')
      }
      const text = normalizePhase7OptionComparison(option.text)
      if (texts.has(text)) {
        addIssue(context, [index, 'text'], 'option text는 고유해야 합니다.')
      }
      texts.add(text)
    })
    if (options.filter((option) => option.isCorrect).length !== 1) {
      addIssue(context, [], '정답 option은 정확히 하나여야 합니다.')
    }
  })

const optionsVersionDiffSchema = z
  .object({
    field: z.literal('OPTIONS'),
    kind: z.literal('OPTIONS'),
    before: optionDiffArraySchema,
    after: optionDiffArraySchema
  })
  .strict()

const diffTagListSchema = z
  .array(adminTagSummarySchema)
  .min(1)
  .max(12)
  .superRefine((tags, context) => {
    try {
      assertAdminTagList(tags)
    } catch (error) {
      addIssue(
        context,
        [],
        error instanceof Error ? error.message : 'invalid tags'
      )
    }
  })

const tagsVersionDiffSchema = z
  .object({
    field: z.literal('TAGS'),
    kind: z.literal('TAGS'),
    before: diffTagListSchema,
    after: diffTagListSchema
  })
  .strict()

export const adminQuestionVersionChangeSchema = z.union([
  scalarVersionDiffSchema,
  optionsVersionDiffSchema,
  tagsVersionDiffSchema
])

export const diffQuestionVersionResponseSchema = z
  .object({
    baseVersionId: opaqueIdSchema,
    targetVersionId: opaqueIdSchema,
    changedFields: z.array(diffFieldSchema).max(10),
    changes: z.array(adminQuestionVersionChangeSchema).max(10)
  })
  .strict()
  .superRefine((diff, context) => {
    if (diff.changedFields.length !== diff.changes.length) {
      addIssue(
        context,
        ['changedFields'],
        'changedFields와 changes 길이가 같아야 합니다.'
      )
    }
    diff.changes.forEach((change, index) => {
      if (diff.changedFields[index] !== change.field) {
        addIssue(
          context,
          ['changes', index, 'field'],
          'changedFields와 exact binding되어야 합니다.'
        )
      }
      if (JSON.stringify(change.before) === JSON.stringify(change.after)) {
        addIssue(context, ['changes', index], 'before와 after는 달라야 합니다.')
      }
      const previous = diff.changedFields[index - 1]
      if (
        previous !== undefined &&
        phase7DiffFieldOrder.indexOf(previous) >=
          phase7DiffFieldOrder.indexOf(change.field)
      ) {
        addIssue(
          context,
          ['changes', index],
          'diff field는 declaration strict order여야 합니다.'
        )
      }
    })
    if (
      diff.baseVersionId === diff.targetVersionId &&
      (diff.changedFields.length !== 0 || diff.changes.length !== 0)
    ) {
      addIssue(context, ['changes'], 'base=target이면 diff는 비어야 합니다.')
    }
  })

export const diffQuestionVersionErrorCodeSchema =
  phase7ReadEntityErrorCodeSchema
export const diffQuestionVersionErrorSchema = createPhase7OperationErrorSchema(
  'diffQuestionVersion',
  diffQuestionVersionErrorCodeSchema
)

const cursorLimitQueryFields = {
  cursor: adminQuestionVersionCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
}
const occurredCursorLimitQueryFields = {
  cursor: phase7OccurredAtCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
}

export const listAdminQuestionVersionsParamsSchema = z
  .object({ questionId: opaqueIdSchema })
  .strict()
export const listAdminQuestionVersionsQuerySchema = z
  .object(cursorLimitQueryFields)
  .strict()
export const listAdminQuestionVersionsResponseSchema =
  adminQuestionVersionConnectionSchema
export const listAdminQuestionVersionsErrorCodeSchema =
  phase7ReadEntityErrorCodeSchema
export const listAdminQuestionVersionsErrorSchema =
  createPhase7OperationErrorSchema(
    'listAdminQuestionVersions',
    listAdminQuestionVersionsErrorCodeSchema
  )

export const listQuestionVersionReviewsParamsSchema = z
  .object({ versionId: opaqueIdSchema })
  .strict()
export const listQuestionVersionReviewsQuerySchema = z
  .object(occurredCursorLimitQueryFields)
  .strict()
export const listQuestionVersionReviewsResponseSchema =
  contentReviewConnectionSchema
export const listQuestionVersionReviewsErrorCodeSchema =
  phase7ReadEntityErrorCodeSchema
export const listQuestionVersionReviewsErrorSchema =
  createPhase7OperationErrorSchema(
    'listQuestionVersionReviews',
    listQuestionVersionReviewsErrorCodeSchema
  )

export const adminAuditTargetTypeSchema = z.enum([
  'QUESTION',
  'QUESTION_VERSION',
  'QUESTION_REPORT',
  'REVIEW_REQUEST_BATCH',
  'IMPORT_REQUEST',
  'EXPORT_REQUEST',
  'ADMIN_SESSION',
  'USER_ERASURE'
])
export const adminAuditEnvironmentSchema = z.enum(['TEST', 'DEVELOPMENT'])
export const adminAuditStateSchema = z.union([
  questionLifecycleStatusSchema,
  questionVersionStatusSchema,
  z.enum(['OPEN', 'TRIAGED', 'RESOLVED', 'DISMISSED']),
  z.enum(['SESSION_STALE', 'SESSION_FRESH'])
])
export const adminAuditChangedFieldSchema = z.enum([
  'LIFECYCLE_STATUS',
  'VERSION_STATUS',
  'CURRENT_PUBLISHED_VERSION_ID',
  'LEVEL',
  'SUBJECT',
  'QUESTION_TYPE',
  'DIFFICULTY',
  'PASSAGE',
  'QUESTION_TEXT',
  'EXPLANATION_KO',
  'EXPLANATION_JA',
  'OPTIONS',
  'CORRECT_OPTION',
  'TAGS',
  'ASSIGNEE',
  'RESOLUTION',
  'REPORT_STATUS',
  'SESSION_ROTATION',
  'IMPORT_ITEMS',
  'EXPORT_SELECTION',
  'AUTHOR_TOMBSTONE'
])
export const adminAuditChangedFieldOrder = [
  ...adminAuditChangedFieldSchema.options
] as const

export const adminAuditMetadataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NONE_V1') }).strict(),
  z
    .object({
      kind: z.literal('REVIEW_REQUEST_BATCH_V1'),
      itemCount: z.number().int().min(1).max(20)
    })
    .strict(),
  z
    .object({
      kind: z.literal('IMPORT_APPLY_V1'),
      validationDigest: sha256HexSchema,
      mappingDigest: sha256HexSchema,
      itemCount: z.number().int().min(1).max(100)
    })
    .strict(),
  z
    .object({
      kind: z.literal('EXPORT_V1'),
      selectionDigest: sha256HexSchema,
      responseBodyDigest: sha256HexSchema,
      questionCount: z.number().int().min(1).max(100),
      versionCount: positiveSafeIntegerSchema
    })
    .strict()
    .refine((metadata) => metadata.versionCount >= metadata.questionCount, {
      path: ['versionCount'],
      message: 'versionCount는 questionCount 이상이어야 합니다.'
    }),
  z
    .object({
      kind: z.literal('REAUTHENTICATION_V1'),
      rotation: z.literal('OLD_REVOKED_NEW_ISSUED')
    })
    .strict(),
  z
    .object({
      kind: z.literal('QUESTION_ARCHIVE_V1'),
      retiredPublishedCount: z.number().int().min(0).max(1),
      abandonedCandidateCount: z.number().int().min(0).max(1)
    })
    .strict(),
  z
    .object({
      kind: z.literal('AUTHOR_ERASURE_V1'),
      subjectActorDigest: sha256HexSchema,
      abandonedCount: positiveSafeIntegerSchema
    })
    .strict()
])

export const adminAuditLogItemSchema = z
  .object({
    id: opaqueIdSchema,
    command: adminAuditCommandSchema,
    targetType: adminAuditTargetTypeSchema,
    targetId: opaqueIdSchema,
    actor: safeActorSnapshotSchema,
    beforeState: adminAuditStateSchema.nullable(),
    afterState: adminAuditStateSchema.nullable(),
    beforeRowVersion: positiveSafeIntegerSchema.nullable(),
    afterRowVersion: positiveSafeIntegerSchema.nullable(),
    changedFields: z.array(adminAuditChangedFieldSchema).max(64),
    metadata: adminAuditMetadataSchema,
    contentDigest: sha256HexSchema,
    operationId: opaqueIdSchema,
    requestId: requestIdSchema,
    environment: adminAuditEnvironmentSchema,
    occurredAt: isoDateTimeSchema
  })
  .strict()
  .superRefine((item, context) => {
    const fields = new Set<string>()
    item.changedFields.forEach((field, index) => {
      if (fields.has(field)) {
        addIssue(
          context,
          ['changedFields', index],
          'changedFields는 고유해야 합니다.'
        )
      }
      const previous = item.changedFields[index - 1]
      if (
        previous !== undefined &&
        adminAuditChangedFieldOrder.indexOf(previous) >=
          adminAuditChangedFieldOrder.indexOf(field)
      ) {
        addIssue(
          context,
          ['changedFields', index],
          'changedFields는 declaration order여야 합니다.'
        )
      }
      fields.add(field)
    })
    if (item.actor.kind === 'ACCOUNT' && item.actor.role !== 'ADMIN') {
      addIssue(context, ['actor'], 'audit account actor는 ADMIN이어야 합니다.')
    }
    if (
      item.actor.kind === 'SYSTEM' &&
      item.command !== 'AUTHOR_ERASURE_ABANDON'
    ) {
      addIssue(
        context,
        ['actor'],
        'SYSTEM actor는 author erasure에만 허용합니다.'
      )
    }
    const requestLevel = [
      'REVIEW_REQUEST_BATCH',
      'IMPORT_APPLY',
      'EXPORT',
      'REAUTHENTICATION'
    ].includes(item.command)
    if (requestLevel && item.targetId !== item.operationId) {
      addIssue(
        context,
        ['targetId'],
        'request targetId는 operationId여야 합니다.'
      )
    }
    const contentFields = [
      'LEVEL',
      'SUBJECT',
      'QUESTION_TYPE',
      'DIFFICULTY',
      'PASSAGE',
      'QUESTION_TEXT',
      'EXPLANATION_KO',
      'EXPLANATION_JA',
      'OPTIONS',
      'CORRECT_OPTION',
      'TAGS'
    ] as const
    const exactFields = (expected: readonly string[]): boolean =>
      JSON.stringify(item.changedFields) === JSON.stringify(expected)
    const rowIncremented = (): boolean =>
      item.beforeRowVersion !== null &&
      item.afterRowVersion === item.beforeRowVersion + 1
    const noRowVersions = (): boolean =>
      item.beforeRowVersion === null && item.afterRowVersion === null
    const noneMetadata = (): boolean => item.metadata.kind === 'NONE_V1'
    const failMatrix = (): void =>
      addIssue(
        context,
        ['command'],
        'audit command evidence matrix가 일치하지 않습니다.'
      )

    if (
      (item.command === 'AUTHOR_ERASURE_ABANDON') !==
      (item.actor.kind === 'SYSTEM')
    ) {
      failMatrix()
    }

    switch (item.command) {
      case 'QUESTION_CREATE':
        if (
          item.targetType !== 'QUESTION' ||
          item.beforeState !== null ||
          item.afterState !== 'ACTIVE' ||
          item.beforeRowVersion !== null ||
          item.afterRowVersion !== 1 ||
          !exactFields(['LIFECYCLE_STATUS', ...contentFields]) ||
          !noneMetadata()
        )
          failMatrix()
        break
      case 'QUESTION_VERSION_CREATE':
        if (
          item.targetType !== 'QUESTION_VERSION' ||
          item.beforeState !== null ||
          item.afterState !== 'DRAFT' ||
          item.beforeRowVersion !== null ||
          item.afterRowVersion !== 1 ||
          !exactFields(['VERSION_STATUS', ...contentFields]) ||
          !noneMetadata()
        )
          failMatrix()
        break
      case 'QUESTION_VERSION_UPDATE':
        if (
          item.targetType !== 'QUESTION_VERSION' ||
          !['DRAFT', 'CHANGES_REQUESTED'].includes(item.beforeState ?? '') ||
          item.afterState !== item.beforeState ||
          !rowIncremented() ||
          !item.changedFields.every((field) =>
            (contentFields as readonly string[]).includes(field)
          ) ||
          !noneMetadata()
        )
          failMatrix()
        break
      case 'REVIEW_REQUEST':
        if (
          item.targetType !== 'QUESTION_VERSION' ||
          !['DRAFT', 'CHANGES_REQUESTED'].includes(item.beforeState ?? '') ||
          item.afterState !== 'IN_REVIEW' ||
          !rowIncremented() ||
          !exactFields(['VERSION_STATUS']) ||
          !noneMetadata()
        )
          failMatrix()
        break
      case 'CHANGE_REQUEST':
        if (
          item.targetType !== 'QUESTION_VERSION' ||
          item.beforeState !== 'IN_REVIEW' ||
          item.afterState !== 'CHANGES_REQUESTED' ||
          !rowIncremented() ||
          !exactFields(['VERSION_STATUS']) ||
          !noneMetadata()
        )
          failMatrix()
        break
      case 'APPROVAL':
        if (
          item.targetType !== 'QUESTION_VERSION' ||
          item.beforeState !== 'IN_REVIEW' ||
          item.afterState !== 'APPROVED' ||
          !rowIncremented() ||
          !exactFields(['VERSION_STATUS']) ||
          !noneMetadata()
        )
          failMatrix()
        break
      case 'APPROVAL_WITHDRAWAL':
        if (
          item.targetType !== 'QUESTION_VERSION' ||
          item.beforeState !== 'APPROVED' ||
          item.afterState !== 'CHANGES_REQUESTED' ||
          !rowIncremented() ||
          !exactFields(['VERSION_STATUS']) ||
          !noneMetadata()
        )
          failMatrix()
        break
      case 'PUBLICATION':
        if (
          item.targetType !== 'QUESTION_VERSION' ||
          item.beforeState !== 'APPROVED' ||
          item.afterState !== 'PUBLISHED' ||
          !rowIncremented() ||
          !exactFields(['VERSION_STATUS', 'CURRENT_PUBLISHED_VERSION_ID']) ||
          !noneMetadata()
        )
          failMatrix()
        break
      case 'RETIREMENT':
        if (
          item.targetType !== 'QUESTION_VERSION' ||
          item.beforeState !== 'PUBLISHED' ||
          item.afterState !== 'RETIRED' ||
          !rowIncremented() ||
          !exactFields(['VERSION_STATUS', 'CURRENT_PUBLISHED_VERSION_ID']) ||
          !noneMetadata()
        )
          failMatrix()
        break
      case 'QUESTION_ARCHIVE': {
        const metadata = item.metadata
        const expected = ['LIFECYCLE_STATUS']
        if (
          metadata.kind === 'QUESTION_ARCHIVE_V1' &&
          (metadata.retiredPublishedCount === 1 ||
            metadata.abandonedCandidateCount === 1)
        )
          expected.push('VERSION_STATUS')
        if (
          metadata.kind === 'QUESTION_ARCHIVE_V1' &&
          metadata.retiredPublishedCount === 1
        )
          expected.push('CURRENT_PUBLISHED_VERSION_ID')
        if (
          item.targetType !== 'QUESTION' ||
          item.beforeState !== 'ACTIVE' ||
          item.afterState !== 'ARCHIVED' ||
          !rowIncremented() ||
          !exactFields(expected) ||
          metadata.kind !== 'QUESTION_ARCHIVE_V1'
        )
          failMatrix()
        break
      }
      case 'REVIEW_REQUEST_BATCH':
        if (
          item.targetType !== 'REVIEW_REQUEST_BATCH' ||
          item.targetId !== item.operationId ||
          item.beforeState !== null ||
          item.afterState !== null ||
          !noRowVersions() ||
          !exactFields(['VERSION_STATUS']) ||
          item.metadata.kind !== 'REVIEW_REQUEST_BATCH_V1'
        )
          failMatrix()
        break
      case 'IMPORT_APPLY':
        if (
          item.targetType !== 'IMPORT_REQUEST' ||
          item.targetId !== item.operationId ||
          item.beforeState !== null ||
          item.afterState !== null ||
          !noRowVersions() ||
          !exactFields(['IMPORT_ITEMS']) ||
          item.metadata.kind !== 'IMPORT_APPLY_V1'
        )
          failMatrix()
        break
      case 'EXPORT':
        if (
          item.targetType !== 'EXPORT_REQUEST' ||
          item.targetId !== item.operationId ||
          item.beforeState !== null ||
          item.afterState !== null ||
          !noRowVersions() ||
          !exactFields(['EXPORT_SELECTION']) ||
          item.metadata.kind !== 'EXPORT_V1'
        )
          failMatrix()
        break
      case 'REPORT_TRIAGE':
        if (
          item.targetType !== 'QUESTION_REPORT' ||
          item.beforeState !== 'OPEN' ||
          item.afterState !== 'TRIAGED' ||
          !rowIncremented() ||
          !exactFields(['ASSIGNEE', 'REPORT_STATUS']) ||
          !noneMetadata()
        )
          failMatrix()
        break
      case 'REPORT_RESOLUTION':
        if (
          item.targetType !== 'QUESTION_REPORT' ||
          item.beforeState !== 'TRIAGED' ||
          !['RESOLVED', 'DISMISSED'].includes(item.afterState ?? '') ||
          !rowIncremented() ||
          !exactFields(['RESOLUTION', 'REPORT_STATUS']) ||
          !noneMetadata()
        )
          failMatrix()
        break
      case 'REAUTHENTICATION':
        if (
          item.targetType !== 'ADMIN_SESSION' ||
          item.targetId !== item.operationId ||
          !['SESSION_STALE', 'SESSION_FRESH'].includes(
            item.beforeState ?? ''
          ) ||
          item.afterState !== 'SESSION_FRESH' ||
          !noRowVersions() ||
          !exactFields(['SESSION_ROTATION']) ||
          item.metadata.kind !== 'REAUTHENTICATION_V1'
        )
          failMatrix()
        break
      case 'AUTHOR_ERASURE_ABANDON':
        if (item.targetType === 'USER_ERASURE') {
          if (
            item.targetId !== item.operationId ||
            item.beforeState !== null ||
            item.afterState !== null ||
            !noRowVersions() ||
            !exactFields(['AUTHOR_TOMBSTONE']) ||
            item.metadata.kind !== 'AUTHOR_ERASURE_V1'
          )
            failMatrix()
        } else if (
          item.targetType !== 'QUESTION_VERSION' ||
          !['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'].includes(
            item.beforeState ?? ''
          ) ||
          item.afterState !== 'RETIRED' ||
          !rowIncremented() ||
          !exactFields(['VERSION_STATUS', 'AUTHOR_TOMBSTONE']) ||
          !noneMetadata()
        )
          failMatrix()
        break
    }
  })

export const adminAuditLogConnectionSchema = z
  .object({
    items: z.array(adminAuditLogItemSchema).max(100),
    nextCursor: phase7OccurredAtCursorSchema.nullable()
  })
  .strict()

export const listAdminAuditLogQuerySchema = z
  .object({
    command: adminAuditCommandSchema.optional(),
    targetType: adminAuditTargetTypeSchema.optional(),
    targetId: opaqueIdSchema.optional(),
    actorId: opaqueIdSchema.optional(),
    environment: adminAuditEnvironmentSchema.optional(),
    occurredFrom: isoDateTimeSchema.optional(),
    occurredTo: isoDateTimeSchema.optional(),
    ...occurredCursorLimitQueryFields
  })
  .strict()
  .superRefine(refineDateRanges)
export const listAdminAuditLogResponseSchema = adminAuditLogConnectionSchema
export const listAdminAuditLogErrorCodeSchema = phase7ReadBaseErrorCodeSchema
export const listAdminAuditLogErrorSchema = createPhase7OperationErrorSchema(
  'listAdminAuditLog',
  listAdminAuditLogErrorCodeSchema
)

const assertPageEnvelope = (
  request: { readonly page: number; readonly pageSize: number },
  response: {
    readonly page: number
    readonly pageSize: number
    readonly total: number
    readonly items: readonly unknown[]
  }
): void => {
  if (
    response.page !== request.page ||
    response.pageSize !== request.pageSize
  ) {
    throw new Error(
      'response page/pageSize는 normalized request와 같아야 합니다.'
    )
  }
  if (response.items.length > request.pageSize) {
    throw new Error('page item count가 pageSize를 초과했습니다.')
  }
  const offset = (BigInt(request.page) - 1n) * BigInt(request.pageSize)
  const total = BigInt(response.total)
  const remaining = total > offset ? total - offset : 0n
  const pageSize = BigInt(request.pageSize)
  const expectedCount = remaining < pageSize ? remaining : pageSize
  if (BigInt(response.items.length) !== expectedCount) {
    throw new Error('page item count가 total bounds와 일치하지 않습니다.')
  }
}

const compareAdminQuestionItems = (
  sort: z.output<typeof adminQuestionSortSchema>,
  left: AdminQuestionSummary,
  right: AdminQuestionSummary
): number => {
  switch (sort) {
    case 'UPDATED_DESC':
      return (
        compareUnicodeScalars(right.updatedAt, left.updatedAt) ||
        compareUnicodeScalars(right.questionId, left.questionId)
      )
    case 'CREATED_DESC':
      return (
        compareUnicodeScalars(right.createdAt, left.createdAt) ||
        compareUnicodeScalars(right.questionId, left.questionId)
      )
    case 'LEVEL_ASC':
      return (
        jlptLevelSchema.options.indexOf(left.level) -
          jlptLevelSchema.options.indexOf(right.level) ||
        compareUnicodeScalars(left.questionId, right.questionId)
      )
    case 'REPORT_COUNT_DESC':
      return (
        right.openReportCount - left.openReportCount ||
        compareUnicodeScalars(right.updatedAt, left.updatedAt) ||
        compareUnicodeScalars(right.questionId, left.questionId)
      )
  }
}

const inHalfOpenRange = (
  value: string,
  from: string | undefined,
  to: string | undefined
): boolean =>
  (from === undefined || value >= from) && (to === undefined || value < to)

export const assertListAdminQuestionsForRequest = (
  rawRequest: unknown,
  rawResponse: unknown
): ListAdminQuestionsResponse => {
  const request = listAdminQuestionsQuerySchema.parse(rawRequest)
  const response = listAdminQuestionsResponseSchema.parse(rawResponse)
  assertPageEnvelope(request, response)
  const ids = new Set<string>()
  response.items.forEach((item, index) => {
    if (ids.has(item.questionId))
      throw new Error('questionId는 page 안에서 고유해야 합니다.')
    ids.add(item.questionId)
    if (
      request.q !== undefined &&
      !item.questionTextPreview.startsWith(request.q)
    ) {
      throw new Error('question item이 q prefix를 만족하지 않습니다.')
    }
    if (
      (request.level !== undefined && item.level !== request.level) ||
      (request.subject !== undefined && item.subject !== request.subject) ||
      (request.questionType !== undefined &&
        item.questionType !== request.questionType) ||
      (request.difficulty !== undefined &&
        item.difficulty !== request.difficulty) ||
      (request.lifecycleStatus !== undefined &&
        item.lifecycleStatus !== request.lifecycleStatus) ||
      (request.versionStatus !== undefined &&
        item.versionStatus !== request.versionStatus)
    ) {
      throw new Error(
        'question item이 taxonomy/status filter를 만족하지 않습니다.'
      )
    }
    if (
      request.tag !== undefined &&
      !item.tags.some((tag) => tag.normalizedName === request.tag)
    ) {
      throw new Error(
        'question item이 selected-version tag filter를 만족하지 않습니다.'
      )
    }
    if (
      request.authorActorId !== undefined &&
      item.author?.actorId !== request.authorActorId
    ) {
      throw new Error('question item이 author filter를 만족하지 않습니다.')
    }
    if (
      request.reviewerActorId !== undefined &&
      item.latestReviewer?.actorId !== request.reviewerActorId
    ) {
      throw new Error(
        'question item이 latest reviewer filter를 만족하지 않습니다.'
      )
    }
    if (
      !inHalfOpenRange(
        item.createdAt,
        request.createdFrom,
        request.createdTo
      ) ||
      !inHalfOpenRange(item.updatedAt, request.updatedFrom, request.updatedTo)
    ) {
      throw new Error('question item이 date range를 만족하지 않습니다.')
    }
    const previous = response.items[index - 1]
    if (
      previous !== undefined &&
      compareAdminQuestionItems(request.sort, previous, item) >= 0
    ) {
      throw new Error(
        'question items가 requested strict sort order가 아닙니다.'
      )
    }
  })
  return response
}

export const assertGetAdminQuestionForRequest = (
  rawParams: unknown,
  rawQueryOrResponse: unknown,
  rawResponse?: unknown
): GetAdminQuestionResponse => {
  const params = getAdminQuestionParamsSchema.parse(rawParams)
  const query = rawResponse === undefined ? {} : rawQueryOrResponse
  const responseInput =
    rawResponse === undefined ? rawQueryOrResponse : rawResponse
  getAdminQuestionQuerySchema.parse(query)
  const response = getAdminQuestionResponseSchema.parse(responseInput)
  if (response.question.questionId !== params.questionId)
    throw new Error('detail questionId가 path와 다릅니다.')
  if (response.versions.items.length > 20)
    throw new Error('detail embedded versions는 최대 20개입니다.')
  assertVersionCursorConnection(params, { limit: 20 }, response.versions)
  return response
}

export const assertListAdminTagsForRequest = (
  rawRequest: unknown,
  rawResponse: unknown
): ListAdminTagsResponse => {
  const request = listAdminTagsQuerySchema.parse(rawRequest)
  const response = listAdminTagsResponseSchema.parse(rawResponse)
  if (response.items.length > request.limit)
    throw new Error('tag count가 limit을 초과했습니다.')
  const ids = new Set<string>()
  const names = new Set<string>()
  response.items.forEach((item, index) => {
    if (!item.normalizedName.startsWith(request.q))
      throw new Error('tag가 normalized q prefix를 만족하지 않습니다.')
    if (ids.has(item.id) || names.has(item.normalizedName))
      throw new Error('tag ID/name은 고유해야 합니다.')
    const previous = response.items[index - 1]
    if (previous !== undefined && compareAdminTags(previous, item) >= 0)
      throw new Error('tags가 strict canonical order가 아닙니다.')
    ids.add(item.id)
    names.add(item.normalizedName)
  })
  return response
}

export const assertPreviewQuestionVersionForRequest = (
  rawParams: unknown,
  rawQueryOrResponse: unknown,
  rawResponse?: unknown
): PreviewQuestionVersionResponse => {
  const params = previewQuestionVersionParamsSchema.parse(rawParams)
  const query = rawResponse === undefined ? {} : rawQueryOrResponse
  const responseInput =
    rawResponse === undefined ? rawQueryOrResponse : rawResponse
  previewQuestionVersionQuerySchema.parse(query)
  const response = previewQuestionVersionResponseSchema.parse(responseInput)
  if (response.question.questionVersionId !== params.versionId)
    throw new Error('preview versionId가 path와 다릅니다.')
  return response
}

export const assertDiffQuestionVersionForRequest = (
  rawParams: unknown,
  rawRequest: unknown,
  rawResponse: unknown
): DiffQuestionVersionResponse => {
  const params = diffQuestionVersionParamsSchema.parse(rawParams)
  const request = diffQuestionVersionQuerySchema.parse(rawRequest)
  const response = diffQuestionVersionResponseSchema.parse(rawResponse)
  if (
    response.targetVersionId !== params.versionId ||
    response.baseVersionId !== request.baseVersionId
  ) {
    throw new Error('diff response IDs가 path/query와 다릅니다.')
  }
  return response
}

const assertVersionCursorConnection = (
  params: { readonly questionId: string },
  request: ListAdminQuestionVersionsQuery,
  response: ListAdminQuestionVersionsResponse
): void => {
  if (
    response.questionId !== params.questionId ||
    response.items.length > request.limit
  ) {
    throw new Error('version connection parent/count가 request와 다릅니다.')
  }
  const supplied =
    request.cursor === undefined
      ? undefined
      : decodeAdminQuestionVersionCursor(request.cursor)
  const ids = new Set<string>()
  response.items.forEach((item, index) => {
    if (ids.has(item.questionVersionId))
      throw new Error('version IDs는 고유해야 합니다.')
    const previous = response.items[index - 1]
    if (
      previous !== undefined &&
      (previous.versionNumber < item.versionNumber ||
        (previous.versionNumber === item.versionNumber &&
          compareUnicodeScalars(
            previous.questionVersionId,
            item.questionVersionId
          ) <= 0))
    ) {
      throw new Error(
        'versions는 versionNumber/id DESC strict order여야 합니다.'
      )
    }
    if (
      supplied !== undefined &&
      (item.versionNumber > supplied.versionNumber ||
        (item.versionNumber === supplied.versionNumber &&
          compareUnicodeScalars(item.questionVersionId, supplied.id) >= 0))
    ) {
      throw new Error('version item은 supplied cursor 뒤여야 합니다.')
    }
    ids.add(item.questionVersionId)
  })
  const last = response.items.at(-1)
  if (last === undefined && response.nextCursor !== null)
    throw new Error('empty connection nextCursor는 null입니다.')
  if (
    last !== undefined &&
    response.nextCursor !== null &&
    response.nextCursor !==
      encodeAdminQuestionVersionCursor({
        versionNumber: last.versionNumber,
        id: last.questionVersionId
      })
  ) {
    throw new Error('nextCursor는 last included version key여야 합니다.')
  }
}

export const assertListAdminQuestionVersionsForRequest = (
  rawParams: unknown,
  rawRequest: unknown,
  rawResponse: unknown
): ListAdminQuestionVersionsResponse => {
  const params = listAdminQuestionVersionsParamsSchema.parse(rawParams)
  const request = listAdminQuestionVersionsQuerySchema.parse(rawRequest)
  const response = listAdminQuestionVersionsResponseSchema.parse(rawResponse)
  assertVersionCursorConnection(params, request, response)
  return response
}

const assertOccurredConnection = (
  cursor: string | undefined,
  limit: number,
  items: readonly { readonly id: string; readonly occurredAt: string }[],
  nextCursor: string | null
): void => {
  if (items.length > limit)
    throw new Error('connection count가 limit을 초과했습니다.')
  const supplied =
    cursor === undefined ? undefined : decodePhase7OccurredAtCursor(cursor)
  const ids = new Set<string>()
  items.forEach((item, index) => {
    if (ids.has(item.id)) throw new Error('connection IDs는 고유해야 합니다.')
    const previous = items[index - 1]
    if (
      previous !== undefined &&
      (previous.occurredAt < item.occurredAt ||
        (previous.occurredAt === item.occurredAt &&
          compareUnicodeScalars(previous.id, item.id) <= 0))
    )
      throw new Error('items는 occurredAt/id DESC strict order여야 합니다.')
    if (
      supplied !== undefined &&
      (item.occurredAt > supplied.occurredAt ||
        (item.occurredAt === supplied.occurredAt &&
          compareUnicodeScalars(item.id, supplied.id) >= 0))
    )
      throw new Error('item은 supplied cursor 뒤여야 합니다.')
    ids.add(item.id)
  })
  const last = items.at(-1)
  if (last === undefined && nextCursor !== null)
    throw new Error('empty connection nextCursor는 null입니다.')
  if (
    last !== undefined &&
    nextCursor !== null &&
    nextCursor !==
      encodePhase7OccurredAtCursor({
        id: last.id,
        occurredAt: last.occurredAt
      })
  )
    throw new Error('nextCursor는 last included occurred key여야 합니다.')
}

export const assertListQuestionVersionReviewsForRequest = (
  rawParams: unknown,
  rawRequest: unknown,
  rawResponse: unknown
): ListQuestionVersionReviewsResponse => {
  const params = listQuestionVersionReviewsParamsSchema.parse(rawParams)
  const request = listQuestionVersionReviewsQuerySchema.parse(rawRequest)
  const response = listQuestionVersionReviewsResponseSchema.parse(rawResponse)
  if (response.questionVersionId !== params.versionId)
    throw new Error('review connection parent가 path와 다릅니다.')
  response.items.forEach((item) => {
    if (item.questionVersionId !== params.versionId)
      throw new Error('review item parent가 path와 다릅니다.')
  })
  assertOccurredConnection(
    request.cursor,
    request.limit,
    response.items,
    response.nextCursor
  )
  return response
}

export const assertListAdminAuditLogForRequest = (
  rawRequest: unknown,
  rawResponse: unknown
): ListAdminAuditLogResponse => {
  const request = listAdminAuditLogQuerySchema.parse(rawRequest)
  const response = listAdminAuditLogResponseSchema.parse(rawResponse)
  response.items.forEach((item) => {
    if (
      (request.command !== undefined && item.command !== request.command) ||
      (request.targetType !== undefined &&
        item.targetType !== request.targetType) ||
      (request.targetId !== undefined && item.targetId !== request.targetId) ||
      (request.environment !== undefined &&
        item.environment !== request.environment) ||
      !inHalfOpenRange(
        item.occurredAt,
        request.occurredFrom,
        request.occurredTo
      )
    )
      throw new Error('audit item이 request filter를 만족하지 않습니다.')
    if (
      request.actorId !== undefined &&
      (item.actor.kind !== 'ACCOUNT' || item.actor.actorId !== request.actorId)
    )
      throw new Error('audit item이 account actor filter를 만족하지 않습니다.')
  })
  assertOccurredConnection(
    request.cursor,
    request.limit,
    response.items,
    response.nextCursor
  )
  return response
}

export const createAdminAuditContentDigestPreimage = (
  item: AdminAuditLogItem
): string =>
  canonicalizeJson({
    operationId: item.operationId,
    command: item.command,
    targetType: item.targetType,
    targetId: item.targetId,
    beforeState: item.beforeState,
    afterState: item.afterState,
    beforeRowVersion: item.beforeRowVersion,
    afterRowVersion: item.afterRowVersion,
    changedFields: item.changedFields,
    metadata: item.metadata as CanonicalJsonValue
  })

export const assertAdminAuditContentDigest = async (
  port: Sha256TextPort,
  item: AdminAuditLogItem
): Promise<void> => {
  const actual = await port.digestUtf8(
    createAdminAuditContentDigestPreimage(item)
  )
  if (sha256HexSchema.parse(actual) !== item.contentDigest) {
    throw new Error(
      'AdminAuditLog contentDigest가 canonical preimage와 다릅니다.'
    )
  }
}

export type ListAdminQuestionsQuery = z.output<
  typeof listAdminQuestionsQuerySchema
>
export type ListAdminQuestionsResponse = z.output<
  typeof listAdminQuestionsResponseSchema
>
export type GetAdminQuestionParams = z.output<
  typeof getAdminQuestionParamsSchema
>
export type GetAdminQuestionQuery = z.output<typeof getAdminQuestionQuerySchema>
export type GetAdminQuestionResponse = AdminQuestionDetail
export type ListAdminTagsQuery = z.output<typeof listAdminTagsQuerySchema>
export type ListAdminTagsResponse = z.output<typeof listAdminTagsResponseSchema>
export type PreviewQuestionVersionParams = z.output<
  typeof previewQuestionVersionParamsSchema
>
export type PreviewQuestionVersionQuery = z.output<
  typeof previewQuestionVersionQuerySchema
>
export type PreviewQuestionVersionResponse = z.output<
  typeof previewQuestionVersionResponseSchema
>
export type DiffQuestionVersionParams = z.output<
  typeof diffQuestionVersionParamsSchema
>
export type DiffQuestionVersionQuery = z.output<
  typeof diffQuestionVersionQuerySchema
>
export type DiffQuestionVersionResponse = z.output<
  typeof diffQuestionVersionResponseSchema
>
export type ListAdminQuestionVersionsParams = z.output<
  typeof listAdminQuestionVersionsParamsSchema
>
export type ListAdminQuestionVersionsQuery = z.output<
  typeof listAdminQuestionVersionsQuerySchema
>
export type ListAdminQuestionVersionsResponse = z.output<
  typeof listAdminQuestionVersionsResponseSchema
>
export type ListQuestionVersionReviewsParams = z.output<
  typeof listQuestionVersionReviewsParamsSchema
>
export type ListQuestionVersionReviewsQuery = z.output<
  typeof listQuestionVersionReviewsQuerySchema
>
export type ListQuestionVersionReviewsResponse = z.output<
  typeof listQuestionVersionReviewsResponseSchema
>
export type ListAdminAuditLogQuery = z.output<
  typeof listAdminAuditLogQuerySchema
>
export type ListAdminAuditLogResponse = z.output<
  typeof listAdminAuditLogResponseSchema
>
export type AdminAuditLogItem = z.output<typeof adminAuditLogItemSchema>
export type AdminQuestionVersionDiff = DiffQuestionVersionResponse

export type { AdminContentReviewItem, AdminQuestionVersionSummary }
export {
  accountActorSnapshotSchema,
  adminContentReviewItemSchema,
  adminQuestionSummarySchema,
  adminQuestionVersionSummarySchema,
  normalizePhase7TagKey
}
