import { createHash, randomUUID } from 'node:crypto'
import {
  createPhase7QuestionDuplicateIdentity,
  type ArchiveAdminQuestionRequest,
  normalizePhase7TagKey,
  type AdminQuestionMutationResult,
  type ApproveQuestionVersionRequest,
  type CreateAdminQuestionRequest,
  type CreateAdminQuestionVersionRequest,
  type Phase7ExecutionDisposition,
  type Phase7InternalFailureReason,
  type PublishQuestionVersionRequest,
  type RequestContentReviewRequest,
  type RequestQuestionChangesRequest,
  type RetireQuestionVersionRequest,
  type UpdateQuestionVersionRequest,
  type WithdrawQuestionApprovalRequest
} from '@nihongo/contracts/admin/phase7'
import type { StableErrorCode } from '@nihongo/contracts/common/error'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

type AuditEnvironment = 'TEST' | 'DEVELOPMENT'
type ContentOperation =
  | 'createAdminQuestion'
  | 'createAdminQuestionVersion'
  | 'updateQuestionVersion'
type LifecycleOperation =
  | 'requestContentReview'
  | 'requestQuestionChanges'
  | 'approveQuestionVersion'
  | 'withdrawQuestionApproval'
type PublicationOperation =
  | 'publishQuestionVersion'
  | 'retireQuestionVersion'
  | 'archiveAdminQuestion'
type AdminQuestionDomainOperation =
  | ContentOperation
  | LifecycleOperation
  | PublicationOperation
type QuestionVersionStatus =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'RETIRED'

export interface AdminCommandAuthority {
  readonly actorId: string
  readonly rawSessionToken: string
  readonly requestId: string
}

export class AdminQuestionCommandRepositoryError extends Error {
  readonly code: StableErrorCode
  readonly disposition: Phase7ExecutionDisposition
  readonly fieldErrors: Record<string, string[]> | undefined
  readonly internalReason: Phase7InternalFailureReason | undefined
  readonly retryAfterSeconds: number | undefined

  constructor(input: {
    code: StableErrorCode
    message: string
    disposition: Phase7ExecutionDisposition
    fieldErrors?: Record<string, string[]>
    internalReason?: Phase7InternalFailureReason
    retryAfterSeconds?: number
    cause?: unknown
  }) {
    super(input.message, { cause: input.cause })
    this.name = 'AdminQuestionCommandRepositoryError'
    this.code = input.code
    this.disposition = input.disposition
    this.fieldErrors = input.fieldErrors
    this.internalReason = input.internalReason
    this.retryAfterSeconds = input.retryAfterSeconds
  }
}

interface TagRow {
  id: string
  label: string
  normalizedName: string
}

interface QuestionTargetRow {
  id: string
  lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  rowVersion: number
  currentPublishedVersionId: string | null
  createdByUserId: string | null
  maximumVersionNumber: number
  hasOpenCandidate: boolean
}

interface VersionTargetRow {
  questionId: string
  questionLifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  questionRowVersion: number
  questionCurrentPublishedVersionId: string | null
  questionCreatedByUserId: string | null
  versionId: string
  versionNumber: number
  versionStatus: QuestionVersionStatus
  versionRowVersion: number
  versionCreatedByUserId: string | null
  versionCreatedByActorId: string | null
  versionCreatedByRoleSnapshot: 'ADMIN' | null
  versionCreatedByLabelSnapshot:
    | 'ACTIVE_ADMIN'
    | 'DELETED_ADMIN'
    | 'SYSTEM_SEED'
  latestApproverUserId: string | null
  latestApproverActorId: string | null
  latestApproverRole: 'ADMIN' | null
  latestApproverLabel: 'ACTIVE_ADMIN' | 'DELETED_ADMIN' | null
  contentFingerprint: string
  isPinned: boolean
  level: CreateAdminQuestionRequest['level']
  subject: CreateAdminQuestionRequest['subject']
  questionType: CreateAdminQuestionRequest['questionType']
  difficulty: CreateAdminQuestionRequest['difficulty']
  passage: string | null
  questionText: string
  explanationKo: string
  explanationJa: string | null
  correctOptionId: string
}

interface LifecycleVersionTargetRow {
  id: string
  questionId: string
  status: QuestionVersionStatus
  rowVersion: number
  createdByUserId: string | null
  createdByActorId: string | null
  createdByRoleSnapshot: 'ADMIN' | null
  createdByLabelSnapshot: 'ACTIVE_ADMIN' | 'DELETED_ADMIN' | 'SYSTEM_SEED'
  contentFingerprint: string
}

interface EvidenceAccountSnapshot {
  userId: string | null
  actorId: string
  role: 'ADMIN'
  label: 'ACTIVE_ADMIN' | 'DELETED_ADMIN'
}

interface OptionRow {
  id: string
  label: string
  ordinal: number
  text: string
}

interface VersionTagRow extends TagRow {
  assignmentId: string
}

interface BegunOperationRow {
  actorUserId: string
  operationId: string
}

interface OccurredAtRow {
  occurredAt: Date
}

interface AuthorityProbeRow {
  isFresh: boolean | null
  principalRole: 'USER' | 'ADMIN' | null
  principalUserId: string | null
}

interface AdminAuthorityClassificationRow {
  outcome: 'ADMIN_REQUIRED' | 'AUTH_SESSION_EXPIRED'
}

interface OperationContext extends BegunOperationRow {
  occurredAt: Date
}

interface TargetManifestItem {
  id: string
  rowVersion: number
  state: string
}

interface TargetManifest {
  questions: TargetManifestItem[]
  versions: TargetManifestItem[]
  reports: TargetManifestItem[]
  tags: string[]
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

const UPDATE_CHANGED_FIELD_ORDER = [
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

const CONTENT_OPERATIONS = new Set<AdminQuestionDomainOperation>([
  'createAdminQuestion',
  'createAdminQuestionVersion',
  'updateQuestionVersion',
  'publishQuestionVersion'
])
const FRESH_OPERATIONS = new Set<AdminQuestionDomainOperation>([
  'approveQuestionVersion',
  'withdrawQuestionApproval',
  'publishQuestionVersion',
  'retireQuestionVersion',
  'archiveAdminQuestion'
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

const rawDatabaseIdentity = (
  error: unknown
): { sqlState: string; message: string } | undefined => {
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
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2010' ||
    typeof error.meta !== 'object' ||
    error.meta === null
  ) {
    return undefined
  }
  const meta = error.meta as Record<string, unknown>
  const states: string[] = []
  if (typeof meta.code === 'string') states.push(meta.code)
  const driver = meta.driverAdapterError
  if (typeof driver === 'object' && driver !== null) {
    const cause = (driver as Record<string, unknown>).cause
    if (typeof cause === 'object' && cause !== null) {
      const originalCode = (cause as Record<string, unknown>).originalCode
      if (typeof originalCode === 'string') states.push(originalCode)
    }
  }
  const [first, ...rest] = states
  return first && rest.every((state) => state === first) ? first : undefined
}

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

const mapTransactionError = (
  operation: AdminQuestionDomainOperation,
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
      identity?.message === 'Phase 7 Question target changed before arm.' ||
      identity?.message === 'Phase 7 QuestionVersion target changed before arm.'
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
      message: '동시 콘텐츠 변경을 안전하게 확정할 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '23514' &&
    identity.message === 'Cross-question canonical duplicate is forbidden.' &&
    operation === 'publishQuestionVersion'
  ) {
    return duplicateRaceFailure(error)
  }
  if (
    identity?.sqlState === '23514' &&
    identity.message === 'Cross-question canonical duplicate is forbidden.' &&
    CONTENT_OPERATIONS.has(operation)
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'DUPLICATE_QUESTION_CONTENT',
      message: '동일한 내용의 문제가 이미 존재합니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '42501' &&
    identity.message ===
      'QuestionVersion content updates require the locked live author.' &&
    operation === 'updateQuestionVersion'
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'FORBIDDEN',
      message: '작성자만 문제 버전을 수정할 수 있습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '23514' &&
    identity.message ===
      'Review request must be authored by the version author.' &&
    operation === 'requestContentReview'
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'FORBIDDEN',
      message: '작성자만 검수를 요청할 수 있습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '23514' &&
    [
      'Admin content command requires an ACTIVE Question.',
      'QUESTION_VERSION_CREATE requires no open candidate.',
      'REVIEW_REQUEST target state is invalid.',
      'Review decision target state is invalid.',
      'APPROVAL_WITHDRAWAL target state is invalid.',
      'Invalid QuestionVersion status transition.'
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
    operation === 'updateQuestionVersion' &&
    identity?.sqlState === '23514' &&
    [
      'QUESTION_VERSION_UPDATE target is not editable.',
      'Reviewed/published QuestionVersion content is immutable.',
      'QuestionVersion children require an editable unpinned parent.'
    ].includes(identity.message)
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'QUESTION_VERSION_IMMUTABLE',
      message: '검수 또는 학습에 사용된 문제 버전은 수정할 수 없습니다.',
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
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '동시 요청을 안전하게 확정할 수 없습니다.',
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

const mapPreflightError = (
  error: unknown
): AdminQuestionCommandRepositoryError => {
  if (error instanceof AdminQuestionCommandRepositoryError) return error
  return new AdminQuestionCommandRepositoryError({
    code: 'SERVICE_UNAVAILABLE',
    message: '관리자 명령 대상을 확인할 수 없습니다.',
    disposition: 'NO_TX',
    cause: error
  })
}

const isSerializationFailure = (error: unknown): boolean =>
  ['40001', '40P01'].includes(rawSqlState(error) ?? '') ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034')

const contentFingerprint = (
  content: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
): string => {
  const correctOptionText =
    'correctOptionKey' in content
      ? (content.options.find(
          (option) => option.clientOptionKey === content.correctOptionKey
        )?.text ?? '')
      : (content.options.find((option) => option.id === content.correctOptionId)
          ?.text ?? '')
  const identity = createPhase7QuestionDuplicateIdentity({
    correctOptionText,
    optionTexts: content.options.map((option) => option.text),
    passage: content.passage,
    questionText: content.questionText,
    questionType: content.questionType,
    subject: content.subject
  })
  return createHash('sha256').update(identity, 'utf8').digest('hex')
}

const hasCrossQuestionDuplicate = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  questionId: string,
  content: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
): Promise<boolean> => {
  const rows = await client.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM "QuestionVersion"
       WHERE "contentFingerprint" = $1 AND "questionId" <> $2
     ) AS "exists"`,
    contentFingerprint(content),
    questionId
  )
  return rows.length === 1 && rows[0]?.exists === true
}

const hasCrossQuestionFingerprintDuplicate = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  questionId: string,
  fingerprint: string
): Promise<boolean> => {
  const rows = await client.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM "QuestionVersion"
       WHERE "contentFingerprint" = $1 AND "questionId" <> $2
     ) AS "exists"`,
    fingerprint,
    questionId
  )
  return rows.length === 1 && rows[0]?.exists === true
}

const assertNoVisibleCrossQuestionDuplicate = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  questionId: string,
  content: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
): Promise<void> => {
  if (await hasCrossQuestionDuplicate(client, questionId, content)) {
    throw repositoryFailure(
      'DUPLICATE_QUESTION_CONTENT',
      '동일한 내용의 문제가 이미 존재합니다.'
    )
  }
}

const duplicateRaceFailure = (cause: unknown) =>
  new AdminQuestionCommandRepositoryError({
    code: 'SERVICE_UNAVAILABLE',
    message: '동시 콘텐츠 중복으로 요청을 확정하지 못했습니다.',
    disposition: 'DEFINITE_ROLLBACK',
    internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE',
    cause
  })

const postRollbackVersionConflict = (cause: unknown) =>
  new AdminQuestionCommandRepositoryError({
    code: 'VERSION_CONFLICT',
    message: '다른 요청이 먼저 변경했습니다. 최신 상태를 다시 불러와 주세요.',
    disposition: 'DEFINITE_ROLLBACK',
    cause
  })

const postRollbackImmutableVersion = (cause: unknown) =>
  new AdminQuestionCommandRepositoryError({
    code: 'QUESTION_VERSION_IMMUTABLE',
    message: '검수 또는 학습에 사용된 문제 버전은 수정할 수 없습니다.',
    disposition: 'DEFINITE_ROLLBACK',
    cause
  })

const classifyAuthorityFailure = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  operation: AdminQuestionDomainOperation,
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

const uniqueSorted = (values: readonly (string | null)[]): string[] =>
  [...new Set(values.filter((value): value is string => value !== null))].sort()

const toAuthorSnapshot = (
  version: Pick<
    LifecycleVersionTargetRow,
    | 'createdByUserId'
    | 'createdByActorId'
    | 'createdByRoleSnapshot'
    | 'createdByLabelSnapshot'
  >
): EvidenceAccountSnapshot | null =>
  version.createdByActorId !== null &&
  version.createdByRoleSnapshot === 'ADMIN' &&
  version.createdByLabelSnapshot !== 'SYSTEM_SEED'
    ? {
        userId: version.createdByUserId,
        actorId: version.createdByActorId,
        role: version.createdByRoleSnapshot,
        label: version.createdByLabelSnapshot
      }
    : null

const toLatestApproverSnapshot = (
  target: VersionTargetRow
): EvidenceAccountSnapshot | null =>
  target.latestApproverActorId !== null &&
  target.latestApproverRole === 'ADMIN' &&
  target.latestApproverLabel !== null
    ? {
        userId: target.latestApproverUserId,
        actorId: target.latestApproverActorId,
        role: target.latestApproverRole,
        label: target.latestApproverLabel
      }
    : null

const toIso = (value: Date): string => value.toISOString()

const toResult = (input: {
  questionId: string
  versionId: string
  questionRowVersion: number
  versionRowVersion: number
  versionStatus: QuestionVersionStatus
  occurredAt: Date
}): AdminQuestionMutationResult => ({
  questionId: input.questionId,
  questionVersionId: input.versionId,
  lifecycleStatus: 'ACTIVE',
  versionStatus: input.versionStatus,
  questionRowVersion: input.questionRowVersion,
  versionRowVersion: input.versionRowVersion,
  occurredAt: toIso(input.occurredAt)
})

const toArchiveResult = (input: {
  occurredAt: Date
  questionId: string
  questionRowVersion: number
}): AdminQuestionMutationResult => ({
  questionId: input.questionId,
  questionVersionId: null,
  lifecycleStatus: 'ARCHIVED',
  versionStatus: null,
  questionRowVersion: input.questionRowVersion,
  versionRowVersion: null,
  occurredAt: toIso(input.occurredAt)
})

const beginOperation = async (
  transaction: Prisma.TransactionClient,
  input: {
    auditEnvironment: AuditEnvironment
    authority: AdminCommandAuthority
    command: string
    referencedUserIds: string[]
  }
): Promise<BegunOperationRow> => {
  const begun = await transaction.$queryRawUnsafe<BegunOperationRow[]>(
    `SELECT * FROM "phase7_begin_admin_operation"(
       $1::"AdminAuditCommand", $2, $3, $4::"AdminAuditEnvironment", $5::uuid[]
     )`,
    input.command,
    input.authority.rawSessionToken,
    input.authority.requestId,
    input.auditEnvironment,
    input.referencedUserIds
  )
  const operation = begun[0]
  if (!operation || operation.actorUserId !== input.authority.actorId) {
    throw new Error('Phase 7 operation actor did not match the request actor.')
  }
  return operation
}

const armOperation = async (
  transaction: Prisma.TransactionClient,
  operation: BegunOperationRow,
  targetManifest: TargetManifest
): Promise<OperationContext> => {
  const armed = await transaction.$queryRawUnsafe<OccurredAtRow[]>(
    `SELECT "phase7_arm_admin_operation"($1, $2::jsonb) AS "occurredAt"`,
    operation.operationId,
    JSON.stringify(targetManifest)
  )
  const occurredAt = armed[0]?.occurredAt
  if (!(occurredAt instanceof Date) || !Number.isFinite(occurredAt.getTime())) {
    throw new Error('Phase 7 operation timestamp is unavailable.')
  }
  return { ...operation, occurredAt }
}

const beginAndArm = async (
  transaction: Prisma.TransactionClient,
  input: {
    auditEnvironment: AuditEnvironment
    authority: AdminCommandAuthority
    command: string
    referencedUserIds: string[]
    targetManifest: TargetManifest
  }
): Promise<OperationContext> => {
  const operation = await beginOperation(transaction, input)
  return armOperation(transaction, operation, input.targetManifest)
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

const insertAudit = async (
  transaction: Prisma.TransactionClient,
  input: {
    actorId: string
    afterRowVersion: number | null
    afterState: string | null
    beforeRowVersion: number | null
    beforeState: string | null
    changedFields: readonly string[]
    command: string
    environment: AuditEnvironment
    occurredAt: Date
    operationId: string
    requestId: string
    targetId: string
    targetType: 'QUESTION' | 'QUESTION_VERSION'
    metadata?:
      | { kind: 'NONE_V1' }
      | {
          kind: 'QUESTION_ARCHIVE_V1'
          retiredPublishedCount: 0 | 1
          abandonedCandidateCount: 0 | 1
        }
  }
): Promise<void> => {
  const changedFields = JSON.stringify(input.changedFields)
  const metadata = JSON.stringify(input.metadata ?? { kind: 'NONE_V1' })
  await transaction.$executeRawUnsafe(
    `INSERT INTO "AdminAuditLog" (
       "command", "targetType", "targetId", "actorKind",
       "actorUserId", "actorId", "actorRole", "actorLabel",
       "beforeState", "afterState", "beforeRowVersion", "afterRowVersion",
       "changedFields", "metadata", "contentDigest", "operationId",
       "requestId", "environment", "occurredAt"
     ) VALUES (
       $1::"AdminAuditCommand", $2::"AdminAuditTargetType", $3, 'ACCOUNT',
       $4, $4, 'ADMIN', 'ACTIVE_ADMIN', $5::text, $6::text, $7, $8, $9::jsonb,
       $10::jsonb,
       "phase7_admin_audit_content_digest"(
         $11, $1::"AdminAuditCommand", $2::"AdminAuditTargetType", $3,
         $5::text, $6::text, $7, $8, $9::jsonb, $10::jsonb
       ), $11, $12, $13::"AdminAuditEnvironment", $14
     )`,
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
}

const insertReview = async (
  transaction: Prisma.TransactionClient,
  input: {
    action: string
    actorId: string
    comment: string | null
    counterpart: EvidenceAccountSnapshot | null
    fromState: QuestionVersionStatus
    occurredAt: Date
    operationId: string
    questionId: string
    reason: string | null
    requestId: string
    toState: QuestionVersionStatus
    versionId: string
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
       $1, $2, $3::"ContentReviewAction", $4::"QuestionVersionStatus",
       $5::"QuestionVersionStatus", 'ACCOUNT', $6, $6, 'ADMIN',
       'ACTIVE_ADMIN', $7, $8, $9::"UserRole", $10::"AccountActorLabel",
       $11, $12, $13, $14, $15
     )`,
    input.questionId,
    input.versionId,
    input.action,
    input.fromState,
    input.toState,
    input.actorId,
    input.counterpart?.userId ?? null,
    input.counterpart?.actorId ?? null,
    input.counterpart?.role ?? null,
    input.counterpart?.label ?? null,
    input.reason,
    input.comment,
    input.operationId,
    input.requestId,
    input.occurredAt
  )
}

const resolveTags = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  content: Pick<
    CreateAdminQuestionRequest,
    'level' | 'subject' | 'questionType' | 'tagNames'
  >
): Promise<TagRow[]> => {
  const normalizedNames = content.tagNames.map(normalizePhase7TagKey)
  const rows = await client.$queryRawUnsafe<TagRow[]>(
    `SELECT tag."id", tag."label", tag."normalizedName"
     FROM "Tag" AS tag
     JOIN "TagApplicability" AS applicability
       ON applicability."tagId" = tag."id"
      AND applicability."level" = $1::"JlptLevel"
      AND applicability."subject" = $2::"QuestionSubject"
      AND applicability."questionType" = $3::"QuestionType"
     WHERE tag."normalizedName" = ANY($4::text[])
     ORDER BY tag."normalizedName" COLLATE "C", tag."id"`,
    content.level,
    content.subject,
    content.questionType,
    normalizedNames
  )
  const byName = new Map(rows.map((row) => [row.normalizedName, row]))
  if (
    rows.length !== normalizedNames.length ||
    normalizedNames.some((name) => !byName.has(name))
  ) {
    throw repositoryFailure(
      'VALIDATION_ERROR',
      '문제에 적용할 수 없는 태그가 포함되어 있습니다.',
      { tagNames: ['모든 태그는 존재하며 문제 분류에 적용 가능해야 합니다.'] }
    )
  }
  return normalizedNames.map((name) => byName.get(name)!)
}

const loadQuestionTarget = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  questionId: string
): Promise<QuestionTargetRow | null> => {
  const rows = await client.$queryRawUnsafe<QuestionTargetRow[]>(
    `SELECT question."id", question."lifecycleStatus",
       question."rowVersion", question."createdByUserId",
       question."currentPublishedVersionId",
       COALESCE(maximum."maximumVersionNumber", 0)::int AS "maximumVersionNumber",
       EXISTS (
         SELECT 1 FROM "QuestionVersion" AS candidate
         WHERE candidate."questionId" = question."id"
           AND candidate."status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
       ) AS "hasOpenCandidate"
     FROM "Question" AS question
     LEFT JOIN LATERAL (
       SELECT MAX(version."versionNumber")::int AS "maximumVersionNumber"
       FROM "QuestionVersion" AS version
       WHERE version."questionId" = question."id"
     ) AS maximum ON TRUE
     WHERE question."id" = $1`,
    questionId
  )
  return rows[0] ?? null
}

const loadVersionTarget = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  versionId: string
): Promise<VersionTargetRow | null> => {
  const rows = await client.$queryRawUnsafe<VersionTargetRow[]>(
    `SELECT version."questionId", question."lifecycleStatus"
         AS "questionLifecycleStatus",
       question."rowVersion" AS "questionRowVersion",
       question."currentPublishedVersionId"
         AS "questionCurrentPublishedVersionId",
       question."createdByUserId" AS "questionCreatedByUserId",
       version."id" AS "versionId", version."versionNumber",
       version."status" AS "versionStatus",
       version."rowVersion" AS "versionRowVersion",
       version."createdByUserId" AS "versionCreatedByUserId",
       version."createdByActorId" AS "versionCreatedByActorId",
       version."createdByRoleSnapshot" AS "versionCreatedByRoleSnapshot",
       version."createdByLabelSnapshot" AS "versionCreatedByLabelSnapshot",
       version."contentFingerprint",
       version."level", version."subject", version."questionType",
       version."difficulty", version."passage", version."questionText",
       version."explanationKo", version."explanationJa",
       version."correctOptionId",
       EXISTS (
         SELECT 1 FROM "StudySessionQuestion" AS pinned
         WHERE pinned."questionVersionId" = version."id"
       ) AS "isPinned",
       latest_approval."actorUserId" AS "latestApproverUserId",
       latest_approval."actorId" AS "latestApproverActorId",
       latest_approval."actorRole" AS "latestApproverRole",
       latest_approval."actorLabel" AS "latestApproverLabel"
     FROM "QuestionVersion" AS version
     JOIN "Question" AS question ON question."id" = version."questionId"
     LEFT JOIN LATERAL (
         SELECT review."actorUserId", review."actorId",
           review."actorRole", review."actorLabel"
         FROM "ContentReview" AS review
         WHERE review."questionVersionId" = version."id"
           AND review."action" = 'APPROVED'
         ORDER BY review."occurredAt" DESC, review."id" DESC
         LIMIT 1
       ) AS latest_approval ON TRUE
     WHERE version."id" = $1`,
    versionId
  )
  return rows[0] ?? null
}

const loadLifecycleVersions = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  questionId: string
): Promise<LifecycleVersionTargetRow[]> =>
  client.$queryRawUnsafe<LifecycleVersionTargetRow[]>(
    `SELECT version."id", version."questionId", version."status",
       version."rowVersion", version."createdByUserId",
       version."createdByActorId", version."createdByRoleSnapshot",
       version."createdByLabelSnapshot", version."contentFingerprint"
     FROM "QuestionVersion" AS version
     JOIN "Question" AS question ON question."id" = version."questionId"
     WHERE version."questionId" = $1
       AND (version."id" = question."currentPublishedVersionId"
         OR version."status" IN (
           'DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'
         ))
     ORDER BY version."id"`,
    questionId
  )

const loadOptions = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  versionId: string
): Promise<OptionRow[]> =>
  client.$queryRawUnsafe<OptionRow[]>(
    `SELECT "id", "label", "ordinal", "text"
     FROM "QuestionOption" WHERE "questionVersionId" = $1
     ORDER BY "ordinal", "id"`,
    versionId
  )

const loadVersionTags = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  versionId: string
): Promise<VersionTagRow[]> =>
  client.$queryRawUnsafe<VersionTagRow[]>(
    `SELECT assignment."id" AS "assignmentId", tag."id", tag."label",
       tag."normalizedName"
     FROM "QuestionVersionTag" AS assignment
     JOIN "Tag" AS tag ON tag."id" = assignment."tagId"
     WHERE assignment."questionVersionId" = $1
     ORDER BY tag."normalizedName" COLLATE "C", assignment."id"`,
    versionId
  )

const createVersionContent = async (
  transaction: Prisma.TransactionClient,
  input: {
    actorId: string
    content: CreateAdminQuestionRequest
    occurredAt: Date
    questionId: string
    tags: readonly TagRow[]
    versionId: string
    versionNumber: number
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
    throw new Error('Correct option key was not resolved.')
  }
  await transaction.$executeRawUnsafe(
    `INSERT INTO "QuestionVersion" (
       "id", "questionId", "versionNumber", "level", "subject",
       "questionType", "passage", "questionText", "correctOptionId",
       "explanationKo", "explanationJa", "difficulty", "contentFingerprint",
       "createdByUserId", "createdByActorId", "createdByRoleSnapshot",
       "createdByLabelSnapshot", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4::"JlptLevel", $5::"QuestionSubject",
       $6::"QuestionType", $7, $8, $9, $10, $11,
       $12::"QuestionDifficulty", repeat('0', 64), $13, $13, 'ADMIN',
       'ACTIVE_ADMIN', $14, $14
     )`,
    input.versionId,
    input.questionId,
    input.versionNumber,
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

const computeUpdateChangedFields = (
  target: VersionTargetRow,
  existingOptions: readonly OptionRow[],
  existingTags: readonly VersionTagRow[],
  request: UpdateQuestionVersionRequest,
  desiredTags: readonly TagRow[]
): string[] => {
  const changed = new Set<string>()
  if (target.level !== request.level) changed.add('LEVEL')
  if (target.subject !== request.subject) changed.add('SUBJECT')
  if (target.questionType !== request.questionType) changed.add('QUESTION_TYPE')
  if (target.difficulty !== request.difficulty) changed.add('DIFFICULTY')
  if (target.passage !== request.passage) changed.add('PASSAGE')
  if (target.questionText !== request.questionText) changed.add('QUESTION_TEXT')
  if (target.explanationKo !== request.explanationKo)
    changed.add('EXPLANATION_KO')
  if (target.explanationJa !== request.explanationJa)
    changed.add('EXPLANATION_JA')
  const requestedOptions = request.options.toSorted(
    (left, right) =>
      left.ordinal - right.ordinal || left.id.localeCompare(right.id)
  )
  if (
    existingOptions.length !== requestedOptions.length ||
    existingOptions.some((option, index) => {
      const requested = requestedOptions[index]
      return (
        !requested ||
        option.id !== requested.id ||
        option.ordinal !== requested.ordinal ||
        option.label !== String(requested.ordinal) ||
        option.text !== requested.text
      )
    })
  ) {
    changed.add('OPTIONS')
  }
  if (target.correctOptionId !== request.correctOptionId)
    changed.add('CORRECT_OPTION')
  const existingTagIds = existingTags.map((tag) => tag.id).sort()
  const desiredTagIds = desiredTags.map((tag) => tag.id).sort()
  if (JSON.stringify(existingTagIds) !== JSON.stringify(desiredTagIds)) {
    changed.add('TAGS')
  }
  return UPDATE_CHANGED_FIELD_ORDER.filter((field) => changed.has(field))
}

const validateUpdate = (
  target: VersionTargetRow,
  options: readonly OptionRow[],
  authority: AdminCommandAuthority,
  request: UpdateQuestionVersionRequest
): void => {
  if (target.versionCreatedByUserId !== authority.actorId) {
    throw repositoryFailure(
      'FORBIDDEN',
      '작성자만 문제 버전을 수정할 수 있습니다.'
    )
  }
  if (target.versionRowVersion !== request.expectedRowVersion) {
    throw repositoryFailure(
      'VERSION_CONFLICT',
      '다른 요청이 먼저 변경했습니다. 최신 상태를 다시 불러와 주세요.'
    )
  }
  if (target.questionLifecycleStatus !== 'ACTIVE') {
    throw repositoryFailure(
      'INVALID_STATE_TRANSITION',
      '보관된 문제의 버전은 수정할 수 없습니다.'
    )
  }
  if (
    !['DRAFT', 'CHANGES_REQUESTED'].includes(target.versionStatus) ||
    target.isPinned
  ) {
    throw repositoryFailure(
      'QUESTION_VERSION_IMMUTABLE',
      '검수 또는 학습에 사용된 문제 버전은 수정할 수 없습니다.'
    )
  }
  const existingIds = new Set(options.map((option) => option.id))
  const requestedIds = new Set(request.options.map((option) => option.id))
  if (
    existingIds.size !== 4 ||
    requestedIds.size !== 4 ||
    [...existingIds].some((id) => !requestedIds.has(id))
  ) {
    throw repositoryFailure(
      'VALIDATION_ERROR',
      '기존 보기 ID 네 개를 모두 유지해야 합니다.',
      { options: ['option ID 집합은 기존 문제 버전과 정확히 같아야 합니다.'] }
    )
  }
}

interface TransitionConfig {
  action: 'REQUESTED' | 'CHANGES_REQUESTED' | 'APPROVED' | 'APPROVAL_WITHDRAWN'
  command:
    | 'REVIEW_REQUEST'
    | 'CHANGE_REQUEST'
    | 'APPROVAL'
    | 'APPROVAL_WITHDRAWAL'
  fromStates: readonly QuestionVersionStatus[]
  toState: 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED'
  authorOnly: boolean
}

const transitionConfigByOperation: Readonly<
  Record<LifecycleOperation, TransitionConfig>
> = {
  requestContentReview: {
    action: 'REQUESTED',
    command: 'REVIEW_REQUEST',
    fromStates: ['DRAFT', 'CHANGES_REQUESTED'],
    toState: 'IN_REVIEW',
    authorOnly: true
  },
  requestQuestionChanges: {
    action: 'CHANGES_REQUESTED',
    command: 'CHANGE_REQUEST',
    fromStates: ['IN_REVIEW'],
    toState: 'CHANGES_REQUESTED',
    authorOnly: false
  },
  approveQuestionVersion: {
    action: 'APPROVED',
    command: 'APPROVAL',
    fromStates: ['IN_REVIEW'],
    toState: 'APPROVED',
    authorOnly: false
  },
  withdrawQuestionApproval: {
    action: 'APPROVAL_WITHDRAWN',
    command: 'APPROVAL_WITHDRAWAL',
    fromStates: ['APPROVED'],
    toState: 'CHANGES_REQUESTED',
    authorOnly: false
  }
}

type TransitionRequest =
  | RequestContentReviewRequest
  | RequestQuestionChangesRequest
  | ApproveQuestionVersionRequest
  | WithdrawQuestionApprovalRequest

export interface AdminQuestionCommandRepository {
  createQuestion: (
    authority: AdminCommandAuthority,
    request: CreateAdminQuestionRequest
  ) => Promise<AdminQuestionMutationResult>
  createVersion: (
    authority: AdminCommandAuthority,
    questionId: string,
    request: CreateAdminQuestionVersionRequest
  ) => Promise<AdminQuestionMutationResult>
  updateVersion: (
    authority: AdminCommandAuthority,
    versionId: string,
    request: UpdateQuestionVersionRequest
  ) => Promise<AdminQuestionMutationResult>
  transitionVersion: (
    operation: LifecycleOperation,
    authority: AdminCommandAuthority,
    versionId: string,
    request: TransitionRequest
  ) => Promise<AdminQuestionMutationResult>
}

export interface AdminQuestionPublicationCommandRepository {
  publishVersion: (
    authority: AdminCommandAuthority,
    versionId: string,
    request: PublishQuestionVersionRequest
  ) => Promise<AdminQuestionMutationResult>
  retireVersion: (
    authority: AdminCommandAuthority,
    versionId: string,
    request: RetireQuestionVersionRequest
  ) => Promise<AdminQuestionMutationResult>
  archiveQuestion: (
    authority: AdminCommandAuthority,
    questionId: string,
    request: ArchiveAdminQuestionRequest
  ) => Promise<AdminQuestionMutationResult>
}

export type AdminQuestionPreparedCommandRepository =
  AdminQuestionCommandRepository & AdminQuestionPublicationCommandRepository

interface AdminQuestionCommandRepositoryOptions {
  readonly auditEnvironment: AuditEnvironment
  readonly client: PrismaClient
}

const createPrismaAdminQuestionCommandRepositoryInternal = (
  { auditEnvironment, client }: AdminQuestionCommandRepositoryOptions,
  includePublication: boolean
): AdminQuestionCommandRepository | AdminQuestionPreparedCommandRepository => {
  const createQuestion: AdminQuestionCommandRepository['createQuestion'] =
    async (authority, request) => {
      let tags: TagRow[]
      const questionId = randomUUID()
      const versionId = randomUUID()
      try {
        tags = await resolveTags(client, request)
        await assertNoVisibleCrossQuestionDuplicate(client, questionId, request)
      } catch (error: unknown) {
        throw mapPreflightError(error)
      }
      try {
        return await client.$transaction(
          async (transaction) => {
            const operation = await beginAndArm(transaction, {
              auditEnvironment,
              authority,
              command: 'QUESTION_CREATE',
              referencedUserIds: [authority.actorId],
              targetManifest: {
                questions: [],
                versions: [],
                reports: [],
                tags: tags.map((tag) => tag.id).sort()
              }
            })
            const lockedTags = await resolveTags(transaction, request)
            await transaction.$executeRawUnsafe(
              `INSERT INTO "Question" (
                 "id", "createdByUserId", "createdByActorId",
                 "createdByRoleSnapshot", "createdByLabelSnapshot",
                 "createdAt", "updatedAt"
               ) VALUES ($1, $2, $2, 'ADMIN', 'ACTIVE_ADMIN', $3, $3)`,
              questionId,
              authority.actorId,
              operation.occurredAt
            )
            await createVersionContent(transaction, {
              actorId: authority.actorId,
              content: request,
              occurredAt: operation.occurredAt,
              questionId,
              tags: lockedTags,
              versionId,
              versionNumber: 1
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
              targetId: questionId,
              targetType: 'QUESTION'
            })
            await finishOperation(transaction, operation.operationId)
            return toResult({
              questionId,
              versionId,
              questionRowVersion: 1,
              versionRowVersion: 1,
              versionStatus: 'DRAFT',
              occurredAt: operation.occurredAt
            })
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        )
      } catch (error: unknown) {
        const authorityFailure = await classifyAuthorityFailure(
          client,
          'createAdminQuestion',
          authority,
          error
        )
        if (authorityFailure) throw authorityFailure
        const mapped = mapTransactionError('createAdminQuestion', error)
        if (isSerializationFailure(error)) {
          let duplicate = false
          try {
            duplicate = await hasCrossQuestionDuplicate(
              client,
              questionId,
              request
            )
          } catch {
            // Keep the original, definite rollback classification when the
            // authoritative post-check is itself unavailable.
          }
          if (duplicate) throw duplicateRaceFailure(error)
        }
        throw mapped
      }
    }

  const createVersion: AdminQuestionCommandRepository['createVersion'] = async (
    authority,
    questionId,
    request
  ) => {
    let target: QuestionTargetRow | null
    let tags: TagRow[]
    try {
      target = await loadQuestionTarget(client, questionId)
      if (!target) {
        throw repositoryFailure(
          'RESOURCE_NOT_FOUND',
          '관리자 문제를 찾을 수 없습니다.'
        )
      }
      if (target.rowVersion !== request.expectedQuestionRowVersion) {
        throw repositoryFailure(
          'VERSION_CONFLICT',
          '다른 요청이 먼저 문제를 변경했습니다.'
        )
      }
      if (target.lifecycleStatus !== 'ACTIVE' || target.hasOpenCandidate) {
        throw repositoryFailure(
          'INVALID_STATE_TRANSITION',
          '현재 문제 상태에서는 새 버전을 만들 수 없습니다.'
        )
      }
      tags = await resolveTags(client, request)
      await assertNoVisibleCrossQuestionDuplicate(client, questionId, request)
    } catch (error: unknown) {
      throw mapPreflightError(error)
    }
    const versionId = randomUUID()
    try {
      return await client.$transaction(
        async (transaction) => {
          const operation = await beginAndArm(transaction, {
            auditEnvironment,
            authority,
            command: 'QUESTION_VERSION_CREATE',
            referencedUserIds: uniqueSorted([
              authority.actorId,
              target.createdByUserId
            ]),
            targetManifest: {
              questions: [
                {
                  id: questionId,
                  rowVersion: target.rowVersion,
                  state: target.lifecycleStatus
                }
              ],
              versions: [],
              reports: [],
              tags: tags.map((tag) => tag.id).sort()
            }
          })
          const lockedTags = await resolveTags(transaction, request)
          await transaction.$executeRawUnsafe(
            `UPDATE "Question" SET "rowVersion" = $2, "updatedAt" = $3
               WHERE "id" = $1`,
            questionId,
            target.rowVersion + 1,
            operation.occurredAt
          )
          await createVersionContent(transaction, {
            actorId: authority.actorId,
            content: request,
            occurredAt: operation.occurredAt,
            questionId,
            tags: lockedTags,
            versionId,
            versionNumber: target.maximumVersionNumber + 1
          })
          await insertAudit(transaction, {
            actorId: authority.actorId,
            afterRowVersion: 1,
            afterState: 'DRAFT',
            beforeRowVersion: null,
            beforeState: null,
            changedFields: [
              'VERSION_STATUS',
              ...CREATE_CHANGED_FIELDS.filter(
                (field) => field !== 'LIFECYCLE_STATUS'
              )
            ],
            command: 'QUESTION_VERSION_CREATE',
            environment: auditEnvironment,
            occurredAt: operation.occurredAt,
            operationId: operation.operationId,
            requestId: authority.requestId,
            targetId: versionId,
            targetType: 'QUESTION_VERSION'
          })
          await finishOperation(transaction, operation.operationId)
          return toResult({
            questionId,
            versionId,
            questionRowVersion: target.rowVersion + 1,
            versionRowVersion: 1,
            versionStatus: 'DRAFT',
            occurredAt: operation.occurredAt
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    } catch (error: unknown) {
      const authorityFailure = await classifyAuthorityFailure(
        client,
        'createAdminQuestionVersion',
        authority,
        error
      )
      if (authorityFailure) throw authorityFailure
      const mapped = mapTransactionError('createAdminQuestionVersion', error)
      if (isSerializationFailure(error)) {
        try {
          const current = await loadQuestionTarget(client, questionId)
          if (
            !current ||
            current.rowVersion !== target.rowVersion ||
            current.lifecycleStatus !== target.lifecycleStatus ||
            current.hasOpenCandidate !== target.hasOpenCandidate ||
            current.maximumVersionNumber !== target.maximumVersionNumber
          ) {
            throw postRollbackVersionConflict(error)
          }
          if (await hasCrossQuestionDuplicate(client, questionId, request)) {
            throw duplicateRaceFailure(error)
          }
        } catch (postcheckError: unknown) {
          if (postcheckError instanceof AdminQuestionCommandRepositoryError) {
            throw postcheckError
          }
        }
      }
      throw mapped
    }
  }

  const updateVersion: AdminQuestionCommandRepository['updateVersion'] = async (
    authority,
    versionId,
    request
  ) => {
    let target: VersionTargetRow | null
    let options: OptionRow[]
    let existingTags: VersionTagRow[]
    let desiredTags: TagRow[]
    try {
      target = await loadVersionTarget(client, versionId)
      if (!target) {
        throw repositoryFailure(
          'RESOURCE_NOT_FOUND',
          '문제 버전을 찾을 수 없습니다.'
        )
      }
      options = await loadOptions(client, versionId)
      validateUpdate(target, options, authority, request)
      existingTags = await loadVersionTags(client, versionId)
      desiredTags = await resolveTags(client, request)
      await assertNoVisibleCrossQuestionDuplicate(
        client,
        target.questionId,
        request
      )
    } catch (error: unknown) {
      throw mapPreflightError(error)
    }
    const changedFields = computeUpdateChangedFields(
      target,
      options,
      existingTags,
      request,
      desiredTags
    )
    try {
      return await client.$transaction(
        async (transaction) => {
          const operation = await beginAndArm(transaction, {
            auditEnvironment,
            authority,
            command: 'QUESTION_VERSION_UPDATE',
            referencedUserIds: uniqueSorted([
              authority.actorId,
              target.questionCreatedByUserId,
              target.versionCreatedByUserId
            ]),
            targetManifest: {
              questions: [
                {
                  id: target.questionId,
                  rowVersion: target.questionRowVersion,
                  state: target.questionLifecycleStatus
                }
              ],
              versions: [
                {
                  id: versionId,
                  rowVersion: target.versionRowVersion,
                  state: target.versionStatus
                }
              ],
              reports: [],
              tags: desiredTags.map((tag) => tag.id).sort()
            }
          })
          const lockedTags = await resolveTags(transaction, request)
          const currentTags = await loadVersionTags(transaction, versionId)
          await transaction.$executeRawUnsafe(
            `SET CONSTRAINTS
                 "QuestionOption_questionVersionId_label_key",
                 "QuestionOption_questionVersionId_ordinal_key" DEFERRED`
          )
          const desiredTagIds = lockedTags.map((tag) => tag.id)
          await transaction.$executeRawUnsafe(
            `DELETE FROM "QuestionVersionTag"
               WHERE "questionVersionId" = $1
                 AND NOT ("tagId" = ANY($2::uuid[]))`,
            versionId,
            desiredTagIds
          )
          await transaction.$executeRawUnsafe(
            `UPDATE "QuestionVersion" SET
                 "level" = $2::"JlptLevel",
                 "subject" = $3::"QuestionSubject",
                 "questionType" = $4::"QuestionType",
                 "difficulty" = $5::"QuestionDifficulty",
                 "passage" = $6, "questionText" = $7,
                 "explanationKo" = $8, "explanationJa" = $9,
                 "correctOptionId" = $10, "rowVersion" = $11,
                 "updatedAt" = $12
               WHERE "id" = $1`,
            versionId,
            request.level,
            request.subject,
            request.questionType,
            request.difficulty,
            request.passage,
            request.questionText,
            request.explanationKo,
            request.explanationJa,
            request.correctOptionId,
            target.versionRowVersion + 1,
            operation.occurredAt
          )
          for (const option of request.options) {
            const updated = await transaction.$executeRawUnsafe(
              `UPDATE "QuestionOption"
                 SET "label" = $3, "text" = $4, "ordinal" = $5
                 WHERE "questionVersionId" = $1 AND "id" = $2`,
              versionId,
              option.id,
              String(option.ordinal),
              option.text,
              option.ordinal
            )
            if (updated !== 1) {
              throw repositoryFailure(
                'VERSION_CONFLICT',
                '문제 보기 구성이 변경되었습니다.'
              )
            }
          }
          const currentTagIds = new Set(currentTags.map((tag) => tag.id))
          for (const tag of lockedTags) {
            if (!currentTagIds.has(tag.id)) {
              await transaction.$executeRawUnsafe(
                `INSERT INTO "QuestionVersionTag" (
                     "id", "questionVersionId", "tagId", "labelSnapshot",
                     "normalizedNameSnapshot"
                   ) VALUES ($1, $2, $3, $4, $5)`,
                randomUUID(),
                versionId,
                tag.id,
                tag.label,
                tag.normalizedName
              )
            }
          }
          await insertAudit(transaction, {
            actorId: authority.actorId,
            afterRowVersion: target.versionRowVersion + 1,
            afterState: target.versionStatus,
            beforeRowVersion: target.versionRowVersion,
            beforeState: target.versionStatus,
            changedFields,
            command: 'QUESTION_VERSION_UPDATE',
            environment: auditEnvironment,
            occurredAt: operation.occurredAt,
            operationId: operation.operationId,
            requestId: authority.requestId,
            targetId: versionId,
            targetType: 'QUESTION_VERSION'
          })
          await finishOperation(transaction, operation.operationId)
          return toResult({
            questionId: target.questionId,
            versionId,
            questionRowVersion: target.questionRowVersion,
            versionRowVersion: target.versionRowVersion + 1,
            versionStatus: target.versionStatus,
            occurredAt: operation.occurredAt
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    } catch (error: unknown) {
      const authorityFailure = await classifyAuthorityFailure(
        client,
        'updateQuestionVersion',
        authority,
        error
      )
      if (authorityFailure) throw authorityFailure
      const mapped = mapTransactionError('updateQuestionVersion', error)
      if (isSerializationFailure(error)) {
        try {
          const current = await loadVersionTarget(client, versionId)
          if (
            !current ||
            current.questionRowVersion !== target.questionRowVersion ||
            current.questionLifecycleStatus !==
              target.questionLifecycleStatus ||
            current.versionRowVersion !== target.versionRowVersion ||
            current.versionStatus !== target.versionStatus
          ) {
            throw postRollbackVersionConflict(error)
          }
          if (current.isPinned) {
            throw postRollbackImmutableVersion(error)
          }
          if (
            await hasCrossQuestionDuplicate(client, target.questionId, request)
          ) {
            throw duplicateRaceFailure(error)
          }
        } catch (postcheckError: unknown) {
          if (postcheckError instanceof AdminQuestionCommandRepositoryError) {
            throw postcheckError
          }
        }
      }
      throw mapped
    }
  }

  const transitionVersion: AdminQuestionCommandRepository['transitionVersion'] =
    async (operationName, authority, versionId, request) => {
      const config = transitionConfigByOperation[operationName]
      const assertTargetAndVersion = (
        candidate: VersionTargetRow | null
      ): VersionTargetRow => {
        if (!candidate) {
          throw repositoryFailure(
            'RESOURCE_NOT_FOUND',
            '문제 버전을 찾을 수 없습니다.'
          )
        }
        if (
          config.authorOnly &&
          candidate.versionCreatedByUserId !== authority.actorId
        ) {
          throw repositoryFailure(
            'FORBIDDEN',
            '작성자만 검수를 요청할 수 있습니다.'
          )
        }
        if (candidate.versionRowVersion !== request.expectedRowVersion) {
          throw repositoryFailure(
            'VERSION_CONFLICT',
            '다른 요청이 먼저 변경했습니다. 최신 상태를 다시 불러와 주세요.'
          )
        }
        return candidate
      }
      const assertStateAndDuties = (candidate: VersionTargetRow): void => {
        if (candidate.questionLifecycleStatus !== 'ACTIVE') {
          throw repositoryFailure(
            'INVALID_STATE_TRANSITION',
            '보관된 문제에서는 검수 상태를 변경할 수 없습니다.'
          )
        }
        if (!config.fromStates.includes(candidate.versionStatus)) {
          throw repositoryFailure(
            'INVALID_STATE_TRANSITION',
            '현재 버전 상태에서는 요청한 검수 전이를 수행할 수 없습니다.'
          )
        }
        if (
          !config.authorOnly &&
          candidate.versionCreatedByUserId === authority.actorId
        ) {
          throw repositoryFailure(
            'SEPARATION_OF_DUTIES_VIOLATION',
            '작성자와 검수자는 서로 달라야 합니다.'
          )
        }
        if (
          toAuthorSnapshot({
            createdByUserId: candidate.versionCreatedByUserId,
            createdByActorId: candidate.versionCreatedByActorId,
            createdByRoleSnapshot: candidate.versionCreatedByRoleSnapshot,
            createdByLabelSnapshot: candidate.versionCreatedByLabelSnapshot
          }) === null
        ) {
          throw repositoryFailure(
            'INVALID_STATE_TRANSITION',
            '시스템 seed 또는 작성자 없는 버전은 검수 전이 대상이 아닙니다.'
          )
        }
      }
      const toTargetManifest = (
        candidate: VersionTargetRow
      ): TargetManifest => ({
        questions: [
          {
            id: candidate.questionId,
            rowVersion: candidate.questionRowVersion,
            state: candidate.questionLifecycleStatus
          }
        ],
        versions: [
          {
            id: versionId,
            rowVersion: candidate.versionRowVersion,
            state: candidate.versionStatus
          }
        ],
        reports: [],
        tags: []
      })
      let target: VersionTargetRow | null
      try {
        target = await loadVersionTarget(client, versionId)
      } catch (error: unknown) {
        throw mapPreflightError(error)
      }
      const reason = 'reason' in request ? request.reason : null
      const comment = request.comment ?? null
      try {
        return await client.$transaction(
          async (transaction) => {
            const command = config.command
            const referencedUserIds = uniqueSorted([
              authority.actorId,
              target?.questionCreatedByUserId ?? null,
              target?.versionCreatedByUserId ?? null,
              operationName === 'withdrawQuestionApproval'
                ? (target?.latestApproverUserId ?? null)
                : null
            ])
            const begun = await beginOperation(transaction, {
              auditEnvironment,
              authority,
              command,
              referencedUserIds
            })
            const commandTarget = assertTargetAndVersion(target)
            const targetManifest = toTargetManifest(commandTarget)
            const operation = await armOperation(
              transaction,
              begun,
              targetManifest
            )
            assertStateAndDuties(commandTarget)
            const counterpart = config.authorOnly
              ? null
              : toAuthorSnapshot({
                  createdByUserId: commandTarget.versionCreatedByUserId,
                  createdByActorId: commandTarget.versionCreatedByActorId,
                  createdByRoleSnapshot:
                    commandTarget.versionCreatedByRoleSnapshot,
                  createdByLabelSnapshot:
                    commandTarget.versionCreatedByLabelSnapshot
                })
            const nextRowVersion = commandTarget.versionRowVersion + 1
            await transaction.$executeRawUnsafe(
              `UPDATE "QuestionVersion"
               SET "status" = $2::"QuestionVersionStatus",
                   "rowVersion" = $3, "updatedAt" = $4
               WHERE "id" = $1`,
              versionId,
              config.toState,
              nextRowVersion,
              operation.occurredAt
            )
            await insertReview(transaction, {
              action: config.action,
              actorId: authority.actorId,
              comment,
              counterpart,
              fromState: commandTarget.versionStatus,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              questionId: commandTarget.questionId,
              reason,
              requestId: authority.requestId,
              toState: config.toState,
              versionId
            })
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: nextRowVersion,
              afterState: config.toState,
              beforeRowVersion: commandTarget.versionRowVersion,
              beforeState: commandTarget.versionStatus,
              changedFields: ['VERSION_STATUS'],
              command,
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: versionId,
              targetType: 'QUESTION_VERSION'
            })
            await finishOperation(transaction, operation.operationId)
            return toResult({
              questionId: commandTarget.questionId,
              versionId,
              questionRowVersion: commandTarget.questionRowVersion,
              versionRowVersion: nextRowVersion,
              versionStatus: config.toState,
              occurredAt: operation.occurredAt
            })
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        )
      } catch (error: unknown) {
        const authorityFailure = await classifyAuthorityFailure(
          client,
          operationName,
          authority,
          error
        )
        if (authorityFailure) throw authorityFailure
        throw mapTransactionError(operationName, error)
      }
    }

  const activeRepository: AdminQuestionCommandRepository = {
    createQuestion,
    createVersion,
    updateVersion,
    transitionVersion
  }
  if (!includePublication) return activeRepository

  const publishVersion: AdminQuestionPublicationCommandRepository['publishVersion'] =
    async (authority, versionId, request) => {
      let target: VersionTargetRow | null
      let aggregateVersions: LifecycleVersionTargetRow[]
      let previousCurrent: LifecycleVersionTargetRow | null
      let latestApprover: EvidenceAccountSnapshot | null
      try {
        target = await loadVersionTarget(client, versionId)
        if (!target) {
          throw repositoryFailure(
            'RESOURCE_NOT_FOUND',
            '문제 버전을 찾을 수 없습니다.'
          )
        }
        if (target.questionRowVersion !== request.expectedQuestionRowVersion) {
          throw repositoryFailure(
            'VERSION_CONFLICT',
            '다른 요청이 먼저 문제를 변경했습니다.'
          )
        }
        if (target.versionRowVersion !== request.expectedRowVersion) {
          throw repositoryFailure(
            'VERSION_CONFLICT',
            '다른 요청이 먼저 버전을 변경했습니다.'
          )
        }
        if (
          target.questionLifecycleStatus !== 'ACTIVE' ||
          target.versionStatus !== 'APPROVED'
        ) {
          throw repositoryFailure(
            'INVALID_STATE_TRANSITION',
            '승인된 활성 문제 버전만 게시할 수 있습니다.'
          )
        }
        const author = toAuthorSnapshot({
          createdByUserId: target.versionCreatedByUserId,
          createdByActorId: target.versionCreatedByActorId,
          createdByRoleSnapshot: target.versionCreatedByRoleSnapshot,
          createdByLabelSnapshot: target.versionCreatedByLabelSnapshot
        })
        latestApprover = toLatestApproverSnapshot(target)
        if (!author || !latestApprover) {
          throw repositoryFailure(
            'INVALID_STATE_TRANSITION',
            '게시 대상에는 작성자와 최신 승인 증거가 필요합니다.'
          )
        }
        if (author.actorId === latestApprover.actorId) {
          throw repositoryFailure(
            'SEPARATION_OF_DUTIES_VIOLATION',
            '작성자와 최신 승인자는 서로 달라야 합니다.'
          )
        }
        aggregateVersions = await loadLifecycleVersions(
          client,
          target.questionId
        )
        const targetManifestVersion = aggregateVersions.find(
          (version) => version.id === versionId
        )
        const currentPublishedVersionId =
          target.questionCurrentPublishedVersionId
        previousCurrent = currentPublishedVersionId
          ? (aggregateVersions.find(
              (version) => version.id === currentPublishedVersionId
            ) ?? null)
          : null
        if (
          !targetManifestVersion ||
          targetManifestVersion.status !== 'APPROVED' ||
          (currentPublishedVersionId !== null &&
            (!previousCurrent || previousCurrent.status !== 'PUBLISHED')) ||
          aggregateVersions.some(
            (version) =>
              version.id !== versionId &&
              version.id !== currentPublishedVersionId
          )
        ) {
          throw repositoryFailure(
            'INVALID_STATE_TRANSITION',
            '게시 대상과 현재 공개 버전 구성이 유효하지 않습니다.'
          )
        }
        if (
          await hasCrossQuestionFingerprintDuplicate(
            client,
            target.questionId,
            target.contentFingerprint
          )
        ) {
          throw repositoryFailure(
            'DUPLICATE_QUESTION_CONTENT',
            '동일한 내용의 문제가 이미 존재합니다.'
          )
        }
      } catch (error: unknown) {
        throw mapPreflightError(error)
      }

      try {
        const occurredAt = await client.$transaction(
          async (transaction) => {
            const operation = await beginAndArm(transaction, {
              auditEnvironment,
              authority,
              command: 'PUBLICATION',
              referencedUserIds: uniqueSorted([
                authority.actorId,
                target.questionCreatedByUserId,
                ...aggregateVersions.map((version) => version.createdByUserId),
                latestApprover.userId
              ]),
              targetManifest: {
                questions: [
                  {
                    id: target.questionId,
                    rowVersion: target.questionRowVersion,
                    state: target.questionLifecycleStatus
                  }
                ],
                versions: aggregateVersions.map((version) => ({
                  id: version.id,
                  rowVersion: version.rowVersion,
                  state: version.status
                })),
                reports: [],
                tags: []
              }
            })
            if (
              await hasCrossQuestionFingerprintDuplicate(
                transaction,
                target.questionId,
                target.contentFingerprint
              )
            ) {
              throw duplicateRaceFailure(
                new Error('Publication duplicate appeared after preflight.')
              )
            }
            if (previousCurrent) {
              await transaction.$executeRawUnsafe(
                `UPDATE "Question"
                 SET "currentPublishedVersionId" = NULL, "updatedAt" = $2
                 WHERE "id" = $1`,
                target.questionId,
                operation.occurredAt
              )
              await transaction.$executeRawUnsafe(
                `UPDATE "QuestionVersion"
                 SET "status" = 'RETIRED',
                     "retirementKind" = 'PUBLISHED_RETIREMENT',
                     "retiredAt" = $2, "rowVersion" = $3, "updatedAt" = $2
                 WHERE "id" = $1`,
                previousCurrent.id,
                operation.occurredAt,
                previousCurrent.rowVersion + 1
              )
            }
            await transaction.$executeRawUnsafe(
              `UPDATE "QuestionVersion"
               SET "status" = 'PUBLISHED', "publishedAt" = $2,
                   "retiredAt" = NULL, "retirementKind" = NULL,
                   "rowVersion" = $3, "updatedAt" = $2
               WHERE "id" = $1`,
              versionId,
              operation.occurredAt,
              target.versionRowVersion + 1
            )
            await transaction.$executeRawUnsafe(
              `UPDATE "Question"
               SET "currentPublishedVersionId" = $2,
                   "rowVersion" = $3, "updatedAt" = $4
               WHERE "id" = $1`,
              target.questionId,
              versionId,
              target.questionRowVersion + 1,
              operation.occurredAt
            )
            if (previousCurrent) {
              await insertReview(transaction, {
                action: 'RETIRED',
                actorId: authority.actorId,
                comment: null,
                counterpart: null,
                fromState: 'PUBLISHED',
                occurredAt: operation.occurredAt,
                operationId: operation.operationId,
                questionId: target.questionId,
                reason: 'PUBLISHED_REPLACEMENT',
                requestId: authority.requestId,
                toState: 'RETIRED',
                versionId: previousCurrent.id
              })
            }
            await insertReview(transaction, {
              action: 'PUBLISHED',
              actorId: authority.actorId,
              comment: null,
              counterpart: latestApprover,
              fromState: 'APPROVED',
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              questionId: target.questionId,
              reason: null,
              requestId: authority.requestId,
              toState: 'PUBLISHED',
              versionId
            })
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: target.versionRowVersion + 1,
              afterState: 'PUBLISHED',
              beforeRowVersion: target.versionRowVersion,
              beforeState: 'APPROVED',
              changedFields: ['VERSION_STATUS', 'CURRENT_PUBLISHED_VERSION_ID'],
              command: 'PUBLICATION',
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: versionId,
              targetType: 'QUESTION_VERSION'
            })
            await finishOperation(transaction, operation.operationId)
            return operation.occurredAt
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        )
        return toResult({
          questionId: target.questionId,
          versionId,
          questionRowVersion: target.questionRowVersion + 1,
          versionRowVersion: target.versionRowVersion + 1,
          versionStatus: 'PUBLISHED',
          occurredAt
        })
      } catch (error: unknown) {
        const authorityFailure = await classifyAuthorityFailure(
          client,
          'publishQuestionVersion',
          authority,
          error
        )
        if (authorityFailure) throw authorityFailure
        const mapped = mapTransactionError('publishQuestionVersion', error)
        if (isSerializationFailure(error)) {
          try {
            const current = await loadVersionTarget(client, versionId)
            const currentAggregate = current
              ? await loadLifecycleVersions(client, current.questionId)
              : []
            const oldCurrent = previousCurrent
              ? currentAggregate.find(
                  (version) => version.id === previousCurrent.id
                )
              : undefined
            if (
              !current ||
              current.questionRowVersion !== target.questionRowVersion ||
              current.questionCurrentPublishedVersionId !==
                target.questionCurrentPublishedVersionId ||
              current.versionRowVersion !== target.versionRowVersion ||
              current.versionStatus !== target.versionStatus ||
              (previousCurrent !== null &&
                (!oldCurrent ||
                  oldCurrent.rowVersion !== previousCurrent.rowVersion ||
                  oldCurrent.status !== previousCurrent.status))
            ) {
              throw postRollbackVersionConflict(error)
            }
            if (
              await hasCrossQuestionFingerprintDuplicate(
                client,
                target.questionId,
                target.contentFingerprint
              )
            ) {
              throw duplicateRaceFailure(error)
            }
          } catch (postcheckError: unknown) {
            if (postcheckError instanceof AdminQuestionCommandRepositoryError) {
              throw postcheckError
            }
          }
        }
        throw mapped
      }
    }

  const retireVersion: AdminQuestionPublicationCommandRepository['retireVersion'] =
    async (authority, versionId, request) => {
      let target: VersionTargetRow | null
      try {
        target = await loadVersionTarget(client, versionId)
        if (!target) {
          throw repositoryFailure(
            'RESOURCE_NOT_FOUND',
            '문제 버전을 찾을 수 없습니다.'
          )
        }
        if (target.questionRowVersion !== request.expectedQuestionRowVersion) {
          throw repositoryFailure(
            'VERSION_CONFLICT',
            '다른 요청이 먼저 문제를 변경했습니다.'
          )
        }
        if (target.versionRowVersion !== request.expectedRowVersion) {
          throw repositoryFailure(
            'VERSION_CONFLICT',
            '다른 요청이 먼저 버전을 변경했습니다.'
          )
        }
        if (
          target.questionLifecycleStatus !== 'ACTIVE' ||
          target.versionStatus !== 'PUBLISHED' ||
          target.questionCurrentPublishedVersionId !== versionId
        ) {
          throw repositoryFailure(
            'INVALID_STATE_TRANSITION',
            '현재 공개 중인 활성 문제 버전만 단독 폐기할 수 있습니다.'
          )
        }
      } catch (error: unknown) {
        throw mapPreflightError(error)
      }

      try {
        const occurredAt = await client.$transaction(
          async (transaction) => {
            const operation = await beginAndArm(transaction, {
              auditEnvironment,
              authority,
              command: 'RETIREMENT',
              referencedUserIds: uniqueSorted([
                authority.actorId,
                target.questionCreatedByUserId,
                target.versionCreatedByUserId
              ]),
              targetManifest: {
                questions: [
                  {
                    id: target.questionId,
                    rowVersion: target.questionRowVersion,
                    state: target.questionLifecycleStatus
                  }
                ],
                versions: [
                  {
                    id: versionId,
                    rowVersion: target.versionRowVersion,
                    state: target.versionStatus
                  }
                ],
                reports: [],
                tags: []
              }
            })
            await transaction.$executeRawUnsafe(
              `UPDATE "Question"
               SET "currentPublishedVersionId" = NULL,
                   "rowVersion" = $2, "updatedAt" = $3
               WHERE "id" = $1`,
              target.questionId,
              target.questionRowVersion + 1,
              operation.occurredAt
            )
            await transaction.$executeRawUnsafe(
              `UPDATE "QuestionVersion"
               SET "status" = 'RETIRED',
                   "retirementKind" = 'PUBLISHED_RETIREMENT',
                   "retiredAt" = $2, "rowVersion" = $3, "updatedAt" = $2
               WHERE "id" = $1`,
              versionId,
              operation.occurredAt,
              target.versionRowVersion + 1
            )
            await insertReview(transaction, {
              action: 'RETIRED',
              actorId: authority.actorId,
              comment: null,
              counterpart: null,
              fromState: 'PUBLISHED',
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              questionId: target.questionId,
              reason: 'PUBLISHED_RETIREMENT',
              requestId: authority.requestId,
              toState: 'RETIRED',
              versionId
            })
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: target.versionRowVersion + 1,
              afterState: 'RETIRED',
              beforeRowVersion: target.versionRowVersion,
              beforeState: 'PUBLISHED',
              changedFields: ['VERSION_STATUS', 'CURRENT_PUBLISHED_VERSION_ID'],
              command: 'RETIREMENT',
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: versionId,
              targetType: 'QUESTION_VERSION'
            })
            await finishOperation(transaction, operation.operationId)
            return operation.occurredAt
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        )
        return toResult({
          questionId: target.questionId,
          versionId,
          questionRowVersion: target.questionRowVersion + 1,
          versionRowVersion: target.versionRowVersion + 1,
          versionStatus: 'RETIRED',
          occurredAt
        })
      } catch (error: unknown) {
        const authorityFailure = await classifyAuthorityFailure(
          client,
          'retireQuestionVersion',
          authority,
          error
        )
        if (authorityFailure) throw authorityFailure
        throw mapTransactionError('retireQuestionVersion', error)
      }
    }

  const archiveQuestion: AdminQuestionPublicationCommandRepository['archiveQuestion'] =
    async (authority, questionId, request) => {
      let target: QuestionTargetRow | null
      let aggregateVersions: LifecycleVersionTargetRow[]
      let current: LifecycleVersionTargetRow | null
      let candidate: LifecycleVersionTargetRow | null
      let candidateAuthor: EvidenceAccountSnapshot | null
      try {
        target = await loadQuestionTarget(client, questionId)
        if (!target) {
          throw repositoryFailure(
            'RESOURCE_NOT_FOUND',
            '관리자 문제를 찾을 수 없습니다.'
          )
        }
        if (target.rowVersion !== request.expectedQuestionRowVersion) {
          throw repositoryFailure(
            'VERSION_CONFLICT',
            '다른 요청이 먼저 문제를 변경했습니다.'
          )
        }
        aggregateVersions = await loadLifecycleVersions(client, questionId)
        const currentPublishedVersionId = target.currentPublishedVersionId
        current = currentPublishedVersionId
          ? (aggregateVersions.find(
              (version) => version.id === currentPublishedVersionId
            ) ?? null)
          : null
        const candidates = aggregateVersions.filter((version) =>
          ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'].includes(
            version.status
          )
        )
        candidate = candidates.length === 1 ? candidates[0]! : null
        if (
          candidates.length > 1 ||
          candidate?.id !==
            (request.expectedOpenCandidateVersionId ?? undefined) ||
          candidate?.rowVersion !==
            (request.expectedOpenCandidateRowVersion ?? undefined)
        ) {
          throw repositoryFailure(
            'VERSION_CONFLICT',
            '열린 후보 버전 구성이 변경되었습니다.'
          )
        }
        if (
          target.lifecycleStatus !== 'ACTIVE' ||
          (target.currentPublishedVersionId !== null &&
            (!current || current.status !== 'PUBLISHED'))
        ) {
          throw repositoryFailure(
            'INVALID_STATE_TRANSITION',
            '활성 문제만 현재 공개·후보 버전과 함께 보관할 수 있습니다.'
          )
        }
        candidateAuthor = candidate ? toAuthorSnapshot(candidate) : null
        if (candidate && !candidateAuthor) {
          throw repositoryFailure(
            'INVALID_STATE_TRANSITION',
            '열린 후보 버전에는 작성자 증거가 필요합니다.'
          )
        }
      } catch (error: unknown) {
        throw mapPreflightError(error)
      }

      try {
        const occurredAt = await client.$transaction(
          async (transaction) => {
            const operation = await beginAndArm(transaction, {
              auditEnvironment,
              authority,
              command: 'QUESTION_ARCHIVE',
              referencedUserIds: uniqueSorted([
                authority.actorId,
                target.createdByUserId,
                ...aggregateVersions.map((version) => version.createdByUserId)
              ]),
              targetManifest: {
                questions: [
                  {
                    id: questionId,
                    rowVersion: target.rowVersion,
                    state: target.lifecycleStatus
                  }
                ],
                versions: aggregateVersions.map((version) => ({
                  id: version.id,
                  rowVersion: version.rowVersion,
                  state: version.status
                })),
                reports: [],
                tags: []
              }
            })
            if (current) {
              await transaction.$executeRawUnsafe(
                `UPDATE "QuestionVersion"
                 SET "status" = 'RETIRED',
                     "retirementKind" = 'PUBLISHED_RETIREMENT',
                     "retiredAt" = $2, "rowVersion" = $3, "updatedAt" = $2
                 WHERE "id" = $1`,
                current.id,
                operation.occurredAt,
                current.rowVersion + 1
              )
            }
            if (candidate) {
              await transaction.$executeRawUnsafe(
                `UPDATE "QuestionVersion"
                 SET "status" = 'RETIRED',
                     "retirementKind" = 'QUESTION_ARCHIVE_ABANDONED',
                     "retiredAt" = $2, "rowVersion" = $3, "updatedAt" = $2
                 WHERE "id" = $1`,
                candidate.id,
                operation.occurredAt,
                candidate.rowVersion + 1
              )
            }
            await transaction.$executeRawUnsafe(
              `UPDATE "Question"
               SET "currentPublishedVersionId" = NULL,
                   "lifecycleStatus" = 'ARCHIVED', "archivedAt" = $2,
                   "rowVersion" = $3, "updatedAt" = $2
               WHERE "id" = $1`,
              questionId,
              operation.occurredAt,
              target.rowVersion + 1
            )
            if (current) {
              await insertReview(transaction, {
                action: 'RETIRED',
                actorId: authority.actorId,
                comment: null,
                counterpart: null,
                fromState: 'PUBLISHED',
                occurredAt: operation.occurredAt,
                operationId: operation.operationId,
                questionId,
                reason: 'QUESTION_ARCHIVE',
                requestId: authority.requestId,
                toState: 'RETIRED',
                versionId: current.id
              })
            }
            if (candidate) {
              await insertReview(transaction, {
                action: 'ARCHIVE_ABANDONED',
                actorId: authority.actorId,
                comment: null,
                counterpart: candidateAuthor,
                fromState: candidate.status,
                occurredAt: operation.occurredAt,
                operationId: operation.operationId,
                questionId,
                reason: 'QUESTION_ARCHIVE',
                requestId: authority.requestId,
                toState: 'RETIRED',
                versionId: candidate.id
              })
            }
            const changedFields = ['LIFECYCLE_STATUS']
            if (current || candidate) changedFields.push('VERSION_STATUS')
            if (current) changedFields.push('CURRENT_PUBLISHED_VERSION_ID')
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: target.rowVersion + 1,
              afterState: 'ARCHIVED',
              beforeRowVersion: target.rowVersion,
              beforeState: 'ACTIVE',
              changedFields,
              command: 'QUESTION_ARCHIVE',
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: questionId,
              targetType: 'QUESTION',
              metadata: {
                kind: 'QUESTION_ARCHIVE_V1',
                retiredPublishedCount: current ? 1 : 0,
                abandonedCandidateCount: candidate ? 1 : 0
              }
            })
            await finishOperation(transaction, operation.operationId)
            return operation.occurredAt
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        )
        return toArchiveResult({
          occurredAt,
          questionId,
          questionRowVersion: target.rowVersion + 1
        })
      } catch (error: unknown) {
        const authorityFailure = await classifyAuthorityFailure(
          client,
          'archiveAdminQuestion',
          authority,
          error
        )
        if (authorityFailure) throw authorityFailure
        throw mapTransactionError('archiveAdminQuestion', error)
      }
    }

  return {
    ...activeRepository,
    publishVersion,
    retireVersion,
    archiveQuestion
  }
}

export const createPrismaAdminQuestionCommandRepository = (
  options: AdminQuestionCommandRepositoryOptions
): AdminQuestionCommandRepository =>
  createPrismaAdminQuestionCommandRepositoryInternal(
    options,
    false
  ) as AdminQuestionCommandRepository

export const createPreparedAdminQuestionCommandRepository = (
  options: AdminQuestionCommandRepositoryOptions
): AdminQuestionPreparedCommandRepository =>
  createPrismaAdminQuestionCommandRepositoryInternal(
    options,
    true
  ) as AdminQuestionPreparedCommandRepository
