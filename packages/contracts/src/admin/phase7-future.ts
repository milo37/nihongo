import { z } from 'zod'

import { isoDateTimeSchema } from '../common/date.js'
import {
  jlptLevelSchema,
  questionDifficultySchema,
  questionSubjectSchema,
  questionTypeSchema
} from '../common/enum.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  accountActorSnapshotSchema,
  assertPhase7DateRange,
  canonicalizeJson,
  compareUnicodeScalars,
  createPhase7TextSchema,
  isWellFormedPhase7Text,
  normalizePhase7Text,
  normalizePhase7TagKey,
  positiveSafeIntegerSchema,
  sha256DomainSeparated,
  sha256HexSchema,
  type CanonicalJsonValue,
  type Sha256TextPort
} from '../common/phase7.js'
import { isApplicablePhase7ContentType } from './phase7-read.js'
import { createPhase7OperationErrorSchema } from './phase7-error-policy.js'

const addIssue = (
  context: z.core.$RefinementCtx,
  path: PropertyKey[],
  message: string
): void => context.addIssue({ code: 'custom', path, message })

export const validateQuestionImportOperationId =
  'admin.validateQuestionImport' as const
export const applyQuestionImportOperationId =
  'admin.applyQuestionImport' as const
export const createQuestionReportOperationId =
  'report.createQuestionReport' as const
export const listAdminQuestionReportsOperationId =
  'admin.listAdminQuestionReports' as const
export const getAdminQuestionReportOperationId =
  'admin.getAdminQuestionReport' as const
export const triageAdminQuestionReportOperationId =
  'admin.triageAdminQuestionReport' as const
export const resolveAdminQuestionReportOperationId =
  'admin.resolveAdminQuestionReport' as const

const exactKeySchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .refine(
      (value) =>
        [...value].length <= maximum &&
        isWellFormedPhase7Text(value) &&
        !value.includes('\n'),
      { message: `1..${maximum} well-formed Unicode scalar key여야 합니다.` }
    )

export const adminQuestionContentStructureInputSchema = z
  .object({
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    questionType: questionTypeSchema,
    difficulty: questionDifficultySchema,
    questionText: createPhase7TextSchema({ maxScalars: 2000, multiline: true }),
    passage: createPhase7TextSchema({
      maxScalars: 10_000,
      multiline: true
    }).nullable(),
    explanationKo: createPhase7TextSchema({
      maxScalars: 5000,
      multiline: true
    }),
    explanationJa: z.union([
      createPhase7TextSchema({ maxScalars: 5000, multiline: true }),
      z.literal('').transform(() => null),
      z.null()
    ]),
    tagNames: z
      .array(createPhase7TextSchema({ maxScalars: 100 }))
      .min(1)
      .max(12),
    options: z
      .array(
        z
          .object({
            clientOptionKey: exactKeySchema(32),
            text: createPhase7TextSchema({ maxScalars: 500, multiline: true })
          })
          .strict()
      )
      .length(4),
    correctOptionKey: exactKeySchema(32)
  })
  .strict()

const normalizeOptionComparison = (value: string): string =>
  value.normalize('NFKC').trim().replace(/\s+/gu, ' ')

export const adminQuestionContentInputSchema =
  adminQuestionContentStructureInputSchema.superRefine((content, context) => {
    const keys = new Set<string>()
    const texts = new Set<string>()
    content.options.forEach((option, index) => {
      if (keys.has(option.clientOptionKey)) {
        addIssue(
          context,
          ['options', index, 'clientOptionKey'],
          'option key는 고유해야 합니다.'
        )
      }
      const normalizedText = normalizeOptionComparison(option.text)
      if (texts.has(normalizedText)) {
        addIssue(
          context,
          ['options', index, 'text'],
          'option text는 고유해야 합니다.'
        )
      }
      keys.add(option.clientOptionKey)
      texts.add(normalizedText)
    })
    if (!keys.has(content.correctOptionKey)) {
      addIssue(
        context,
        ['correctOptionKey'],
        'correctOptionKey는 option key여야 합니다.'
      )
    }
    const tags = new Set<string>()
    content.tagNames.forEach((tagName, index) => {
      const normalized = normalizePhase7TagKey(tagName)
      if (tags.has(normalized)) {
        addIssue(
          context,
          ['tagNames', index],
          'normalized tagNames는 고유해야 합니다.'
        )
      }
      tags.add(normalized)
    })
    if (
      !isApplicablePhase7ContentType(
        content.level,
        content.subject,
        content.questionType
      )
    ) {
      addIssue(
        context,
        ['questionType'],
        'level/subject/questionType 조합이 유효하지 않습니다.'
      )
    }
    const passageIsValid =
      content.subject === 'READING'
        ? content.passage !== null
        : content.questionType === 'TEXT_GRAMMAR' || content.passage === null
    if (!passageIsValid) {
      addIssue(
        context,
        ['passage'],
        'passage applicability가 유효하지 않습니다.'
      )
    }
  })

export const adminImportItemSchema = z
  .object({
    clientItemId: exactKeySchema(64),
    content: adminQuestionContentStructureInputSchema
  })
  .strict()

export const adminImportItemsSchema = z
  .array(adminImportItemSchema)
  .min(1)
  .max(100)

export const validateQuestionImportRequestSchema = z
  .object({ items: adminImportItemsSchema })
  .strict()
export const applyQuestionImportRequestSchema = z
  .object({
    validationDigest: sha256HexSchema,
    items: adminImportItemsSchema
  })
  .strict()

export const adminImportIssueCodeSchema = z.enum([
  'DUPLICATE_CLIENT_ITEM_ID',
  'DUPLICATE_CLIENT_OPTION_KEY',
  'DUPLICATE_OPTION_TEXT',
  'DUPLICATE_TAG',
  'CORRECT_OPTION_KEY_NOT_FOUND',
  'UNKNOWN_TAG',
  'INVALID_READING_PASSAGE',
  'INVALID_CONTENT',
  'DUPLICATE_QUESTION_CONTENT'
])

export const adminImportValidationIssueSchema = z
  .object({
    itemIndex: z.number().int().nonnegative().max(99),
    fieldPath: z.string().regex(/^\/items\/\d+(?:\/(?:[^~/]|~[01])*)*$/u),
    code: adminImportIssueCodeSchema,
    message: z.string().min(1)
  })
  .strict()

export const adminImportValidationResponseSchema = z
  .object({
    valid: z.boolean(),
    validationDigest: sha256HexSchema,
    itemCount: z.number().int().min(1).max(100),
    errors: z.array(adminImportValidationIssueSchema)
  })
  .strict()
  .superRefine((response, context) => {
    if (response.valid !== (response.errors.length === 0)) {
      addIssue(context, ['valid'], 'valid iff errors empty여야 합니다.')
    }
    const identities = new Set<string>()
    response.errors.forEach((error, index) => {
      const identity = `${error.itemIndex}\u0000${error.fieldPath}\u0000${error.code}`
      if (identities.has(identity)) {
        addIssue(
          context,
          ['errors', index],
          'import validation issue는 dedupe되어야 합니다.'
        )
      }
      const previous = response.errors[index - 1]
      if (previous !== undefined) {
        const ordering =
          error.itemIndex - previous.itemIndex ||
          compareUnicodeScalars(error.fieldPath, previous.fieldPath) ||
          adminImportIssueCodeSchema.options.indexOf(error.code) -
            adminImportIssueCodeSchema.options.indexOf(previous.code) ||
          compareUnicodeScalars(error.message, previous.message)
        if (ordering < 0) {
          addIssue(
            context,
            ['errors', index],
            'import validation errors는 canonical declaration order여야 합니다.'
          )
        }
      }
      identities.add(identity)
    })
  })

export const normalizeAdminImportItems = (
  items: readonly AdminImportItem[]
): readonly CanonicalJsonValue[] =>
  items.map((item) => ({
    clientItemId: item.clientItemId,
    content: {
      level: item.content.level,
      subject: item.content.subject,
      questionType: item.content.questionType,
      difficulty: item.content.difficulty,
      questionText: item.content.questionText,
      passage: item.content.passage,
      explanationKo: item.content.explanationKo,
      explanationJa: item.content.explanationJa,
      tagNames: [...item.content.tagNames]
        .map((name) => normalizePhase7Text(name))
        .sort(compareUnicodeScalars),
      options: item.content.options.map((option) => ({
        clientOptionKey: option.clientOptionKey,
        text: option.text
      })),
      correctOptionKey: item.content.correctOptionKey
    }
  }))

export const createAdminImportValidationDigest = async (
  port: Sha256TextPort,
  items: readonly AdminImportItem[]
): Promise<string> =>
  sha256DomainSeparated(
    port,
    'nihongo-admin-import-v1',
    canonicalizeJson({
      schemaVersion: 1,
      items: normalizeAdminImportItems(items)
    })
  )

const importIssuePathMatchesCode = (
  itemIndex: number,
  fieldPath: string,
  code: z.output<typeof adminImportIssueCodeSchema>
): boolean => {
  const prefix = `/items/${itemIndex}`
  const suffix = fieldPath.slice(prefix.length)
  switch (code) {
    case 'DUPLICATE_CLIENT_ITEM_ID':
      return suffix === '/clientItemId'
    case 'DUPLICATE_CLIENT_OPTION_KEY':
      return /^\/content\/options\/[0-3]\/clientOptionKey$/u.test(suffix)
    case 'DUPLICATE_OPTION_TEXT':
      return /^\/content\/options\/[0-3]\/text$/u.test(suffix)
    case 'DUPLICATE_TAG':
    case 'UNKNOWN_TAG':
      return /^\/content\/tagNames\/(?:[0-9]|1[01])$/u.test(suffix)
    case 'CORRECT_OPTION_KEY_NOT_FOUND':
      return suffix === '/content/correctOptionKey'
    case 'INVALID_READING_PASSAGE':
      return suffix === '/content/passage'
    case 'INVALID_CONTENT':
      return suffix === '/content/questionType'
    case 'DUPLICATE_QUESTION_CONTENT':
      return suffix === '/content/questionText'
  }
}

export const assertAdminImportValidationForRequest = async (
  port: Sha256TextPort,
  rawRequest: unknown,
  rawResponse: unknown
): Promise<AdminImportValidationResponse> => {
  const request = validateQuestionImportRequestSchema.parse(rawRequest)
  const response = adminImportValidationResponseSchema.parse(rawResponse)
  if (response.itemCount !== request.items.length) {
    throw new Error('import validation itemCount가 request와 다릅니다.')
  }
  const digest = await createAdminImportValidationDigest(port, request.items)
  if (response.validationDigest !== digest) {
    throw new Error('import validation digest가 normalized request와 다릅니다.')
  }
  response.errors.forEach((error) => {
    if (
      error.itemIndex >= response.itemCount ||
      (error.fieldPath !== `/items/${error.itemIndex}` &&
        !error.fieldPath.startsWith(`/items/${error.itemIndex}/`)) ||
      !importIssuePathMatchesCode(error.itemIndex, error.fieldPath, error.code)
    ) {
      throw new Error(
        'import issue itemIndex/fieldPath binding이 유효하지 않습니다.'
      )
    }
  })
  return response
}

export const adminImportApplyItemSchema = z
  .object({
    clientItemId: exactKeySchema(64),
    questionId: opaqueIdSchema,
    questionVersionId: opaqueIdSchema,
    lifecycleStatus: z.literal('ACTIVE'),
    versionStatus: z.literal('DRAFT'),
    questionRowVersion: z.literal(1),
    versionRowVersion: z.literal(1)
  })
  .strict()

export const adminImportApplyResponseSchema = z
  .object({
    createdCount: z.number().int().min(1).max(100),
    items: z.array(adminImportApplyItemSchema).min(1).max(100),
    occurredAt: isoDateTimeSchema
  })
  .strict()
  .refine((response) => response.createdCount === response.items.length, {
    path: ['createdCount'],
    message: 'createdCount와 items.length가 같아야 합니다.'
  })

export const createAdminImportMappingDigest = async (
  port: Sha256TextPort,
  items: readonly AdminImportApplyItem[]
): Promise<string> =>
  sha256DomainSeparated(
    port,
    'nihongo-import-mapping-v1',
    canonicalizeJson(
      items.map(({ clientItemId, questionId, questionVersionId }) => ({
        clientItemId,
        questionId,
        questionVersionId
      }))
    )
  )

export interface AdminImportApplyAssertion {
  readonly response: AdminImportApplyResponse
  readonly mappingDigest: string
}

export const assertAdminImportApplyForRequest = async (
  port: Sha256TextPort,
  rawRequest: unknown,
  rawResponse: unknown,
  expectedMappingDigest?: string
): Promise<AdminImportApplyAssertion> => {
  const request = applyQuestionImportRequestSchema.parse(rawRequest)
  const response = adminImportApplyResponseSchema.parse(rawResponse)
  if (
    response.createdCount !== request.items.length ||
    response.items.some(
      (item, index) => item.clientItemId !== request.items[index]?.clientItemId
    )
  ) {
    throw new Error('import apply response가 request 순서/mapping과 다릅니다.')
  }
  const questionIds = new Set(response.items.map((item) => item.questionId))
  const versionIds = new Set(
    response.items.map((item) => item.questionVersionId)
  )
  if (
    questionIds.size !== response.items.length ||
    versionIds.size !== response.items.length
  ) {
    throw new Error('import apply created IDs는 각각 고유해야 합니다.')
  }
  const mappingDigest = await createAdminImportMappingDigest(
    port,
    response.items
  )
  if (
    expectedMappingDigest !== undefined &&
    sha256HexSchema.parse(expectedMappingDigest) !== mappingDigest
  ) {
    throw new Error(
      'import apply mappingDigest가 positional mapping과 다릅니다.'
    )
  }
  return { response, mappingDigest }
}

export const validateQuestionImportErrorCodeSchema = z.enum([
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
])
export const validateQuestionImportErrorSchema =
  createPhase7OperationErrorSchema(
    'validateQuestionImport',
    validateQuestionImportErrorCodeSchema
  )
export const applyQuestionImportErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'ADMIN_REQUIRED',
  'FRESH_ASSURANCE_REQUIRED',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'REQUEST_TOO_LARGE',
  'VALIDATION_ERROR',
  'IMPORT_IDENTITY_CONFLICT',
  'IMPORT_VALIDATION_FAILED',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const applyQuestionImportErrorSchema = createPhase7OperationErrorSchema(
  'applyQuestionImport',
  applyQuestionImportErrorCodeSchema
)

export const questionReportReasonSchema = z.enum([
  'ANSWER_ERROR',
  'EXPLANATION_ERROR',
  'TYPO_OR_GRAMMAR',
  'AMBIGUOUS',
  'LEVEL_OR_TAXONOMY',
  'OTHER'
])
export const questionReportStatusSchema = z.enum([
  'OPEN',
  'TRIAGED',
  'RESOLVED',
  'DISMISSED'
])
export const questionReportResolutionOutcomeSchema = z.enum([
  'RESOLVED',
  'DISMISSED'
])

const reportResolutionSchema = z
  .object({
    outcome: questionReportResolutionOutcomeSchema,
    reason: createPhase7TextSchema({ maxScalars: 1000, multiline: true }),
    remediationVersionId: opaqueIdSchema.nullable(),
    resolvedAt: isoDateTimeSchema
  })
  .strict()
  .superRefine((resolution, context) => {
    if (
      resolution.outcome === 'DISMISSED' &&
      resolution.remediationVersionId !== null
    ) {
      addIssue(
        context,
        ['remediationVersionId'],
        'DISMISSED remediationVersionId는 null이어야 합니다.'
      )
    }
  })

const reportBaseFields = {
  id: opaqueIdSchema,
  questionId: opaqueIdSchema,
  questionVersionId: opaqueIdSchema,
  reason: questionReportReasonSchema,
  status: questionReportStatusSchema,
  rowVersion: positiveSafeIntegerSchema,
  reporter: accountActorSnapshotSchema,
  assignee: accountActorSnapshotSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}

const refineReportStatus = (
  report: {
    readonly status: z.output<typeof questionReportStatusSchema>
    readonly assignee: z.output<typeof accountActorSnapshotSchema> | null
    readonly createdAt: string
    readonly updatedAt: string
    readonly resolution?: z.output<typeof reportResolutionSchema> | null
  },
  context: z.core.$RefinementCtx
): void => {
  if (Date.parse(report.createdAt) > Date.parse(report.updatedAt)) {
    addIssue(
      context,
      ['updatedAt'],
      'updatedAt은 createdAt보다 빠를 수 없습니다.'
    )
  }
  if (report.assignee !== null && report.assignee.role !== 'ADMIN') {
    addIssue(context, ['assignee'], 'assignee는 ADMIN actor여야 합니다.')
  }
  if (report.status === 'OPEN' && report.assignee !== null) {
    addIssue(context, ['assignee'], 'OPEN assignee는 null이어야 합니다.')
  }
  if (report.status !== 'OPEN' && report.assignee === null) {
    addIssue(context, ['assignee'], 'non-OPEN assignee는 필요합니다.')
  }
  if ('resolution' in report) {
    const terminal =
      report.status === 'RESOLVED' || report.status === 'DISMISSED'
    if (terminal !== (report.resolution !== null)) {
      addIssue(
        context,
        ['resolution'],
        'terminal status iff resolution non-null이어야 합니다.'
      )
    }
    if (
      report.resolution !== null &&
      (report.resolution.outcome !== report.status ||
        Date.parse(report.resolution.resolvedAt) <
          Date.parse(report.createdAt) ||
        Date.parse(report.resolution.resolvedAt) > Date.parse(report.updatedAt))
    ) {
      addIssue(
        context,
        ['resolution'],
        'resolution outcome/time이 status lifecycle과 다릅니다.'
      )
    }
  }
}

export const questionReportSummarySchema = z
  .object(reportBaseFields)
  .strict()
  .superRefine(refineReportStatus)

export const questionReportDetailSchema = z
  .object({
    ...reportBaseFields,
    description: createPhase7TextSchema({
      maxScalars: 2000,
      multiline: true
    }).nullable(),
    descriptionDigest: sha256HexSchema,
    resolution: reportResolutionSchema.nullable()
  })
  .strict()
  .superRefine(refineReportStatus)

export const questionReportMutationResultSchema = z
  .object({
    id: opaqueIdSchema,
    questionId: opaqueIdSchema,
    questionVersionId: opaqueIdSchema,
    status: questionReportStatusSchema,
    rowVersion: positiveSafeIntegerSchema,
    assignee: accountActorSnapshotSchema.nullable(),
    resolution: reportResolutionSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict()
  .superRefine(refineReportStatus)

export const createQuestionReportRequestSchema = z
  .object({
    questionVersionId: opaqueIdSchema,
    reason: questionReportReasonSchema,
    description: createPhase7TextSchema({ maxScalars: 2000, multiline: true })
  })
  .strict()
export const createQuestionReportResponseSchema =
  questionReportMutationResultSchema

export const adminQuestionReportSortSchema = z.enum([
  'UPDATED_DESC',
  'CREATED_DESC'
])
export const listAdminQuestionReportsQuerySchema = z
  .object({
    status: questionReportStatusSchema.optional(),
    reason: questionReportReasonSchema.optional(),
    questionId: opaqueIdSchema.optional(),
    assigneeActorId: opaqueIdSchema.optional(),
    createdFrom: isoDateTimeSchema.optional(),
    createdTo: isoDateTimeSchema.optional(),
    updatedFrom: isoDateTimeSchema.optional(),
    updatedTo: isoDateTimeSchema.optional(),
    sort: adminQuestionReportSortSchema.default('UPDATED_DESC'),
    page: z.coerce
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
  .strict()
  .superRefine((query, context) => {
    try {
      assertPhase7DateRange(query.createdFrom, query.createdTo)
      assertPhase7DateRange(query.updatedFrom, query.updatedTo)
    } catch (error) {
      addIssue(
        context,
        [],
        error instanceof Error ? error.message : 'invalid range'
      )
    }
  })
export const listAdminQuestionReportsResponseSchema = z
  .object({
    items: z.array(questionReportSummarySchema),
    page: positiveSafeIntegerSchema,
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()

export const getAdminQuestionReportParamsSchema = z
  .object({ reportId: opaqueIdSchema })
  .strict()
export const getAdminQuestionReportResponseSchema = questionReportDetailSchema
export const triageAdminQuestionReportParamsSchema =
  getAdminQuestionReportParamsSchema
export const triageAdminQuestionReportRequestSchema = z
  .object({ expectedRowVersion: positiveSafeIntegerSchema })
  .strict()
export const triageAdminQuestionReportResponseSchema =
  questionReportMutationResultSchema
export const resolveAdminQuestionReportParamsSchema =
  getAdminQuestionReportParamsSchema
export const resolveAdminQuestionReportRequestSchema = z.discriminatedUnion(
  'outcome',
  [
    z
      .object({
        expectedRowVersion: positiveSafeIntegerSchema,
        outcome: z.literal('RESOLVED'),
        reason: createPhase7TextSchema({ maxScalars: 1000, multiline: true }),
        remediationVersionId: opaqueIdSchema.nullable().optional()
      })
      .strict(),
    z
      .object({
        expectedRowVersion: positiveSafeIntegerSchema,
        outcome: z.literal('DISMISSED'),
        reason: createPhase7TextSchema({ maxScalars: 1000, multiline: true }),
        remediationVersionId: z.null().optional()
      })
      .strict()
  ]
)
export const resolveAdminQuestionReportResponseSchema =
  questionReportMutationResultSchema

export const assertCreateQuestionReportForRequest = (
  rawRequest: unknown,
  rawResponse: unknown
): QuestionReportMutationResult => {
  const request = createQuestionReportRequestSchema.parse(rawRequest)
  const response = createQuestionReportResponseSchema.parse(rawResponse)
  if (
    response.questionVersionId !== request.questionVersionId ||
    response.status !== 'OPEN' ||
    response.rowVersion !== 1 ||
    response.assignee !== null ||
    response.resolution !== null ||
    response.createdAt !== response.updatedAt
  ) {
    throw new Error(
      'report create response가 request/OPEN initial state와 다릅니다.'
    )
  }
  return response
}

const reportInHalfOpenRange = (
  value: string,
  from: string | undefined,
  to: string | undefined
): boolean =>
  (from === undefined || value >= from) && (to === undefined || value < to)

export const assertListAdminQuestionReportsForRequest = (
  rawRequest: unknown,
  rawResponse: unknown
): ListAdminQuestionReportsResponse => {
  const request = listAdminQuestionReportsQuerySchema.parse(rawRequest)
  const response = listAdminQuestionReportsResponseSchema.parse(rawResponse)
  if (
    response.page !== request.page ||
    response.pageSize !== request.pageSize
  ) {
    throw new Error(
      'report page/pageSize는 normalized request와 같아야 합니다.'
    )
  }
  if (response.items.length > request.pageSize) {
    throw new Error('report page item count가 pageSize를 초과했습니다.')
  }
  const offset = (BigInt(request.page) - 1n) * BigInt(request.pageSize)
  const total = BigInt(response.total)
  const remaining = total > offset ? total - offset : 0n
  const pageSize = BigInt(request.pageSize)
  const expectedCount = remaining < pageSize ? remaining : pageSize
  if (BigInt(response.items.length) !== expectedCount) {
    throw new Error('report page가 total bounds와 일치하지 않습니다.')
  }
  const ids = new Set<string>()
  response.items.forEach((report, index) => {
    if (ids.has(report.id)) {
      throw new Error('report ID는 page 안에서 고유해야 합니다.')
    }
    if (
      (request.status !== undefined && report.status !== request.status) ||
      (request.reason !== undefined && report.reason !== request.reason) ||
      (request.questionId !== undefined &&
        report.questionId !== request.questionId) ||
      (request.assigneeActorId !== undefined &&
        report.assignee?.actorId !== request.assigneeActorId) ||
      !reportInHalfOpenRange(
        report.createdAt,
        request.createdFrom,
        request.createdTo
      ) ||
      !reportInHalfOpenRange(
        report.updatedAt,
        request.updatedFrom,
        request.updatedTo
      )
    ) {
      throw new Error('report item이 request filter를 만족하지 않습니다.')
    }
    const previous = response.items[index - 1]
    if (previous !== undefined) {
      const timeComparison =
        request.sort === 'UPDATED_DESC'
          ? compareUnicodeScalars(previous.updatedAt, report.updatedAt)
          : compareUnicodeScalars(previous.createdAt, report.createdAt)
      if (
        timeComparison < 0 ||
        (timeComparison === 0 &&
          compareUnicodeScalars(previous.id, report.id) <= 0)
      ) {
        throw new Error('report items가 requested strict DESC sort가 아닙니다.')
      }
    }
    ids.add(report.id)
  })
  return response
}

export const assertGetAdminQuestionReportForRequest = (
  rawParams: unknown,
  rawResponse: unknown
): QuestionReportDetail => {
  const params = getAdminQuestionReportParamsSchema.parse(rawParams)
  const response = getAdminQuestionReportResponseSchema.parse(rawResponse)
  if (response.id !== params.reportId) {
    throw new Error('report detail ID가 path와 다릅니다.')
  }
  return response
}

export const assertTriageAdminQuestionReportResponse = (
  rawParams: unknown,
  rawRequest: unknown,
  rawResponse: unknown
): QuestionReportMutationResult => {
  const params = triageAdminQuestionReportParamsSchema.parse(rawParams)
  const request = triageAdminQuestionReportRequestSchema.parse(rawRequest)
  const response = triageAdminQuestionReportResponseSchema.parse(rawResponse)
  if (
    response.id !== params.reportId ||
    response.status !== 'TRIAGED' ||
    response.rowVersion !== request.expectedRowVersion + 1 ||
    response.assignee === null ||
    response.resolution !== null
  ) {
    throw new Error(
      'report triage response가 path/request/TRIAGED state와 다릅니다.'
    )
  }
  return response
}

export const createQuestionReportDescriptionDigest = async (
  port: Sha256TextPort,
  description: string
): Promise<string> =>
  sha256DomainSeparated(
    port,
    'nihongo-question-report-description-v1',
    normalizePhase7Text(description)
  )

export const assertQuestionReportDescriptionDigest = async (
  port: Sha256TextPort,
  detail: QuestionReportDetail
): Promise<void> => {
  if (detail.description === null) return
  const digest = await createQuestionReportDescriptionDigest(
    port,
    detail.description
  )
  if (digest !== detail.descriptionDigest) {
    throw new Error(
      'QuestionReport descriptionDigest가 description과 다릅니다.'
    )
  }
}

export const assertResolveAdminQuestionReportResponse = (
  rawParams: unknown,
  rawRequest: unknown,
  rawResponse: unknown
): QuestionReportMutationResult => {
  const params = resolveAdminQuestionReportParamsSchema.parse(rawParams)
  const request = resolveAdminQuestionReportRequestSchema.parse(rawRequest)
  const response = resolveAdminQuestionReportResponseSchema.parse(rawResponse)
  if (
    response.id !== params.reportId ||
    response.status !== request.outcome ||
    response.resolution?.outcome !== request.outcome ||
    response.resolution.reason !== request.reason ||
    response.resolution.remediationVersionId !==
      (request.remediationVersionId ?? null) ||
    response.resolution.resolvedAt !== response.updatedAt
  ) {
    throw new Error(
      'report resolution response가 path/request/event와 다릅니다.'
    )
  }
  return response
}

export const listAdminQuestionReportsErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'ADMIN_REQUIRED',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const getAdminQuestionReportErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'ADMIN_REQUIRED',
  'INVALID_ID',
  'RESOURCE_NOT_FOUND',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
export const listAdminQuestionReportsErrorSchema =
  createPhase7OperationErrorSchema(
    'listAdminQuestionReports',
    listAdminQuestionReportsErrorCodeSchema
  )
export const getAdminQuestionReportErrorSchema =
  createPhase7OperationErrorSchema(
    'getAdminQuestionReport',
    getAdminQuestionReportErrorCodeSchema
  )
export const createQuestionReportErrorCodeSchema = z.enum([
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
export const createQuestionReportErrorSchema = createPhase7OperationErrorSchema(
  'createQuestionReport',
  createQuestionReportErrorCodeSchema
)
export const triageAdminQuestionReportErrorCodeSchema = z.enum([
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
export const triageAdminQuestionReportErrorSchema =
  createPhase7OperationErrorSchema(
    'triageAdminQuestionReport',
    triageAdminQuestionReportErrorCodeSchema
  )
export const resolveAdminQuestionReportErrorCodeSchema = z.enum([
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
export const resolveAdminQuestionReportErrorSchema =
  createPhase7OperationErrorSchema(
    'resolveAdminQuestionReport',
    resolveAdminQuestionReportErrorCodeSchema
  )

export type AdminQuestionContentStructureInput = z.output<
  typeof adminQuestionContentStructureInputSchema
>
export type AdminQuestionContentInput = z.output<
  typeof adminQuestionContentInputSchema
>
export type AdminImportItem = z.output<typeof adminImportItemSchema>
export type ValidateQuestionImportRequest = z.output<
  typeof validateQuestionImportRequestSchema
>
export type ApplyQuestionImportRequest = z.output<
  typeof applyQuestionImportRequestSchema
>
export type AdminImportValidationResponse = z.output<
  typeof adminImportValidationResponseSchema
>
export type AdminImportApplyItem = z.output<typeof adminImportApplyItemSchema>
export type AdminImportApplyResponse = z.output<
  typeof adminImportApplyResponseSchema
>
export type QuestionReportSummary = z.output<typeof questionReportSummarySchema>
export type QuestionReportDetail = z.output<typeof questionReportDetailSchema>
export type QuestionReportMutationResult = z.output<
  typeof questionReportMutationResultSchema
>
export type CreateQuestionReportRequest = z.output<
  typeof createQuestionReportRequestSchema
>
export type ListAdminQuestionReportsQuery = z.output<
  typeof listAdminQuestionReportsQuerySchema
>
export type ListAdminQuestionReportsResponse = z.output<
  typeof listAdminQuestionReportsResponseSchema
>
export type ResolveAdminQuestionReportRequest = z.output<
  typeof resolveAdminQuestionReportRequestSchema
>
export type ValidateQuestionImportResponse = AdminImportValidationResponse
export type ApplyQuestionImportResponse = AdminImportApplyResponse
export type CreateQuestionReportResponse = z.output<
  typeof createQuestionReportResponseSchema
>
export type GetAdminQuestionReportParams = z.output<
  typeof getAdminQuestionReportParamsSchema
>
export type GetAdminQuestionReportResponse = z.output<
  typeof getAdminQuestionReportResponseSchema
>
export type TriageAdminQuestionReportParams = z.output<
  typeof triageAdminQuestionReportParamsSchema
>
export type TriageAdminQuestionReportRequest = z.output<
  typeof triageAdminQuestionReportRequestSchema
>
export type TriageAdminQuestionReportResponse = z.output<
  typeof triageAdminQuestionReportResponseSchema
>
export type ResolveAdminQuestionReportParams = z.output<
  typeof resolveAdminQuestionReportParamsSchema
>
export type ResolveAdminQuestionReportResponse = z.output<
  typeof resolveAdminQuestionReportResponseSchema
>
export type CreateQuestionReportErrorCode = z.output<
  typeof createQuestionReportErrorCodeSchema
>
export type TriageAdminQuestionReportErrorCode = z.output<
  typeof triageAdminQuestionReportErrorCodeSchema
>
export type ResolveAdminQuestionReportErrorCode = z.output<
  typeof resolveAdminQuestionReportErrorCodeSchema
>
export type CreateQuestionReportError = z.output<
  typeof createQuestionReportErrorSchema
>
export type ListAdminQuestionReportsError = z.output<
  typeof listAdminQuestionReportsErrorSchema
>
export type GetAdminQuestionReportError = z.output<
  typeof getAdminQuestionReportErrorSchema
>
export type TriageAdminQuestionReportError = z.output<
  typeof triageAdminQuestionReportErrorSchema
>
export type ResolveAdminQuestionReportError = z.output<
  typeof resolveAdminQuestionReportErrorSchema
>
