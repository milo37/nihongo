import { createHash, randomUUID } from 'node:crypto'
import {
  adminImportIssueCodeSchema,
  assertAdminQuestionExportDocumentForRequest,
  canonicalizeJson,
  compareUnicodeScalars,
  createAdminImportMappingDigest,
  createAdminImportValidationDigest,
  createPhase7QuestionDuplicateIdentity,
  isApplicablePhase7ContentType,
  normalizePhase7TagKey,
  type AdminImportApplyItem,
  type AdminImportApplyResponse,
  type AdminImportItem,
  type AdminImportValidationResponse,
  type AdminQuestionContentStructureInput,
  type AdminQuestionExportDocumentV1,
  type AdminReviewRequestBatchResult,
  type ApplyQuestionImportRequest,
  type CanonicalJsonValue,
  type ExportAdminQuestionsRequest,
  type QuestionReportMutationResult,
  type RequestContentReviewBatchRequest,
  type ResolveAdminQuestionReportRequest,
  type Sha256TextPort,
  type TriageAdminQuestionReportRequest,
  type ValidateQuestionImportRequest
} from '@nihongo/contracts/admin/phase7'
import type { StableErrorCode } from '@nihongo/contracts/common/error'
import { normalizeOptionComparison } from '@nihongo/domain/content/validators/v1/unicode'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import {
  AdminQuestionCommandRepositoryError,
  type AdminCommandAuthority
} from './adminQuestionCommandRepository.js'

type AuditEnvironment = 'TEST' | 'DEVELOPMENT'
type Slice5TransactionalOperation =
  | 'requestContentReviewBatch'
  | 'applyQuestionImport'
  | 'exportAdminQuestions'
  | 'triageAdminQuestionReport'
  | 'resolveAdminQuestionReport'

interface TargetManifestItem {
  readonly id: string
  readonly rowVersion: number
  readonly state: string
}

type AdminImportValidationIssue =
  AdminImportValidationResponse['errors'][number]

interface TargetManifest {
  readonly questions: readonly TargetManifestItem[]
  readonly versions: readonly TargetManifestItem[]
  readonly reports: readonly TargetManifestItem[]
  readonly tags: readonly string[]
}

interface OperationContext {
  readonly actorUserId: string
  readonly operationId: string
  readonly occurredAt: Date
}

interface BegunOperationRow {
  readonly actorUserId: string
  readonly operationId: string
}

interface OccurredAtRow {
  readonly occurredAt: Date
}

interface AuthorityProbeRow {
  readonly isFresh: boolean | null
  readonly principalRole: 'USER' | 'ADMIN' | null
  readonly principalUserId: string | null
}

interface AdminAuthorityClassificationRow {
  readonly outcome: 'ADMIN_REQUIRED' | 'AUTH_SESSION_EXPIRED'
}

interface TagApplicabilityRow {
  readonly id: string
  readonly label: string
  readonly normalizedName: string
  readonly level: AdminQuestionContentStructureInput['level']
  readonly subject: AdminQuestionContentStructureInput['subject']
  readonly questionType: AdminQuestionContentStructureInput['questionType']
}

interface BatchTargetRow {
  readonly questionId: string
  readonly questionLifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  readonly questionRowVersion: number
  readonly questionCreatedByUserId: string | null
  readonly versionId: string
  readonly versionStatus:
    | 'DRAFT'
    | 'IN_REVIEW'
    | 'CHANGES_REQUESTED'
    | 'APPROVED'
    | 'PUBLISHED'
    | 'RETIRED'
  readonly versionRowVersion: number
  readonly versionCreatedByUserId: string | null
}

interface ExportQuestionRow {
  readonly id: string
  readonly lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  readonly currentPublishedVersionId: string | null
  readonly rowVersion: number
  readonly createdByUserId: string | null
}

interface ExportVersionRow {
  readonly id: string
  readonly questionId: string
  readonly versionNumber: number
  readonly status:
    | 'DRAFT'
    | 'IN_REVIEW'
    | 'CHANGES_REQUESTED'
    | 'APPROVED'
    | 'PUBLISHED'
    | 'RETIRED'
  readonly rowVersion: number
  readonly createdByUserId: string | null
  readonly level: AdminQuestionContentStructureInput['level']
  readonly subject: AdminQuestionContentStructureInput['subject']
  readonly questionType: AdminQuestionContentStructureInput['questionType']
  readonly difficulty: AdminQuestionContentStructureInput['difficulty']
  readonly passage: string | null
  readonly questionText: string
  readonly explanationKo: string
  readonly explanationJa: string | null
  readonly correctOptionId: string
}

type ExportVersionManifestRow = Pick<
  ExportVersionRow,
  'id' | 'questionId' | 'versionNumber' | 'status' | 'rowVersion'
>

interface ExportOptionRow {
  readonly id: string
  readonly questionVersionId: string
  readonly ordinal: number
  readonly text: string
}

interface ExportTagRow {
  readonly id: string
  readonly questionVersionId: string
  readonly label: string
  readonly normalizedName: string
}

interface ExportReviewUserRow {
  readonly userId: string
}

interface ExportRetainedManifestRow {
  readonly questionId: string
  readonly versionCount: bigint
  readonly maxVersionNumber: number
  readonly orderedVersionIds: string[]
}

interface ExportTimestampRow {
  readonly exportedAt: Date
}

interface ExportAuditReconciliationRow {
  readonly operationId: string
  readonly command: string
  readonly targetType: string
  readonly targetId: string
  readonly actorId: string | null
  readonly requestId: string
  readonly environment: string
  readonly changedFields: unknown
  readonly metadata: unknown
  readonly contentDigest: string
  readonly occurredAt: Date
}

interface AuditDigestRow {
  readonly contentDigest: string
}

interface ReportTargetRow {
  readonly id: string
  readonly questionId: string
  readonly questionVersionId: string
  readonly status: 'OPEN' | 'TRIAGED' | 'RESOLVED' | 'DISMISSED'
  readonly rowVersion: number
  readonly reporterUserId: string | null
  readonly assigneeUserId: string | null
  readonly questionLifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  readonly questionRowVersion: number
  readonly questionCreatedByUserId: string | null
  readonly versionStatus: BatchTargetRow['versionStatus']
  readonly versionRowVersion: number
  readonly versionNumber: number
  readonly versionCreatedByUserId: string | null
}

interface RemediationTargetRow {
  readonly id: string
  readonly questionId: string
  readonly status: BatchTargetRow['versionStatus']
  readonly rowVersion: number
  readonly versionNumber: number
  readonly retirementKind:
    | 'PUBLISHED_RETIREMENT'
    | 'AUTHOR_ERASURE_ABANDONED'
    | 'QUESTION_ARCHIVE_ABANDONED'
    | null
  readonly publishedAt: Date | null
  readonly createdByUserId: string | null
}

interface ReportMutationRow {
  readonly id: string
  readonly questionId: string
  readonly questionVersionId: string
  readonly status: 'OPEN' | 'TRIAGED' | 'RESOLVED' | 'DISMISSED'
  readonly rowVersion: number
  readonly assigneeActorId: string | null
  readonly assigneeRole: 'ADMIN' | null
  readonly assigneeLabel: 'ACTIVE_ADMIN' | 'DELETED_ADMIN' | null
  readonly resolutionOutcome: 'RESOLVED' | 'DISMISSED' | null
  readonly resolutionReason: string | null
  readonly remediationVersionId: string | null
  readonly resolvedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

const CREATE_CHANGED_FIELDS = [
  'LIFECYCLE_STATUS',
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

const EXPORT_BODY_CAP = 8 * 1024 * 1024
const EXPORT_VERSION_BATCH_SIZE = 25
const FRESH_OPERATIONS = new Set<Slice5TransactionalOperation>([
  'requestContentReviewBatch',
  'applyQuestionImport',
  'exportAdminQuestions',
  'resolveAdminQuestionReport'
])
const AUTHORITY_FAILURE_MESSAGES = new Set([
  'Phase 7 operation requires an existing Session.',
  'Phase 7 operation Session family is unavailable.',
  'Phase 7 operation Session is unavailable.',
  'Phase 7 operation authority is stale or insufficient.',
  'Phase 7 authority expired before commit.',
  'A referenced Phase 7 User is unavailable.',
  'Phase 7 referenced User set is not exact for its targets.'
])

const sha256Port: Sha256TextPort = {
  digestUtf8: async (value) =>
    createHash('sha256').update(value, 'utf8').digest('hex')
}

const toIso = (value: Date): string => value.toISOString()

const uniqueSorted = (values: readonly (string | null)[]): string[] =>
  [...new Set(values.filter((value): value is string => value !== null))].sort()

const repositoryFailure = (
  code: StableErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>
): AdminQuestionCommandRepositoryError =>
  new AdminQuestionCommandRepositoryError({
    code,
    message,
    disposition: 'NO_TX',
    ...(fieldErrors ? { fieldErrors } : {})
  })

const repositoryInvariantFailure = (
  message: string,
  cause?: unknown
): AdminQuestionCommandRepositoryError =>
  new AdminQuestionCommandRepositoryError({
    code: 'SERVICE_UNAVAILABLE',
    message,
    disposition: 'NO_TX',
    ...(cause === undefined ? {} : { cause })
  })

const rawDatabaseIdentity = (
  error: unknown
): { readonly sqlState: string; readonly message: string } | undefined => {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2010' ||
    typeof error.meta !== 'object' ||
    error.meta === null
  ) {
    return undefined
  }
  const meta = error.meta as Record<string, unknown>
  const identities: Array<{ sqlState: string; message: string }> = []
  if (typeof meta.code === 'string' && typeof meta.message === 'string') {
    identities.push({ sqlState: meta.code, message: meta.message })
  }
  const driver = meta.driverAdapterError
  if (typeof driver === 'object' && driver !== null) {
    const cause = (driver as Record<string, unknown>).cause
    if (typeof cause === 'object' && cause !== null) {
      const record = cause as Record<string, unknown>
      if (
        typeof record.originalCode === 'string' &&
        typeof record.originalMessage === 'string'
      ) {
        identities.push({
          sqlState: record.originalCode,
          message: record.originalMessage
        })
      }
    }
  }
  const [first, ...rest] = identities
  if (
    !first ||
    rest.some(
      (identity) =>
        identity.sqlState !== first.sqlState ||
        identity.message !== first.message
    )
  ) {
    return undefined
  }
  return {
    sqlState: first.sqlState,
    message:
      first.message
        .split('\n', 1)[0]
        ?.replace(/^ERROR:\s*/u, '')
        .trim() ?? ''
  }
}

const rawSqlState = (error: unknown): string | undefined => {
  const identity = rawDatabaseIdentity(error)
  if (identity) return identity.sqlState
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  ) {
    return '40001'
  }
  return undefined
}

const isSerializationFailure = (error: unknown): boolean =>
  ['40001', '40P01'].includes(rawSqlState(error) ?? '') ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034')

const beginOperation = async (
  transaction: Prisma.TransactionClient,
  input: {
    readonly auditEnvironment: AuditEnvironment
    readonly authority: AdminCommandAuthority
    readonly command: string
    readonly referencedUserIds: readonly string[]
  }
): Promise<BegunOperationRow> => {
  const rows = await transaction.$queryRawUnsafe<BegunOperationRow[]>(
    `SELECT * FROM "phase7_begin_admin_operation"(
       $1::"AdminAuditCommand", $2, $3, $4::"AdminAuditEnvironment", $5::uuid[]
     )`,
    input.command,
    input.authority.rawSessionToken,
    input.authority.requestId,
    input.auditEnvironment,
    input.referencedUserIds
  )
  const operation = rows[0]
  if (!operation || operation.actorUserId !== input.authority.actorId) {
    throw repositoryInvariantFailure(
      'Phase 7 operation actor did not match the request actor.'
    )
  }
  return operation
}

const armOperation = async (
  transaction: Prisma.TransactionClient,
  operation: BegunOperationRow,
  manifest: TargetManifest
): Promise<OperationContext> => {
  const rows = await transaction.$queryRawUnsafe<OccurredAtRow[]>(
    `SELECT "phase7_arm_admin_operation"($1, $2::jsonb) AS "occurredAt"`,
    operation.operationId,
    JSON.stringify(manifest)
  )
  const occurredAt = rows[0]?.occurredAt
  if (!(occurredAt instanceof Date) || !Number.isFinite(occurredAt.getTime())) {
    throw repositoryInvariantFailure(
      'Phase 7 operation timestamp is unavailable.'
    )
  }
  return { ...operation, occurredAt }
}

const finishOperation = async (
  transaction: Prisma.TransactionClient,
  operationId: string
): Promise<void> => {
  await transaction.$executeRawUnsafe(
    `SELECT "phase7_finish_admin_operation"($1)`,
    operationId
  )
}

type AuditMetadata =
  | { readonly kind: 'NONE_V1' }
  | { readonly kind: 'REVIEW_REQUEST_BATCH_V1'; readonly itemCount: number }
  | {
      readonly kind: 'IMPORT_APPLY_V1'
      readonly validationDigest: string
      readonly mappingDigest: string
      readonly itemCount: number
    }
  | {
      readonly kind: 'EXPORT_V1'
      readonly selectionDigest: string
      readonly responseBodyDigest: string
      readonly questionCount: number
      readonly versionCount: number
    }

const insertAudit = async (
  transaction: Prisma.TransactionClient,
  input: {
    readonly actorId: string
    readonly afterRowVersion: number | null
    readonly afterState: string | null
    readonly beforeRowVersion: number | null
    readonly beforeState: string | null
    readonly changedFields: readonly string[]
    readonly command: string
    readonly environment: AuditEnvironment
    readonly occurredAt: Date
    readonly operationId: string
    readonly requestId: string
    readonly targetId: string
    readonly targetType:
      | 'QUESTION'
      | 'QUESTION_VERSION'
      | 'QUESTION_REPORT'
      | 'REVIEW_REQUEST_BATCH'
      | 'IMPORT_REQUEST'
      | 'EXPORT_REQUEST'
    readonly metadata?: AuditMetadata
  }
): Promise<string> => {
  const changedFields = JSON.stringify(input.changedFields)
  const metadata = JSON.stringify(input.metadata ?? { kind: 'NONE_V1' })
  const rows = await transaction.$queryRawUnsafe<AuditDigestRow[]>(
    `INSERT INTO "AdminAuditLog" (
       "command", "targetType", "targetId", "actorKind",
       "actorUserId", "actorId", "actorRole", "actorLabel",
       "beforeState", "afterState", "beforeRowVersion", "afterRowVersion",
       "changedFields", "metadata", "contentDigest", "operationId",
       "requestId", "environment", "occurredAt"
     ) VALUES (
       $1::"AdminAuditCommand", $2::"AdminAuditTargetType", $3, 'ACCOUNT',
       $4, $4, 'ADMIN', 'ACTIVE_ADMIN', $5::text, $6::text, $7, $8,
       $9::jsonb, $10::jsonb,
       "phase7_admin_audit_content_digest"(
         $11, $1::"AdminAuditCommand", $2::"AdminAuditTargetType", $3,
       $5::text, $6::text, $7, $8, $9::jsonb, $10::jsonb
       ), $11, $12, $13::"AdminAuditEnvironment", $14
     ) RETURNING "contentDigest"`,
    input.command,
    input.targetType,
    input.targetId,
    input.actorId,
    input.beforeState,
    input.afterState,
    input.beforeRowVersion,
    input.afterRowVersion,
    changedFields,
    metadata,
    input.operationId,
    input.requestId,
    input.environment,
    input.occurredAt
  )
  const contentDigest = rows[0]?.contentDigest
  if (
    rows.length !== 1 ||
    typeof contentDigest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(contentDigest)
  ) {
    throw repositoryInvariantFailure(
      'Admin audit content digest is unavailable.'
    )
  }
  return contentDigest
}

const insertReview = async (
  transaction: Prisma.TransactionClient,
  input: {
    readonly actorId: string
    readonly comment: string | null
    readonly fromState: BatchTargetRow['versionStatus']
    readonly occurredAt: Date
    readonly operationId: string
    readonly questionId: string
    readonly requestId: string
    readonly versionId: string
  }
): Promise<void> => {
  await transaction.$executeRawUnsafe(
    `INSERT INTO "ContentReview" (
       "questionId", "questionVersionId", "action", "fromState", "toState",
       "actorKind", "actorUserId", "actorId", "actorRole", "actorLabel",
       "counterpartUserId", "counterpartActorId", "counterpartRole",
       "counterpartLabel", "reason", "comment", "operationId", "requestId",
       "occurredAt"
     ) VALUES (
       $1, $2, 'REQUESTED', $3::"QuestionVersionStatus", 'IN_REVIEW',
       'ACCOUNT', $4, $4, 'ADMIN', 'ACTIVE_ADMIN', NULL, NULL, NULL, NULL,
       NULL, $5, $6, $7, $8
     )`,
    input.questionId,
    input.versionId,
    input.fromState,
    input.actorId,
    input.comment,
    input.operationId,
    input.requestId,
    input.occurredAt
  )
}

const contentFingerprint = (
  content: AdminQuestionContentStructureInput
): string => {
  const correctOptionText =
    content.options.find(
      (option) => option.clientOptionKey === content.correctOptionKey
    )?.text ?? ''
  return createHash('sha256')
    .update(
      createPhase7QuestionDuplicateIdentity({
        correctOptionText,
        optionTexts: content.options.map((option) => option.text),
        passage: content.passage,
        questionText: content.questionText,
        questionType: content.questionType,
        subject: content.subject
      }),
      'utf8'
    )
    .digest('hex')
}

const applicabilityKey = (
  normalizedName: string,
  content: Pick<
    AdminQuestionContentStructureInput,
    'level' | 'subject' | 'questionType'
  >
): string =>
  `${normalizedName}\u0000${content.level}\u0000${content.subject}\u0000${content.questionType}`

const loadApplicableTags = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  items: readonly AdminImportItem[]
): Promise<TagApplicabilityRow[]> => {
  const normalizedNames = uniqueSorted(
    items.flatMap((item) => item.content.tagNames.map(normalizePhase7TagKey))
  )
  if (normalizedNames.length === 0) return []
  return client.$queryRawUnsafe<TagApplicabilityRow[]>(
    `SELECT tag."id", tag."label", tag."normalizedName",
       applicability."level", applicability."subject",
       applicability."questionType"
     FROM "Tag" AS tag
     JOIN "TagApplicability" AS applicability
       ON applicability."tagId" = tag."id"
     WHERE tag."normalizedName" = ANY($1::text[])
     ORDER BY tag."normalizedName" COLLATE "C", tag."id",
       applicability."level", applicability."subject",
       applicability."questionType"`,
    normalizedNames
  )
}

const loadExistingFingerprints = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  fingerprints: readonly string[]
): Promise<Set<string>> => {
  if (fingerprints.length === 0) return new Set()
  const rows = await client.$queryRawUnsafe<
    Array<{ readonly contentFingerprint: string }>
  >(
    `SELECT DISTINCT "contentFingerprint" FROM "QuestionVersion"
     WHERE "contentFingerprint" = ANY($1::varchar[])`,
    fingerprints
  )
  return new Set(rows.map((row) => row.contentFingerprint))
}

const eligibleImportFingerprints = (
  items: readonly AdminImportItem[]
): string[] =>
  uniqueSorted(
    items.map((item) => {
      const optionKeys = new Set<string>()
      const optionTexts = new Set<string>()
      let duplicateOptionKey = false
      let duplicateOptionText = false
      for (const option of item.content.options) {
        if (optionKeys.has(option.clientOptionKey)) duplicateOptionKey = true
        const normalizedText = normalizeOptionComparison(option.text)
        if (optionTexts.has(normalizedText)) duplicateOptionText = true
        optionKeys.add(option.clientOptionKey)
        optionTexts.add(normalizedText)
      }
      const correctKeyMatchCount = item.content.options.filter(
        (option) => option.clientOptionKey === item.content.correctOptionKey
      ).length
      const passageIsValid =
        item.content.subject === 'READING'
          ? item.content.passage !== null
          : item.content.questionType === 'TEXT_GRAMMAR' ||
            item.content.passage === null
      return !duplicateOptionKey &&
        !duplicateOptionText &&
        correctKeyMatchCount === 1 &&
        passageIsValid &&
        isApplicablePhase7ContentType(
          item.content.level,
          item.content.subject,
          item.content.questionType
        )
        ? contentFingerprint(item.content)
        : null
    })
  )

const pushIssue = (
  issues: AdminImportValidationIssue[],
  issue: AdminImportValidationIssue
): void => {
  if (
    !issues.some(
      (existing) =>
        existing.itemIndex === issue.itemIndex &&
        existing.fieldPath === issue.fieldPath &&
        existing.code === issue.code
    )
  ) {
    issues.push(issue)
  }
}

const collectImportValidation = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  items: readonly AdminImportItem[]
): Promise<{
  readonly response: AdminImportValidationResponse
  readonly applicableTags: readonly TagApplicabilityRow[]
}> => {
  const [applicableTags, validationDigest] = await Promise.all([
    loadApplicableTags(client, items),
    createAdminImportValidationDigest(sha256Port, items)
  ])
  const applicableTagKeys = new Set(
    applicableTags.map((tag) => applicabilityKey(tag.normalizedName, tag))
  )
  const issues: AdminImportValidationIssue[] = []
  const seenItemIds = new Set<string>()
  const eligibleFingerprints: Array<string | null> = items.map(() => null)

  items.forEach((item, itemIndex) => {
    const prefix = `/items/${itemIndex}`
    if (seenItemIds.has(item.clientItemId)) {
      pushIssue(issues, {
        itemIndex,
        fieldPath: `${prefix}/clientItemId`,
        code: 'DUPLICATE_CLIENT_ITEM_ID',
        message: 'clientItemId는 import 요청 안에서 고유해야 합니다.'
      })
    }
    seenItemIds.add(item.clientItemId)

    const optionKeys = new Set<string>()
    const optionTexts = new Set<string>()
    let hasDuplicateOptionKey = false
    let hasDuplicateOptionText = false
    item.content.options.forEach((option, optionIndex) => {
      if (optionKeys.has(option.clientOptionKey)) {
        hasDuplicateOptionKey = true
        pushIssue(issues, {
          itemIndex,
          fieldPath: `${prefix}/content/options/${optionIndex}/clientOptionKey`,
          code: 'DUPLICATE_CLIENT_OPTION_KEY',
          message: 'clientOptionKey는 문제 안에서 고유해야 합니다.'
        })
      }
      const normalizedText = normalizeOptionComparison(option.text)
      if (optionTexts.has(normalizedText)) {
        hasDuplicateOptionText = true
        pushIssue(issues, {
          itemIndex,
          fieldPath: `${prefix}/content/options/${optionIndex}/text`,
          code: 'DUPLICATE_OPTION_TEXT',
          message: '정규화된 보기 내용은 문제 안에서 고유해야 합니다.'
        })
      }
      optionKeys.add(option.clientOptionKey)
      optionTexts.add(normalizedText)
    })
    const correctKeyMatchCount = item.content.options.filter(
      (option) => option.clientOptionKey === item.content.correctOptionKey
    ).length
    if (correctKeyMatchCount === 0) {
      pushIssue(issues, {
        itemIndex,
        fieldPath: `${prefix}/content/correctOptionKey`,
        code: 'CORRECT_OPTION_KEY_NOT_FOUND',
        message: 'correctOptionKey는 같은 문제의 보기 key여야 합니다.'
      })
    }

    const tagKeys = new Set<string>()
    item.content.tagNames.forEach((tagName, tagIndex) => {
      const normalizedName = normalizePhase7TagKey(tagName)
      if (tagKeys.has(normalizedName)) {
        pushIssue(issues, {
          itemIndex,
          fieldPath: `${prefix}/content/tagNames/${tagIndex}`,
          code: 'DUPLICATE_TAG',
          message: '정규화된 태그는 문제 안에서 고유해야 합니다.'
        })
      }
      if (
        !applicableTagKeys.has(applicabilityKey(normalizedName, item.content))
      ) {
        pushIssue(issues, {
          itemIndex,
          fieldPath: `${prefix}/content/tagNames/${tagIndex}`,
          code: 'UNKNOWN_TAG',
          message: '존재하며 문제 분류에 적용 가능한 태그가 필요합니다.'
        })
      }
      tagKeys.add(normalizedName)
    })

    const passageIsValid =
      item.content.subject === 'READING'
        ? item.content.passage !== null
        : item.content.questionType === 'TEXT_GRAMMAR' ||
          item.content.passage === null
    if (!passageIsValid) {
      pushIssue(issues, {
        itemIndex,
        fieldPath: `${prefix}/content/passage`,
        code: 'INVALID_READING_PASSAGE',
        message: '문제 분류에 맞는 passage 구성이 필요합니다.'
      })
    }
    const contentIsValid = isApplicablePhase7ContentType(
      item.content.level,
      item.content.subject,
      item.content.questionType
    )
    if (!contentIsValid) {
      pushIssue(issues, {
        itemIndex,
        fieldPath: `${prefix}/content/questionType`,
        code: 'INVALID_CONTENT',
        message: 'level/subject/questionType 조합이 올바르지 않습니다.'
      })
    }

    if (
      !hasDuplicateOptionKey &&
      !hasDuplicateOptionText &&
      correctKeyMatchCount === 1 &&
      passageIsValid &&
      contentIsValid
    ) {
      eligibleFingerprints[itemIndex] = contentFingerprint(item.content)
    }
  })

  const existingFingerprints = await loadExistingFingerprints(
    client,
    uniqueSorted(eligibleFingerprints)
  )
  const seenFingerprints = new Set<string>()
  eligibleFingerprints.forEach((fingerprint, itemIndex) => {
    if (fingerprint === null) return
    if (
      existingFingerprints.has(fingerprint) ||
      seenFingerprints.has(fingerprint)
    ) {
      pushIssue(issues, {
        itemIndex,
        fieldPath: `/items/${itemIndex}/content/questionText`,
        code: 'DUPLICATE_QUESTION_CONTENT',
        message: '동일한 내용의 문제가 이미 존재합니다.'
      })
    }
    seenFingerprints.add(fingerprint)
  })

  issues.sort(
    (left, right) =>
      left.itemIndex - right.itemIndex ||
      compareUnicodeScalars(left.fieldPath, right.fieldPath) ||
      adminImportIssueCodeSchema.options.indexOf(left.code) -
        adminImportIssueCodeSchema.options.indexOf(right.code) ||
      compareUnicodeScalars(left.message, right.message)
  )
  return {
    response: {
      valid: issues.length === 0,
      validationDigest,
      itemCount: items.length,
      errors: issues
    },
    applicableTags
  }
}

type ImportValidationResult = Awaited<
  ReturnType<typeof collectImportValidation>
>

const assertImportApplyValidation = (
  request: ApplyQuestionImportRequest,
  validation: ImportValidationResult
): void => {
  if (validation.response.validationDigest !== request.validationDigest) {
    throw repositoryFailure(
      'IMPORT_IDENTITY_CONFLICT',
      'import 검증 digest와 적용 요청이 일치하지 않습니다.'
    )
  }
  if (validation.response.valid) return

  const fieldErrors: Record<string, string[]> = {}
  validation.response.errors.forEach((issue) => {
    fieldErrors[issue.fieldPath] = [
      ...(fieldErrors[issue.fieldPath] ?? []),
      issue.message
    ]
  })
  throw repositoryFailure(
    'IMPORT_VALIDATION_FAILED',
    'import 의미 검증을 통과하지 못했습니다.',
    fieldErrors
  )
}

const createVersionContent = async (
  transaction: Prisma.TransactionClient,
  input: {
    readonly actorId: string
    readonly content: AdminQuestionContentStructureInput
    readonly occurredAt: Date
    readonly questionId: string
    readonly tags: readonly TagApplicabilityRow[]
    readonly versionId: string
  }
): Promise<void> => {
  const optionIdByKey = new Map(
    input.content.options.map((option) => [
      option.clientOptionKey,
      randomUUID()
    ])
  )
  const correctOptionId = optionIdByKey.get(input.content.correctOptionKey)
  if (!correctOptionId) {
    throw repositoryFailure(
      'IMPORT_VALIDATION_FAILED',
      '정답 보기 key가 존재하지 않습니다.'
    )
  }
  await transaction.$executeRawUnsafe(
    `INSERT INTO "QuestionVersion" (
       "id", "questionId", "versionNumber", "level", "subject",
       "questionType", "passage", "questionText", "correctOptionId",
       "explanationKo", "explanationJa", "difficulty", "contentFingerprint",
       "createdByUserId", "createdByActorId", "createdByRoleSnapshot",
       "createdByLabelSnapshot", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, 1, $3::"JlptLevel", $4::"QuestionSubject",
       $5::"QuestionType", $6, $7, $8, $9, $10,
       $11::"QuestionDifficulty", repeat('0', 64), $12, $12, 'ADMIN',
       'ACTIVE_ADMIN', $13, $13
     )`,
    input.versionId,
    input.questionId,
    input.content.level,
    input.content.subject,
    input.content.questionType,
    input.content.passage,
    input.content.questionText,
    correctOptionId,
    input.content.explanationKo,
    input.content.explanationJa,
    input.content.difficulty,
    input.actorId,
    input.occurredAt
  )
  for (const [index, option] of input.content.options.entries()) {
    await transaction.$executeRawUnsafe(
      `INSERT INTO "QuestionOption" (
         "id", "questionVersionId", "label", "text", "ordinal"
       ) VALUES ($1, $2, $3, $4, $5)`,
      optionIdByKey.get(option.clientOptionKey),
      input.versionId,
      String(index + 1),
      option.text,
      index + 1
    )
  }
  for (const tag of input.tags) {
    await transaction.$executeRawUnsafe(
      `INSERT INTO "QuestionVersionTag" (
         "id", "questionVersionId", "tagId", "labelSnapshot",
         "normalizedNameSnapshot"
       ) VALUES ($1, $2, $3, $4, $5)`,
      randomUUID(),
      input.versionId,
      tag.id,
      tag.label,
      tag.normalizedName
    )
  }
  await transaction.$executeRawUnsafe(
    `UPDATE "QuestionVersion" SET "questionText" = "questionText"
     WHERE "id" = $1`,
    input.versionId
  )
}

const loadBatchTargets = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  versionIds: readonly string[]
): Promise<BatchTargetRow[]> =>
  client.$queryRawUnsafe<BatchTargetRow[]>(
    `SELECT question."id" AS "questionId",
       question."lifecycleStatus" AS "questionLifecycleStatus",
       question."rowVersion" AS "questionRowVersion",
       question."createdByUserId" AS "questionCreatedByUserId",
       version."id" AS "versionId", version."status" AS "versionStatus",
       version."rowVersion" AS "versionRowVersion",
       version."createdByUserId" AS "versionCreatedByUserId"
     FROM "QuestionVersion" AS version
     JOIN "Question" AS question ON question."id" = version."questionId"
     WHERE version."id" = ANY($1::uuid[])
     ORDER BY version."id"`,
    versionIds
  )

const exportTooLargeFailure = (): AdminQuestionCommandRepositoryError =>
  repositoryFailure(
    'VALIDATION_ERROR',
    '선택한 문제의 내보내기 결과가 8 MiB를 초과합니다.',
    { questionIds: ['더 작은 문제 묶음으로 나누어 내보내 주세요.'] }
  )

class BoundedExportBody {
  #buffer: Buffer | null = Buffer.allocUnsafe(EXPORT_BODY_CAP)
  #byteLength = 0

  append(fragment: string): void {
    const bytes = Buffer.from(fragment, 'utf8')
    const nextLength = this.#byteLength + bytes.byteLength
    if (nextLength > EXPORT_BODY_CAP) throw exportTooLargeFailure()
    if (!this.#buffer) {
      throw repositoryInvariantFailure('Export body was already finalized.')
    }
    bytes.copy(this.#buffer, this.#byteLength)
    this.#byteLength = nextLength
  }

  value(): string {
    if (!this.#buffer) {
      throw repositoryInvariantFailure('Export body was already finalized.')
    }
    const value = this.#buffer.toString('utf8', 0, this.#byteLength)
    this.#buffer = null
    return value
  }
}

const loadExportReferencedUsers = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  questionIds: readonly string[]
): Promise<ExportReviewUserRow[]> =>
  client.$queryRawUnsafe<ExportReviewUserRow[]>(
    `SELECT DISTINCT live_user."userId"
     FROM (
       SELECT question."createdByUserId" AS "userId"
       FROM "Question" AS question
       WHERE question."id" = ANY($1::uuid[])
       UNION
       SELECT version."createdByUserId" AS "userId"
       FROM "QuestionVersion" AS version
       WHERE version."questionId" = ANY($1::uuid[])
       UNION
       SELECT review."actorUserId" AS "userId"
       FROM "ContentReview" AS review
       JOIN "QuestionVersion" AS version
         ON version."id" = review."questionVersionId"
       WHERE version."questionId" = ANY($1::uuid[])
       UNION
       SELECT review."counterpartUserId" AS "userId"
       FROM "ContentReview" AS review
       JOIN "QuestionVersion" AS version
         ON version."id" = review."questionVersionId"
       WHERE version."questionId" = ANY($1::uuid[])
     ) AS live_user
     WHERE live_user."userId" IS NOT NULL
     ORDER BY live_user."userId"`,
    questionIds
  )

const loadExportQuestions = async (
  transaction: Prisma.TransactionClient,
  questionIds: readonly string[]
): Promise<ExportQuestionRow[]> =>
  transaction.$queryRawUnsafe<ExportQuestionRow[]>(
    `SELECT "id", "lifecycleStatus", "currentPublishedVersionId",
       "rowVersion", "createdByUserId"
     FROM "Question" WHERE "id" = ANY($1::uuid[])
     ORDER BY "id"`,
    questionIds
  )

const loadExportVersionPage = async (
  transaction: Prisma.TransactionClient,
  questionId: string,
  cursor: Pick<ExportVersionRow, 'id' | 'versionNumber'> | null
): Promise<ExportVersionRow[]> =>
  transaction.$queryRawUnsafe<ExportVersionRow[]>(
    `SELECT "id", "questionId", "versionNumber", "status", "rowVersion",
       "createdByUserId", "level", "subject", "questionType", "difficulty",
       "passage", "questionText", "explanationKo", "explanationJa",
       "correctOptionId"
     FROM "QuestionVersion"
     WHERE "questionId" = $1
       AND ($2::integer IS NULL OR "versionNumber" > $2
         OR ("versionNumber" = $2 AND "id" > $3::uuid))
     ORDER BY "versionNumber", "id"
     LIMIT $4`,
    questionId,
    cursor?.versionNumber ?? null,
    cursor?.id ?? null,
    EXPORT_VERSION_BATCH_SIZE
  )

const loadExportVersionChildren = async (
  transaction: Prisma.TransactionClient,
  versionIds: readonly string[]
): Promise<{
  readonly options: readonly ExportOptionRow[]
  readonly tags: readonly ExportTagRow[]
}> => {
  const options = await transaction.$queryRawUnsafe<ExportOptionRow[]>(
    `SELECT "id", "questionVersionId", "ordinal", "text"
     FROM "QuestionOption" WHERE "questionVersionId" = ANY($1::uuid[])
     ORDER BY "questionVersionId", "ordinal", "id"`,
    versionIds
  )
  const tags = await transaction.$queryRawUnsafe<ExportTagRow[]>(
    `SELECT assignment."questionVersionId", assignment."tagId" AS "id",
       assignment."labelSnapshot" AS "label",
       assignment."normalizedNameSnapshot" AS "normalizedName"
     FROM "QuestionVersionTag" AS assignment
     WHERE assignment."questionVersionId" = ANY($1::uuid[])
     ORDER BY assignment."questionVersionId",
       assignment."normalizedNameSnapshot" COLLATE "C", assignment."id"`,
    versionIds
  )
  return { options, tags }
}

const loadExportRetainedManifest = async (
  transaction: Prisma.TransactionClient,
  questionIds: readonly string[]
): Promise<ExportRetainedManifestRow[]> =>
  transaction.$queryRawUnsafe<ExportRetainedManifestRow[]>(
    `SELECT "questionId", COUNT(*)::bigint AS "versionCount",
       MAX("versionNumber")::integer AS "maxVersionNumber",
       array_agg("id"::text ORDER BY "versionNumber", "id")
         AS "orderedVersionIds"
     FROM "QuestionVersion"
     WHERE "questionId" = ANY($1::uuid[])
     GROUP BY "questionId"
     ORDER BY "questionId"`,
    questionIds
  )

const buildBoundedExportSnapshot = async (
  transaction: Prisma.TransactionClient,
  request: ExportAdminQuestionsRequest,
  exportedAt: Date
): Promise<{
  readonly canonicalBody: string
  readonly questions: readonly ExportQuestionRow[]
  readonly versions: readonly ExportVersionManifestRow[]
}> => {
  const questions = await loadExportQuestions(transaction, request.questionIds)
  const questionById = new Map(
    questions.map((question) => [question.id, question])
  )
  const missing = request.questionIds.find(
    (questionId) => !questionById.has(questionId)
  )
  if (missing) {
    throw repositoryFailure(
      'RESOURCE_NOT_FOUND',
      '내보낼 관리자 문제를 찾을 수 없습니다.'
    )
  }

  const body = new BoundedExportBody()
  body.append(
    `{"exportedAt":${canonicalizeJson(toIso(exportedAt))},"questions":[`
  )
  const versions: ExportVersionManifestRow[] = []
  const versionIdsByQuestion = new Map<string, string[]>()

  for (const [questionIndex, questionId] of request.questionIds.entries()) {
    const question = questionById.get(questionId)!
    if (questionIndex > 0) body.append(',')
    body.append(
      `{"currentPublishedVersionId":${canonicalizeJson(question.currentPublishedVersionId)},"lifecycleStatus":${canonicalizeJson(question.lifecycleStatus)},"questionId":${canonicalizeJson(question.id)},"versions":[`
    )

    let cursor: Pick<ExportVersionRow, 'id' | 'versionNumber'> | null = null
    let versionIndex = 0
    const orderedVersionIds: string[] = []
    while (true) {
      const page = await loadExportVersionPage(transaction, questionId, cursor)
      if (page.length === 0) break
      const versionIds = page.map((version) => version.id)
      const children = await loadExportVersionChildren(transaction, versionIds)
      const optionsByVersion = new Map<string, ExportOptionRow[]>()
      const tagsByVersion = new Map<string, ExportTagRow[]>()
      for (const option of children.options) {
        const values = optionsByVersion.get(option.questionVersionId) ?? []
        values.push(option)
        optionsByVersion.set(option.questionVersionId, values)
      }
      for (const tag of children.tags) {
        const values = tagsByVersion.get(tag.questionVersionId) ?? []
        values.push(tag)
        tagsByVersion.set(tag.questionVersionId, values)
      }
      for (const version of page) {
        if (versionIndex > 0) body.append(',')
        const versionDocument = {
          content: {
            correctOptionId: version.correctOptionId,
            difficulty: version.difficulty,
            explanationJa: version.explanationJa,
            explanationKo: version.explanationKo,
            level: version.level,
            options: (optionsByVersion.get(version.id) ?? []).map((option) => ({
              id: option.id,
              ordinal: option.ordinal,
              text: option.text
            })),
            passage: version.passage,
            questionText: version.questionText,
            questionType: version.questionType,
            subject: version.subject,
            tags: (tagsByVersion.get(version.id) ?? []).map((tag) => ({
              id: tag.id,
              label: tag.label,
              normalizedName: tag.normalizedName
            }))
          },
          questionVersionId: version.id,
          versionNumber: version.versionNumber,
          versionStatus: version.status
        }
        body.append(
          canonicalizeJson(versionDocument as unknown as CanonicalJsonValue)
        )
        versions.push({
          id: version.id,
          questionId: version.questionId,
          versionNumber: version.versionNumber,
          status: version.status,
          rowVersion: version.rowVersion
        })
        orderedVersionIds.push(version.id)
        versionIndex += 1
      }
      const last = page.at(-1)!
      cursor = { id: last.id, versionNumber: last.versionNumber }
      if (page.length < EXPORT_VERSION_BATCH_SIZE) break
    }
    if (versionIndex === 0) {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '내보낼 문제의 보존 버전을 확인할 수 없습니다.',
        disposition: 'NO_TX'
      })
    }
    versionIdsByQuestion.set(questionId, orderedVersionIds)
    body.append(']}')
  }
  body.append('],"schemaVersion":"admin-question-export-v1"}')

  const retainedManifest = await loadExportRetainedManifest(
    transaction,
    request.questionIds
  )
  const retainedByQuestion = new Map(
    retainedManifest.map((row) => [row.questionId, row])
  )
  for (const questionId of request.questionIds) {
    const retained = retainedByQuestion.get(questionId)
    const loadedIds = versionIdsByQuestion.get(questionId) ?? []
    const loadedLast = versions.findLast(
      (version) => version.questionId === questionId
    )
    if (
      !retained ||
      retained.versionCount !== BigInt(loadedIds.length) ||
      retained.maxVersionNumber !== loadedLast?.versionNumber ||
      retained.orderedVersionIds.length !== loadedIds.length ||
      retained.orderedVersionIds.some((id, index) => id !== loadedIds[index])
    ) {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '내보내기 보존 버전 목록을 완전하게 확정할 수 없습니다.',
        disposition: 'NO_TX'
      })
    }
  }

  return { canonicalBody: body.value(), questions, versions }
}

const reconcileCommittedExport = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  input: {
    readonly actorId: string
    readonly auditContentDigest: string
    readonly auditEvidence: AdminQuestionExportAuditEvidence
    readonly environment: AuditEnvironment
    readonly occurredAt: Date
    readonly operationId: string
    readonly requestId: string
  }
): Promise<boolean> => {
  const rows = await client.$queryRawUnsafe<ExportAuditReconciliationRow[]>(
    `SELECT "operationId", "command", "targetType", "targetId",
       "actorId", "requestId", "environment", "changedFields", "metadata",
       "contentDigest", "occurredAt"
     FROM "AdminAuditLog"
     WHERE "operationId" = $1 AND "command" = 'EXPORT'
       AND "targetType" = 'EXPORT_REQUEST'`,
    input.operationId
  )
  const row = rows[0]
  const expectedMetadata = {
    kind: 'EXPORT_V1',
    ...input.auditEvidence
  } as const
  return (
    rows.length === 1 &&
    row !== undefined &&
    row.operationId === input.operationId &&
    row.command === 'EXPORT' &&
    row.targetType === 'EXPORT_REQUEST' &&
    row.targetId === input.operationId &&
    row.actorId === input.actorId &&
    row.requestId === input.requestId &&
    row.environment === input.environment &&
    row.contentDigest === input.auditContentDigest &&
    row.occurredAt.getTime() === input.occurredAt.getTime() &&
    canonicalizeJson(row.changedFields as CanonicalJsonValue) ===
      canonicalizeJson(['EXPORT_SELECTION']) &&
    canonicalizeJson(row.metadata as CanonicalJsonValue) ===
      canonicalizeJson(expectedMetadata)
  )
}

const loadReportTarget = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  reportId: string
): Promise<ReportTargetRow | null> => {
  const rows = await client.$queryRawUnsafe<ReportTargetRow[]>(
    `SELECT report."id", report."questionId", report."questionVersionId",
       report."status", report."rowVersion", report."reporterUserId",
       report."assigneeUserId",
       question."lifecycleStatus" AS "questionLifecycleStatus",
       question."rowVersion" AS "questionRowVersion",
       question."createdByUserId" AS "questionCreatedByUserId",
       version."status" AS "versionStatus",
       version."rowVersion" AS "versionRowVersion",
       version."versionNumber", version."createdByUserId"
         AS "versionCreatedByUserId"
     FROM "QuestionReport" AS report
     JOIN "Question" AS question ON question."id" = report."questionId"
     JOIN "QuestionVersion" AS version
       ON version."id" = report."questionVersionId"
      AND version."questionId" = report."questionId"
     WHERE report."id" = $1`,
    reportId
  )
  return rows[0] ?? null
}

const loadRemediationTarget = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  versionId: string
): Promise<RemediationTargetRow | null> => {
  const rows = await client.$queryRawUnsafe<RemediationTargetRow[]>(
    `SELECT "id", "questionId", "status", "rowVersion", "versionNumber",
       "retirementKind", "publishedAt", "createdByUserId"
     FROM "QuestionVersion" WHERE "id" = $1`,
    versionId
  )
  return rows[0] ?? null
}

const loadReportMutation = async (
  transaction: Prisma.TransactionClient,
  reportId: string
): Promise<QuestionReportMutationResult> => {
  const rows = await transaction.$queryRawUnsafe<ReportMutationRow[]>(
    `SELECT "id", "questionId", "questionVersionId", "status", "rowVersion",
       "assigneeActorId", "assigneeRole", "assigneeLabel",
       "resolutionOutcome", "resolutionReason", "remediationVersionId",
       "resolvedAt", "createdAt", "updatedAt"
     FROM "QuestionReport" WHERE "id" = $1`,
    reportId
  )
  const row = rows[0]
  if (!row) {
    throw repositoryInvariantFailure(
      'QuestionReport mutation result is unavailable.'
    )
  }
  const assignee =
    row.assigneeActorId && row.assigneeRole && row.assigneeLabel
      ? {
          kind: 'ACCOUNT' as const,
          actorId: row.assigneeActorId,
          role: row.assigneeRole,
          label: row.assigneeLabel
        }
      : null
  const resolution =
    row.resolutionOutcome && row.resolutionReason && row.resolvedAt
      ? {
          outcome: row.resolutionOutcome,
          reason: row.resolutionReason,
          remediationVersionId: row.remediationVersionId,
          resolvedAt: toIso(row.resolvedAt)
        }
      : null
  return {
    id: row.id,
    questionId: row.questionId,
    questionVersionId: row.questionVersionId,
    status: row.status,
    rowVersion: row.rowVersion,
    assignee,
    resolution,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  }
}

const classifyAuthorityFailure = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  operation: Slice5TransactionalOperation,
  authority: AdminCommandAuthority,
  error: unknown
): Promise<AdminQuestionCommandRepositoryError | null> => {
  const identity = rawDatabaseIdentity(error)
  if (
    identity?.sqlState !== '42501' ||
    !AUTHORITY_FAILURE_MESSAGES.has(identity.message)
  ) {
    return null
  }
  let rows: AuthorityProbeRow[]
  try {
    rows = await client.$queryRawUnsafe<AuthorityProbeRow[]>(
      `SELECT principal."userId" AS "principalUserId",
         principal."role" AS "principalRole",
         CASE WHEN principal."userId" IS NULL THEN NULL
           ELSE principal."createdAt" + INTERVAL '5 minutes' >
             clock_timestamp()
         END AS "isFresh"
       FROM "phase7_resolve_v1_principal"($1) AS principal`,
      authority.rawSessionToken
    )
  } catch (probeError: unknown) {
    return new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '관리자 세션 상태를 다시 확인할 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: probeError
    })
  }
  const probe = rows.length === 1 ? rows[0] : undefined
  if (!probe) {
    let classificationRows: AdminAuthorityClassificationRow[]
    try {
      classificationRows = await client.$queryRawUnsafe<
        AdminAuthorityClassificationRow[]
      >(
        'SELECT * FROM "phase7_classify_admin_authority"($1)',
        authority.rawSessionToken
      )
    } catch (classificationError: unknown) {
      return new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '관리자 세션 상태를 다시 확인할 수 없습니다.',
        disposition: 'DEFINITE_ROLLBACK',
        cause: classificationError
      })
    }
    const outcome = classificationRows[0]?.outcome
    if (
      classificationRows.length !== 1 ||
      (outcome !== 'ADMIN_REQUIRED' && outcome !== 'AUTH_SESSION_EXPIRED')
    ) {
      return new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '관리자 세션 상태를 안전하게 분류할 수 없습니다.',
        disposition: 'DEFINITE_ROLLBACK',
        cause: error
      })
    }
    return new AdminQuestionCommandRepositoryError({
      code: outcome,
      message:
        outcome === 'ADMIN_REQUIRED'
          ? '관리자 권한이 필요합니다.'
          : '로그인 세션이 만료됐습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (probe.principalUserId !== authority.actorId) {
    return new AdminQuestionCommandRepositoryError({
      code: 'AUTH_SESSION_EXPIRED',
      message: '로그인 세션이 만료됐습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (probe.principalRole !== 'ADMIN') {
    return new AdminQuestionCommandRepositoryError({
      code: 'ADMIN_REQUIRED',
      message: '관리자 권한이 필요합니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (FRESH_OPERATIONS.has(operation) && probe.isFresh !== true) {
    return new AdminQuestionCommandRepositoryError({
      code: 'FRESH_ASSURANCE_REQUIRED',
      message: '민감한 관리자 작업을 위해 비밀번호를 다시 확인해 주세요.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  return new AdminQuestionCommandRepositoryError({
    code: 'SERVICE_UNAVAILABLE',
    message: '관리자 세션 권한을 안전하게 확정할 수 없습니다.',
    disposition: 'DEFINITE_ROLLBACK',
    cause: error
  })
}

const mapTransactionError = (
  operation: Slice5TransactionalOperation,
  error: unknown
): AdminQuestionCommandRepositoryError => {
  if (error instanceof AdminQuestionCommandRepositoryError) {
    return new AdminQuestionCommandRepositoryError({
      code: error.code,
      message: error.message,
      disposition: 'DEFINITE_ROLLBACK',
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      ...(error.internalReason ? { internalReason: error.internalReason } : {}),
      ...(error.retryAfterSeconds
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
      cause: error
    })
  }
  const identity = rawDatabaseIdentity(error)
  const sqlState = rawSqlState(error)
  if (sqlState === '40001' || sqlState === '40P01') {
    if (
      [
        'requestContentReviewBatch',
        'triageAdminQuestionReport',
        'resolveAdminQuestionReport'
      ].includes(operation) &&
      (identity?.message === 'Phase 7 Question target changed before arm.' ||
        identity?.message ===
          'Phase 7 QuestionVersion target changed before arm.' ||
        identity?.message ===
          'Phase 7 QuestionReport target changed before arm.')
    ) {
      return new AdminQuestionCommandRepositoryError({
        code: 'VERSION_CONFLICT',
        message:
          '다른 요청이 먼저 변경했습니다. 최신 상태를 다시 불러와 주세요.',
        disposition: 'DEFINITE_ROLLBACK',
        cause: error
      })
    }
    return new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '동시 요청을 안전하게 확정할 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '23514' &&
    identity.message === 'Cross-question canonical duplicate is forbidden.' &&
    operation === 'applyQuestionImport'
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '동시 콘텐츠 중복으로 import를 확정하지 못했습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE',
      cause: error
    })
  }
  if (
    identity?.sqlState === '23514' &&
    [
      'Admin content command requires an ACTIVE Question.',
      'REVIEW_REQUEST_BATCH target state is invalid.',
      'QuestionReport command manifest is not canonical.',
      'Invalid QuestionReport transition.'
    ].includes(identity.message)
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'INVALID_STATE_TRANSITION',
      message: '현재 상태에서는 요청한 전이를 수행할 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '23514' &&
    identity.message ===
      'QuestionReport remediation must be later published lineage.'
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'RESOURCE_NOT_FOUND',
      message: '사용할 수 있는 조치 버전을 찾을 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '42501' &&
    identity.message === 'Phase 7 authority expired before commit.'
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: FRESH_OPERATIONS.has(operation)
        ? 'FRESH_ASSURANCE_REQUIRED'
        : 'AUTH_SESSION_EXPIRED',
      message: '관리자 세션 권한을 다시 확인해 주세요.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    sqlState !== undefined &&
    (['55P03', '57014'].includes(sqlState) ||
      ['22', '23', '25', '2D', '40', '42'].some((prefix) =>
        sqlState.startsWith(prefix)
      ))
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '관리자 명령을 안전하게 완료할 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P1001', 'P1002', 'P2024'].includes(error.code))
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '관리자 명령 결과를 확인할 수 없습니다.',
      disposition: 'COMMIT_UNKNOWN',
      cause: error
    })
  }
  return new AdminQuestionCommandRepositoryError({
    code: 'SERVICE_UNAVAILABLE',
    message: '관리자 명령 결과를 확인할 수 없습니다.',
    disposition: 'COMMIT_UNKNOWN',
    cause: error
  })
}

const executeTransaction = async <Result>(
  client: PrismaClient,
  operation: Slice5TransactionalOperation,
  authority: AdminCommandAuthority,
  action: () => Promise<Result>,
  callbackCompleted: () => boolean
): Promise<Result> => {
  try {
    return await action()
  } catch (error: unknown) {
    const authorityFailure = await classifyAuthorityFailure(
      client,
      operation,
      authority,
      error
    )
    if (authorityFailure) throw authorityFailure
    const mapped = mapTransactionError(operation, error)
    if (!callbackCompleted() && mapped.disposition === 'COMMIT_UNKNOWN') {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '관리자 명령 트랜잭션을 완료하지 못했습니다.',
        disposition: 'DEFINITE_ROLLBACK',
        cause: error
      })
    }
    throw mapped
  }
}

export interface AdminQuestionSlice5Repository {
  readonly requestReviewBatch: (
    authority: AdminCommandAuthority,
    request: RequestContentReviewBatchRequest
  ) => Promise<AdminReviewRequestBatchResult>
  readonly validateImport: (
    request: ValidateQuestionImportRequest
  ) => Promise<AdminImportValidationResponse>
  readonly applyImport: (
    authority: AdminCommandAuthority,
    request: ApplyQuestionImportRequest
  ) => Promise<AdminImportApplyRepositoryResult>
  readonly exportQuestions: (
    authority: AdminCommandAuthority,
    request: ExportAdminQuestionsRequest
  ) => Promise<AdminQuestionExportRepositoryResult>
  readonly triageReport: (
    authority: AdminCommandAuthority,
    reportId: string,
    request: TriageAdminQuestionReportRequest
  ) => Promise<QuestionReportMutationResult>
  readonly resolveReport: (
    authority: AdminCommandAuthority,
    reportId: string,
    request: ResolveAdminQuestionReportRequest
  ) => Promise<QuestionReportMutationResult>
}

export interface AdminImportApplyRepositoryResult {
  readonly response: AdminImportApplyResponse
  readonly mappingDigest: string
}

export interface AdminQuestionExportAuditEvidence {
  readonly selectionDigest: string
  readonly responseBodyDigest: string
  readonly questionCount: number
  readonly versionCount: number
}

export interface AdminQuestionExportRepositoryResult {
  readonly document: AdminQuestionExportDocumentV1
  readonly canonicalBody: string
  readonly auditEvidence: AdminQuestionExportAuditEvidence
}

export const createPrismaAdminQuestionSlice5Repository = ({
  auditEnvironment,
  client
}: {
  readonly auditEnvironment: AuditEnvironment
  readonly client: PrismaClient
}): AdminQuestionSlice5Repository => ({
  requestReviewBatch: async (authority, request) => {
    let targets: BatchTargetRow[]
    try {
      targets = await loadBatchTargets(
        client,
        request.items.map((item) => item.versionId)
      )
    } catch (error: unknown) {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '일괄 검수 요청 대상을 확인할 수 없습니다.',
        disposition: 'NO_TX',
        cause: error
      })
    }
    const targetByVersion = new Map(
      targets.map((target) => [target.versionId, target])
    )
    const plannedTargets: Array<{
      readonly requestIndex: number
      readonly target: BatchTargetRow
    }> = []
    let firstFailure:
      | {
          readonly requestIndex: number
          readonly kind: 'PRE_ARM' | 'STATE'
          readonly error: AdminQuestionCommandRepositoryError
        }
      | undefined
    for (const [requestIndex, item] of request.items.entries()) {
      const target = targetByVersion.get(item.versionId)
      if (!target) {
        firstFailure ??= {
          requestIndex,
          kind: 'PRE_ARM',
          error: repositoryFailure(
            'RESOURCE_NOT_FOUND',
            '일괄 검수 요청 대상 문제 버전을 찾을 수 없습니다.'
          )
        }
        continue
      }
      plannedTargets.push({ requestIndex, target })
      if (target.versionCreatedByUserId !== authority.actorId) {
        firstFailure ??= {
          requestIndex,
          kind: 'PRE_ARM',
          error: repositoryFailure(
            'FORBIDDEN',
            '각 문제 버전의 작성자만 일괄 검수를 요청할 수 있습니다.'
          )
        }
      } else if (target.versionRowVersion !== item.expectedRowVersion) {
        firstFailure ??= {
          requestIndex,
          kind: 'PRE_ARM',
          error: repositoryFailure(
            'VERSION_CONFLICT',
            '일괄 검수 요청 대상이 다른 요청으로 변경되었습니다.'
          )
        }
      } else if (
        target.questionLifecycleStatus !== 'ACTIVE' ||
        !['DRAFT', 'CHANGES_REQUESTED'].includes(target.versionStatus)
      ) {
        firstFailure ??= {
          requestIndex,
          kind: 'STATE',
          error: repositoryFailure(
            'INVALID_STATE_TRANSITION',
            '현재 상태에서는 일괄 검수를 요청할 수 없습니다.'
          )
        }
      }
    }
    const referenceTargets = plannedTargets.filter(({ requestIndex }) => {
      if (!firstFailure) return true
      return firstFailure.kind === 'PRE_ARM'
        ? requestIndex < firstFailure.requestIndex
        : requestIndex <= firstFailure.requestIndex
    })
    const armTargets = referenceTargets.map(({ target }) => target)
    const orderedTargets = plannedTargets.map(({ target }) => target)
    let callbackCompleted = false
    return executeTransaction(
      client,
      'requestContentReviewBatch',
      authority,
      () =>
        client.$transaction(
          async (transaction) => {
            const begun = await beginOperation(transaction, {
              auditEnvironment,
              authority,
              command: 'REVIEW_REQUEST_BATCH',
              referencedUserIds: uniqueSorted([
                authority.actorId,
                ...referenceTargets.flatMap(({ target }) => [
                  target.questionCreatedByUserId,
                  target.versionCreatedByUserId
                ])
              ])
            })
            if (firstFailure?.kind === 'PRE_ARM' && armTargets.length === 0) {
              throw firstFailure.error
            }
            const questions = [
              ...new Map(
                armTargets.map((target) => [
                  target.questionId,
                  {
                    id: target.questionId,
                    rowVersion: target.questionRowVersion,
                    state: target.questionLifecycleStatus
                  }
                ])
              ).values()
            ]
            const operation = await armOperation(transaction, begun, {
              questions,
              versions: armTargets.map((target) => ({
                id: target.versionId,
                rowVersion: target.versionRowVersion,
                state: target.versionStatus
              })),
              reports: [],
              tags: []
            })
            if (firstFailure) {
              throw firstFailure.error
            }
            const resultItems: AdminReviewRequestBatchResult['items'] = []
            for (const [index, target] of orderedTargets.entries()) {
              const requested = request.items[index]!
              const nextRowVersion = target.versionRowVersion + 1
              await transaction.$executeRawUnsafe(
                `UPDATE "QuestionVersion"
                 SET "status" = 'IN_REVIEW', "rowVersion" = $2,
                     "updatedAt" = $3
                 WHERE "id" = $1`,
                target.versionId,
                nextRowVersion,
                operation.occurredAt
              )
              await insertReview(transaction, {
                actorId: authority.actorId,
                comment: requested.comment ?? null,
                fromState: target.versionStatus,
                occurredAt: operation.occurredAt,
                operationId: operation.operationId,
                questionId: target.questionId,
                requestId: authority.requestId,
                versionId: target.versionId
              })
              await insertAudit(transaction, {
                actorId: authority.actorId,
                afterRowVersion: nextRowVersion,
                afterState: 'IN_REVIEW',
                beforeRowVersion: target.versionRowVersion,
                beforeState: target.versionStatus,
                changedFields: ['VERSION_STATUS'],
                command: 'REVIEW_REQUEST',
                environment: auditEnvironment,
                occurredAt: operation.occurredAt,
                operationId: operation.operationId,
                requestId: authority.requestId,
                targetId: target.versionId,
                targetType: 'QUESTION_VERSION'
              })
              resultItems.push({
                questionId: target.questionId,
                questionVersionId: target.versionId,
                lifecycleStatus: 'ACTIVE',
                versionStatus: 'IN_REVIEW',
                questionRowVersion: target.questionRowVersion,
                versionRowVersion: nextRowVersion,
                occurredAt: toIso(operation.occurredAt)
              })
            }
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: null,
              afterState: null,
              beforeRowVersion: null,
              beforeState: null,
              changedFields: ['VERSION_STATUS'],
              command: 'REVIEW_REQUEST_BATCH',
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: operation.operationId,
              targetType: 'REVIEW_REQUEST_BATCH',
              metadata: {
                kind: 'REVIEW_REQUEST_BATCH_V1',
                itemCount: orderedTargets.length
              }
            })
            await finishOperation(transaction, operation.operationId)
            callbackCompleted = true
            return { items: resultItems }
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        ),
      () => callbackCompleted
    )
  },

  validateImport: async (request) => {
    try {
      return (await collectImportValidation(client, request.items)).response
    } catch (error: unknown) {
      if (error instanceof AdminQuestionCommandRepositoryError) throw error
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'import 검증 결과를 확인할 수 없습니다.',
        disposition: 'NO_TX',
        cause: error
      })
    }
  },

  applyImport: async (authority, request) => {
    let requestedValidationDigest: string
    try {
      requestedValidationDigest = await createAdminImportValidationDigest(
        sha256Port,
        request.items
      )
    } catch (error: unknown) {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'import 적용 요청의 검증 digest를 확인할 수 없습니다.',
        disposition: 'NO_TX',
        cause: error
      })
    }
    if (requestedValidationDigest !== request.validationDigest) {
      throw repositoryFailure(
        'IMPORT_IDENTITY_CONFLICT',
        'import 검증 digest와 적용 요청이 일치하지 않습니다.'
      )
    }
    let preflight: ImportValidationResult
    try {
      preflight = await collectImportValidation(client, request.items)
    } catch (error: unknown) {
      if (error instanceof AdminQuestionCommandRepositoryError) throw error
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'import 적용 전 검증 결과를 확인할 수 없습니다.',
        disposition: 'NO_TX',
        cause: error
      })
    }
    assertImportApplyValidation(request, preflight)

    let callbackCompleted = false
    try {
      return await client.$transaction(
        async (transaction) => {
          const begun = await beginOperation(transaction, {
            auditEnvironment,
            authority,
            command: 'IMPORT_APPLY',
            referencedUserIds: [authority.actorId]
          })
          const validation = await collectImportValidation(
            transaction,
            request.items
          )
          assertImportApplyValidation(request, validation)
          const tagByApplicability = new Map(
            validation.applicableTags.map((tag) => [
              applicabilityKey(tag.normalizedName, tag),
              tag
            ])
          )
          const tagsByItem = request.items.map((item) =>
            item.content.tagNames.map((name) => {
              const tag = tagByApplicability.get(
                applicabilityKey(normalizePhase7TagKey(name), item.content)
              )
              if (!tag) {
                throw repositoryFailure(
                  'IMPORT_VALIDATION_FAILED',
                  'import 태그 구성이 적용 시점에 변경되었습니다.'
                )
              }
              return tag
            })
          )
          const operation = await armOperation(transaction, begun, {
            questions: [],
            versions: [],
            reports: [],
            tags: uniqueSorted(
              tagsByItem.flatMap((tags) => tags.map((tag) => tag.id))
            )
          })
          const mappings: AdminImportApplyItem[] = request.items.map(
            (item) => ({
              clientItemId: item.clientItemId,
              questionId: randomUUID(),
              questionVersionId: randomUUID(),
              lifecycleStatus: 'ACTIVE',
              versionStatus: 'DRAFT',
              questionRowVersion: 1,
              versionRowVersion: 1
            })
          )
          const mappingDigest = await createAdminImportMappingDigest(
            sha256Port,
            mappings
          )
          for (const [index, item] of request.items.entries()) {
            const mapping = mappings[index]!
            await transaction.$executeRawUnsafe(
              `INSERT INTO "Question" (
                 "id", "createdByUserId", "createdByActorId",
                 "createdByRoleSnapshot", "createdByLabelSnapshot",
                 "createdAt", "updatedAt"
               ) VALUES ($1, $2, $2, 'ADMIN', 'ACTIVE_ADMIN', $3, $3)`,
              mapping.questionId,
              authority.actorId,
              operation.occurredAt
            )
            await createVersionContent(transaction, {
              actorId: authority.actorId,
              content: item.content,
              occurredAt: operation.occurredAt,
              questionId: mapping.questionId,
              tags: tagsByItem[index]!,
              versionId: mapping.questionVersionId
            })
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: 1,
              afterState: 'ACTIVE',
              beforeRowVersion: null,
              beforeState: null,
              changedFields: CREATE_CHANGED_FIELDS,
              command: 'QUESTION_CREATE',
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: mapping.questionId,
              targetType: 'QUESTION'
            })
          }
          await insertAudit(transaction, {
            actorId: authority.actorId,
            afterRowVersion: null,
            afterState: null,
            beforeRowVersion: null,
            beforeState: null,
            changedFields: ['IMPORT_ITEMS'],
            command: 'IMPORT_APPLY',
            environment: auditEnvironment,
            occurredAt: operation.occurredAt,
            operationId: operation.operationId,
            requestId: authority.requestId,
            targetId: operation.operationId,
            targetType: 'IMPORT_REQUEST',
            metadata: {
              kind: 'IMPORT_APPLY_V1',
              validationDigest: request.validationDigest,
              mappingDigest,
              itemCount: mappings.length
            }
          })
          await finishOperation(transaction, operation.operationId)
          const result = {
            response: {
              createdCount: mappings.length,
              items: mappings,
              occurredAt: toIso(operation.occurredAt)
            },
            mappingDigest
          }
          callbackCompleted = true
          return result
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    } catch (error: unknown) {
      const authorityFailure = await classifyAuthorityFailure(
        client,
        'applyQuestionImport',
        authority,
        error
      )
      if (authorityFailure) throw authorityFailure
      const mapped = mapTransactionError('applyQuestionImport', error)
      if (isSerializationFailure(error)) {
        try {
          const visible = await loadExistingFingerprints(
            client,
            eligibleImportFingerprints(request.items)
          )
          if (visible.size > 0) {
            throw new AdminQuestionCommandRepositoryError({
              code: 'SERVICE_UNAVAILABLE',
              message: '동시 콘텐츠 중복으로 import를 확정하지 못했습니다.',
              disposition: 'DEFINITE_ROLLBACK',
              internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE',
              cause: error
            })
          }
        } catch (classificationError: unknown) {
          if (
            classificationError instanceof AdminQuestionCommandRepositoryError
          ) {
            throw classificationError
          }
          // Preserve the original definite rollback when the post-check fails.
        }
      }
      if (!callbackCompleted && mapped.disposition === 'COMMIT_UNKNOWN') {
        throw new AdminQuestionCommandRepositoryError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'import 적용 트랜잭션을 완료하지 못했습니다.',
          disposition: 'DEFINITE_ROLLBACK',
          cause: error
        })
      }
      throw mapped
    }
  },

  exportQuestions: async (authority, request) => {
    let referencedUsers: ExportReviewUserRow[]
    try {
      referencedUsers = await loadExportReferencedUsers(
        client,
        request.questionIds
      )
    } catch (error: unknown) {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '내보내기 참조 권위를 확인할 수 없습니다.',
        disposition: 'NO_TX',
        cause: error
      })
    }
    const referencedUserIds = uniqueSorted([
      authority.actorId,
      ...referencedUsers.map((user) => user.userId)
    ])

    let captured:
      | {
          readonly auditContentDigest: string
          readonly occurredAt: Date
          readonly operationId: string
          readonly result: AdminQuestionExportRepositoryResult
        }
      | undefined
    let callbackCompleted = false
    try {
      return await client.$transaction(
        async (transaction) => {
          await transaction.$executeRawUnsafe('SET TRANSACTION READ WRITE')
          const begun = await beginOperation(transaction, {
            auditEnvironment,
            authority,
            command: 'EXPORT',
            referencedUserIds
          })
          const timestampRows = await transaction.$queryRawUnsafe<
            ExportTimestampRow[]
          >(`SELECT transaction_timestamp()::timestamptz(3) AS "exportedAt"`)
          const exportedAt = timestampRows[0]?.exportedAt
          if (
            timestampRows.length !== 1 ||
            !(exportedAt instanceof Date) ||
            !Number.isFinite(exportedAt.getTime())
          ) {
            throw repositoryInvariantFailure(
              'Export transaction timestamp is unavailable.'
            )
          }
          const snapshot = await buildBoundedExportSnapshot(
            transaction,
            request,
            exportedAt
          )
          const operation = await armOperation(transaction, begun, {
            questions: snapshot.questions.map((question) => ({
              id: question.id,
              rowVersion: question.rowVersion,
              state: question.lifecycleStatus
            })),
            versions: snapshot.versions.map((version) => ({
              id: version.id,
              rowVersion: version.rowVersion,
              state: version.status
            })),
            reports: [],
            tags: []
          })
          if (operation.occurredAt.getTime() !== exportedAt.getTime()) {
            throw repositoryInvariantFailure(
              'Export snapshot timestamp changed before arm.'
            )
          }
          let asserted: Awaited<
            ReturnType<typeof assertAdminQuestionExportDocumentForRequest>
          >
          try {
            asserted = await assertAdminQuestionExportDocumentForRequest(
              sha256Port,
              request,
              JSON.parse(snapshot.canonicalBody) as unknown,
              { canonicalResponseBody: snapshot.canonicalBody }
            )
          } catch (assertionError: unknown) {
            throw repositoryInvariantFailure(
              '내보내기 응답 무결성을 확인할 수 없습니다.',
              assertionError
            )
          }
          const auditEvidence: AdminQuestionExportAuditEvidence = {
            selectionDigest: asserted.selectionDigest,
            responseBodyDigest: asserted.responseBodyDigest,
            questionCount: asserted.questionCount,
            versionCount: asserted.versionCount
          }
          if (auditEvidence.versionCount !== snapshot.versions.length) {
            throw repositoryInvariantFailure(
              'Export version count does not match the manifest.'
            )
          }
          const auditContentDigest = await insertAudit(transaction, {
            actorId: authority.actorId,
            afterRowVersion: null,
            afterState: null,
            beforeRowVersion: null,
            beforeState: null,
            changedFields: ['EXPORT_SELECTION'],
            command: 'EXPORT',
            environment: auditEnvironment,
            occurredAt: operation.occurredAt,
            operationId: operation.operationId,
            requestId: authority.requestId,
            targetId: operation.operationId,
            targetType: 'EXPORT_REQUEST',
            metadata: { kind: 'EXPORT_V1', ...auditEvidence }
          })
          const result: AdminQuestionExportRepositoryResult = {
            document: asserted.document,
            canonicalBody: snapshot.canonicalBody,
            auditEvidence
          }
          captured = {
            auditContentDigest,
            occurredAt: operation.occurredAt,
            operationId: operation.operationId,
            result
          }
          await finishOperation(transaction, operation.operationId)
          callbackCompleted = true
          return result
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      )
    } catch (error: unknown) {
      const authorityFailure = await classifyAuthorityFailure(
        client,
        'exportAdminQuestions',
        authority,
        error
      )
      if (authorityFailure) throw authorityFailure
      const mapped = mapTransactionError('exportAdminQuestions', error)
      if (!callbackCompleted && mapped.disposition === 'COMMIT_UNKNOWN') {
        throw new AdminQuestionCommandRepositoryError({
          code: 'SERVICE_UNAVAILABLE',
          message: '내보내기 트랜잭션을 완료하지 못했습니다.',
          disposition: 'DEFINITE_ROLLBACK',
          cause: error
        })
      }
      if (
        callbackCompleted &&
        mapped.disposition === 'COMMIT_UNKNOWN' &&
        captured
      ) {
        try {
          const reconciled = await reconcileCommittedExport(client, {
            actorId: authority.actorId,
            auditContentDigest: captured.auditContentDigest,
            auditEvidence: captured.result.auditEvidence,
            environment: auditEnvironment,
            occurredAt: captured.occurredAt,
            operationId: captured.operationId,
            requestId: authority.requestId
          })
          if (reconciled) return captured.result
        } catch {
          // A lookup failure cannot be treated as a successful export.
        }
      }
      throw mapped
    }
  },

  triageReport: async (authority, reportId, request) => {
    let target: ReportTargetRow | null
    try {
      target = await loadReportTarget(client, reportId)
    } catch (error: unknown) {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '문제 신고 대상을 확인할 수 없습니다.',
        disposition: 'NO_TX',
        cause: error
      })
    }
    let callbackCompleted = false
    return executeTransaction(
      client,
      'triageAdminQuestionReport',
      authority,
      () =>
        client.$transaction(
          async (transaction) => {
            const begun = await beginOperation(transaction, {
              auditEnvironment,
              authority,
              command: 'REPORT_TRIAGE',
              referencedUserIds: uniqueSorted([
                authority.actorId,
                target?.questionCreatedByUserId ?? null,
                target?.versionCreatedByUserId ?? null,
                target?.reporterUserId ?? null,
                target?.assigneeUserId ?? null
              ])
            })
            if (!target) {
              throw repositoryFailure(
                'RESOURCE_NOT_FOUND',
                '문제 신고를 찾을 수 없습니다.'
              )
            }
            if (target.rowVersion !== request.expectedRowVersion) {
              throw repositoryFailure(
                'VERSION_CONFLICT',
                '다른 요청이 먼저 문제 신고를 변경했습니다.'
              )
            }
            const operation = await armOperation(transaction, begun, {
              questions: [
                {
                  id: target.questionId,
                  rowVersion: target.questionRowVersion,
                  state: target.questionLifecycleStatus
                }
              ],
              versions: [
                {
                  id: target.questionVersionId,
                  rowVersion: target.versionRowVersion,
                  state: target.versionStatus
                }
              ],
              reports: [
                {
                  id: target.id,
                  rowVersion: target.rowVersion,
                  state: target.status
                }
              ],
              tags: []
            })
            if (target.status !== 'OPEN') {
              throw repositoryFailure(
                'INVALID_STATE_TRANSITION',
                'OPEN 문제 신고만 triage할 수 있습니다.'
              )
            }
            await transaction.$executeRawUnsafe(
              `UPDATE "QuestionReport"
               SET "status" = 'TRIAGED', "assigneeUserId" = $2,
                   "assigneeActorId" = $2, "assigneeRole" = 'ADMIN',
                   "assigneeLabel" = 'ACTIVE_ADMIN',
                   "rowVersion" = $3, "updatedAt" = $4
               WHERE "id" = $1`,
              reportId,
              authority.actorId,
              target.rowVersion + 1,
              operation.occurredAt
            )
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: target.rowVersion + 1,
              afterState: 'TRIAGED',
              beforeRowVersion: target.rowVersion,
              beforeState: 'OPEN',
              changedFields: ['ASSIGNEE', 'REPORT_STATUS'],
              command: 'REPORT_TRIAGE',
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: reportId,
              targetType: 'QUESTION_REPORT'
            })
            const result = await loadReportMutation(transaction, reportId)
            await finishOperation(transaction, operation.operationId)
            callbackCompleted = true
            return result
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        ),
      () => callbackCompleted
    )
  },

  resolveReport: async (authority, reportId, request) => {
    let target: ReportTargetRow | null
    let remediation: RemediationTargetRow | null = null
    try {
      target = await loadReportTarget(client, reportId)
      if (request.remediationVersionId) {
        remediation = await loadRemediationTarget(
          client,
          request.remediationVersionId
        )
      }
    } catch (error: unknown) {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '문제 신고 해결 대상을 확인할 수 없습니다.',
        disposition: 'NO_TX',
        cause: error
      })
    }
    const outerRemediationIsTargetCandidate =
      target !== null &&
      remediation !== null &&
      remediation.questionId === target.questionId &&
      remediation.id !== target.questionVersionId
    let callbackCompleted = false
    return executeTransaction(
      client,
      'resolveAdminQuestionReport',
      authority,
      () =>
        client.$transaction(
          async (transaction) => {
            const begun = await beginOperation(transaction, {
              auditEnvironment,
              authority,
              command: 'REPORT_RESOLUTION',
              referencedUserIds: uniqueSorted([
                authority.actorId,
                target?.questionCreatedByUserId ?? null,
                target?.versionCreatedByUserId ?? null,
                target?.reporterUserId ?? null,
                target?.assigneeUserId ?? null,
                outerRemediationIsTargetCandidate
                  ? (remediation?.createdByUserId ?? null)
                  : null
              ])
            })
            target = await loadReportTarget(transaction, reportId)
            remediation = request.remediationVersionId
              ? await loadRemediationTarget(
                  transaction,
                  request.remediationVersionId
                )
              : null
            if (!target) {
              throw repositoryFailure(
                'RESOURCE_NOT_FOUND',
                '문제 신고를 찾을 수 없습니다.'
              )
            }
            if (target.rowVersion !== request.expectedRowVersion) {
              throw repositoryFailure(
                'VERSION_CONFLICT',
                '다른 요청이 먼저 문제 신고를 변경했습니다.'
              )
            }
            const remediationIsTargetCandidate =
              request.remediationVersionId !== undefined &&
              request.remediationVersionId !== null &&
              remediation !== null &&
              remediation.questionId === target.questionId &&
              remediation.id !== target.questionVersionId
            const versionTargets = [
              {
                id: target.questionVersionId,
                rowVersion: target.versionRowVersion,
                state: target.versionStatus
              },
              ...(remediationIsTargetCandidate && remediation
                ? [
                    {
                      id: remediation.id,
                      rowVersion: remediation.rowVersion,
                      state: remediation.status
                    }
                  ]
                : [])
            ]
            const operation = await armOperation(transaction, begun, {
              questions: [
                {
                  id: target.questionId,
                  rowVersion: target.questionRowVersion,
                  state: target.questionLifecycleStatus
                }
              ],
              versions: versionTargets,
              reports: [
                {
                  id: target.id,
                  rowVersion: target.rowVersion,
                  state: target.status
                }
              ],
              tags: []
            })
            if (target.status !== 'TRIAGED') {
              throw repositoryFailure(
                'INVALID_STATE_TRANSITION',
                'TRIAGED 문제 신고만 종결할 수 있습니다.'
              )
            }
            if (
              request.remediationVersionId !== undefined &&
              request.remediationVersionId !== null &&
              !remediationIsTargetCandidate
            ) {
              throw repositoryFailure(
                'RESOURCE_NOT_FOUND',
                '사용할 수 있는 조치 버전을 찾을 수 없습니다.'
              )
            }
            if (
              remediation &&
              (request.outcome !== 'RESOLVED' ||
                remediation.versionNumber <= target.versionNumber ||
                !(
                  remediation.status === 'PUBLISHED' ||
                  (remediation.status === 'RETIRED' &&
                    remediation.retirementKind === 'PUBLISHED_RETIREMENT' &&
                    remediation.publishedAt !== null)
                ))
            ) {
              throw repositoryFailure(
                'RESOURCE_NOT_FOUND',
                '사용할 수 있는 조치 버전을 찾을 수 없습니다.'
              )
            }
            const remediationVersionId = remediation?.id ?? null
            await transaction.$executeRawUnsafe(
              `UPDATE "QuestionReport"
               SET "status" = $2::"QuestionReportStatus",
                   "resolutionOutcome" = $3::"QuestionReportResolutionOutcome",
                   "resolutionReason" = $4, "remediationVersionId" = $5,
                   "resolvedAt" = $6, "rowVersion" = $7, "updatedAt" = $6
               WHERE "id" = $1`,
              reportId,
              request.outcome,
              request.outcome,
              request.reason,
              remediationVersionId,
              operation.occurredAt,
              target.rowVersion + 1
            )
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: target.rowVersion + 1,
              afterState: request.outcome,
              beforeRowVersion: target.rowVersion,
              beforeState: 'TRIAGED',
              changedFields: ['RESOLUTION', 'REPORT_STATUS'],
              command: 'REPORT_RESOLUTION',
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: reportId,
              targetType: 'QUESTION_REPORT'
            })
            const result = await loadReportMutation(transaction, reportId)
            await finishOperation(transaction, operation.operationId)
            callbackCompleted = true
            return result
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        ),
      () => callbackCompleted
    )
  }
})
