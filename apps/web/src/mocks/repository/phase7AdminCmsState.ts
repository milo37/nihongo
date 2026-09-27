import {
  adminAuditLogItemSchema,
  adminContentReviewItemSchema,
  adminQuestionMutationResultSchema,
  compareAdminTags,
  compareUnicodeScalars,
  createAdminAuditContentDigestPreimage,
  createPhase7QuestionDuplicateIdentity,
  normalizePhase7TagKey,
  type AccountActorSnapshot,
  type AdminAuditLogItem,
  type AdminContentReviewItem,
  type AdminQuestionMutationResult,
  type AdminTagSummary,
  type ApproveQuestionVersionRequest,
  type ArchiveAdminQuestionRequest,
  type CreateAdminQuestionRequest,
  type CreateAdminQuestionVersionRequest,
  type Phase7ExecutionDisposition,
  type Phase7InternalFailureReason,
  type PublishQuestionVersionRequest,
  type QuestionVersionStatus,
  type RetirementKind,
  type RequestContentReviewRequest,
  type RequestQuestionChangesRequest,
  type RetireQuestionVersionRequest,
  type UpdateQuestionVersionRequest,
  type WithdrawQuestionApprovalRequest
} from '@nihongo/contracts/admin/phase7'
import type { StableErrorCode } from '@nihongo/contracts/common/error'
import {
  comparePublicQuestionTags,
  getQuestionResponseSchema,
  type GetQuestionResponse
} from '@nihongo/contracts/question/get-question'
import {
  getContractQuestionId,
  getQuestionVersionFingerprint,
  toContractPracticeQuestion
} from '@mocks/adapters/questionContractAdapter'
import type { MockCanonicalAdminQuestionSource } from '@mocks/repository/mockDatabase'
import { toPracticeQuestion } from '@util/question'

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
const VERSION_CREATE_CHANGED_FIELDS = [
  'VERSION_STATUS',
  ...CREATE_CHANGED_FIELDS.filter((field) => field !== 'LIFECYCLE_STATUS')
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
const FIVE_MINUTES_MS = 5 * 60 * 1000

const clone = <Value>(value: Value): Value => structuredClone(value)

export class MockPhase7AdminCommandError extends Error {
  readonly code: StableErrorCode
  readonly disposition: Phase7ExecutionDisposition
  readonly fieldErrors: Record<string, string[]> | undefined
  readonly internalReason: Phase7InternalFailureReason | undefined
  readonly retryAfterSeconds: number | undefined

  constructor(input: {
    code: StableErrorCode
    message: string
    disposition?: Phase7ExecutionDisposition
    fieldErrors?: Record<string, string[]>
    internalReason?: Phase7InternalFailureReason
    retryAfterSeconds?: number
  }) {
    super(input.message)
    this.name = 'MockPhase7AdminCommandError'
    this.code = input.code
    this.disposition = input.disposition ?? 'NO_TX'
    this.fieldErrors = input.fieldErrors
    this.internalReason = input.internalReason
    this.retryAfterSeconds = input.retryAfterSeconds
  }
}

export interface MockPhase7AdminOption {
  readonly id: string
  readonly ordinal: number
  readonly text: string
}

export interface MockPhase7AdminVersion {
  readonly questionVersionId: string
  readonly questionId: string
  readonly versionNumber: number
  readonly versionStatus: QuestionVersionStatus
  readonly retirementKind: RetirementKind | null
  readonly rowVersion: number
  readonly provenance: 'SYSTEM_SEED' | 'ADMIN_AUTHORED'
  readonly level: CreateAdminQuestionRequest['level']
  readonly subject: CreateAdminQuestionRequest['subject']
  readonly questionType: CreateAdminQuestionRequest['questionType']
  readonly difficulty: CreateAdminQuestionRequest['difficulty']
  readonly questionText: string
  readonly passage: string | null
  readonly explanationKo: string
  readonly explanationJa: string | null
  readonly options: readonly MockPhase7AdminOption[]
  readonly correctOptionId: string
  readonly tags: readonly AdminTagSummary[]
  readonly author: AccountActorSnapshot | null
  readonly latestReviewer: AccountActorSnapshot | null
  readonly publishedAt: string | null
  readonly retiredAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface MockPhase7AdminQuestion {
  readonly questionId: string
  readonly lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  readonly rowVersion: number
  readonly currentPublishedVersionId: string | null
  readonly openCandidateVersionId: string | null
  readonly archivedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface MockPhase7AdminCmsSnapshot {
  readonly auditLogs: readonly AdminAuditLogItem[]
  readonly questions: readonly MockPhase7AdminQuestion[]
  readonly reviews: readonly AdminContentReviewItem[]
  readonly versions: readonly MockPhase7AdminVersion[]
}

export interface MockPhase7LearnerPins {
  readonly bookmarkedQuestionIds: readonly string[]
  readonly studyResultQuestionVersionIds: readonly string[]
  readonly studySessionQuestionVersionIds: readonly string[]
  readonly wrongNotes: readonly {
    readonly currentReviewQuestionVersionId: string | null
    readonly lastWrongQuestionVersionId: string
    readonly questionId: string
  }[]
}

export interface MockPhase7LearnerReviewedQuestion {
  readonly correctOptionId: string
  readonly explanationJa: string | null
  readonly explanationKo: string
  readonly question: GetQuestionResponse
}

export interface MockPhase7LearnerProjection {
  readonly bookmarks: readonly {
    readonly availability: 'ARCHIVED' | 'AVAILABLE'
    readonly question: GetQuestionResponse
    readonly questionId: string
    readonly summaryVersionId: string
  }[]
  readonly practiceCandidates: readonly GetQuestionResponse[]
  readonly publicQuestions: readonly GetQuestionResponse[]
  readonly studyResultQuestions: readonly MockPhase7LearnerReviewedQuestion[]
  readonly studySessionQuestions: readonly GetQuestionResponse[]
  readonly wrongNotes: readonly {
    readonly currentReviewQuestionVersionId: string | null
    readonly lastWrongQuestion: MockPhase7LearnerReviewedQuestion
    readonly questionId: string
    readonly reviewAvailability: 'ARCHIVED' | 'AVAILABLE'
    readonly reviewCandidate: GetQuestionResponse | null
  }[]
}

export type MockPhase7ActiveAdminCmsState = Pick<
  MockPhase7AdminCmsState,
  | 'createQuestion'
  | 'createVersion'
  | 'hasFreshAssurance'
  | 'reauthenticate'
  | 'transitionVersion'
  | 'updateVersion'
>

export const createMockPhase7ActiveAdminCmsState = (
  state: MockPhase7AdminCmsState
): MockPhase7ActiveAdminCmsState => ({
  createQuestion: state.createQuestion.bind(state),
  createVersion: state.createVersion.bind(state),
  hasFreshAssurance: state.hasFreshAssurance.bind(state),
  reauthenticate: state.reauthenticate.bind(state),
  transitionVersion: state.transitionVersion.bind(state),
  updateVersion: state.updateVersion.bind(state)
})

type MutableQuestion = {
  -readonly [Key in keyof MockPhase7AdminQuestion]: MockPhase7AdminQuestion[Key]
}
type MutableVersion = {
  -readonly [Key in keyof MockPhase7AdminVersion]: MockPhase7AdminVersion[Key]
}
type TransitionOperation =
  | 'requestContentReview'
  | 'requestQuestionChanges'
  | 'approveQuestionVersion'
  | 'withdrawQuestionApproval'
type TransitionRequest =
  | RequestContentReviewRequest
  | RequestQuestionChangesRequest
  | ApproveQuestionVersionRequest
  | WithdrawQuestionApprovalRequest

interface TransitionConfig {
  readonly action:
    | 'REQUESTED'
    | 'CHANGES_REQUESTED'
    | 'APPROVED'
    | 'APPROVAL_WITHDRAWN'
  readonly authorOnly: boolean
  readonly command:
    | 'REVIEW_REQUEST'
    | 'CHANGE_REQUEST'
    | 'APPROVAL'
    | 'APPROVAL_WITHDRAWAL'
  readonly fromStates: readonly QuestionVersionStatus[]
  readonly toState: 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED'
}

const transitionConfigByOperation: Readonly<
  Record<TransitionOperation, TransitionConfig>
> = {
  requestContentReview: {
    action: 'REQUESTED',
    authorOnly: true,
    command: 'REVIEW_REQUEST',
    fromStates: ['DRAFT', 'CHANGES_REQUESTED'],
    toState: 'IN_REVIEW'
  },
  requestQuestionChanges: {
    action: 'CHANGES_REQUESTED',
    authorOnly: false,
    command: 'CHANGE_REQUEST',
    fromStates: ['IN_REVIEW'],
    toState: 'CHANGES_REQUESTED'
  },
  approveQuestionVersion: {
    action: 'APPROVED',
    authorOnly: false,
    command: 'APPROVAL',
    fromStates: ['IN_REVIEW'],
    toState: 'APPROVED'
  },
  withdrawQuestionApproval: {
    action: 'APPROVAL_WITHDRAWN',
    authorOnly: false,
    command: 'APPROVAL_WITHDRAWAL',
    fromStates: ['APPROVED'],
    toState: 'CHANGES_REQUESTED'
  }
}

const accountActor = (actorId: string): AccountActorSnapshot => ({
  kind: 'ACCOUNT',
  actorId,
  role: 'ADMIN',
  label: 'ACTIVE_ADMIN'
})

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const sha256Utf8 = async (value: string): Promise<string> =>
  toHex(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    )
  )

const toDuplicateIdentity = (version: MockPhase7AdminVersion): string => {
  const correctOption = version.options.find(
    (option) => option.id === version.correctOptionId
  )
  if (!correctOption) {
    throw new Error('Canonical mock version correct option is unavailable.')
  }
  return createPhase7QuestionDuplicateIdentity({
    correctOptionText: correctOption.text,
    optionTexts: version.options.map((option) => option.text),
    passage: version.passage,
    questionText: version.questionText,
    questionType: version.questionType,
    subject: version.subject
  })
}

const toRequestDuplicateIdentity = (
  content: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
): string => {
  const correctOptionText =
    'correctOptionKey' in content
      ? (content.options.find(
          (option) => option.clientOptionKey === content.correctOptionKey
        )?.text ?? '')
      : (content.options.find((option) => option.id === content.correctOptionId)
          ?.text ?? '')
  return createPhase7QuestionDuplicateIdentity({
    correctOptionText,
    optionTexts: content.options.map((option) => option.text),
    passage: content.passage,
    questionText: content.questionText,
    questionType: content.questionType,
    subject: content.subject
  })
}

const toMutationResult = (input: {
  occurredAt: string
  question: MockPhase7AdminQuestion
  version: MockPhase7AdminVersion
}): AdminQuestionMutationResult =>
  adminQuestionMutationResultSchema.parse({
    questionId: input.question.questionId,
    questionVersionId: input.version.questionVersionId,
    lifecycleStatus: input.question.lifecycleStatus,
    versionStatus: input.version.versionStatus,
    questionRowVersion: input.question.rowVersion,
    versionRowVersion: input.version.rowVersion,
    occurredAt: input.occurredAt
  })

const toArchiveMutationResult = (input: {
  occurredAt: string
  question: MockPhase7AdminQuestion
}): AdminQuestionMutationResult =>
  adminQuestionMutationResultSchema.parse({
    questionId: input.question.questionId,
    questionVersionId: null,
    lifecycleStatus: input.question.lifecycleStatus,
    versionStatus: null,
    questionRowVersion: input.question.rowVersion,
    versionRowVersion: null,
    occurredAt: input.occurredAt
  })

const toPublicQuestion = (
  version: MockPhase7AdminVersion
): GetQuestionResponse =>
  getQuestionResponseSchema.parse({
    id: version.questionId,
    questionVersionId: version.questionVersionId,
    level: version.level,
    subject: version.subject,
    questionType: version.questionType,
    passage: version.passage,
    questionText: version.questionText,
    options: version.options
      .toSorted((left, right) => left.ordinal - right.ordinal)
      .map((option) => ({
        id: option.id,
        label: String(option.ordinal),
        text: option.text
      })),
    difficulty: version.difficulty,
    tags: version.tags
      .map((tag) => ({ id: tag.id, label: tag.label }))
      .toSorted(comparePublicQuestionTags)
  })

const toReviewedQuestion = (
  version: MockPhase7AdminVersion
): MockPhase7LearnerReviewedQuestion => ({
  correctOptionId: version.correctOptionId,
  explanationJa: version.explanationJa,
  explanationKo: version.explanationKo,
  question: toPublicQuestion(version)
})

const createAudit = async (
  input: Omit<AdminAuditLogItem, 'contentDigest' | 'id'>
): Promise<AdminAuditLogItem> => {
  const unsigned: AdminAuditLogItem = {
    ...input,
    id: crypto.randomUUID(),
    contentDigest: '0'.repeat(64)
  }
  const contentDigest = await sha256Utf8(
    createAdminAuditContentDigestPreimage(unsigned)
  )
  return adminAuditLogItemSchema.parse({ ...unsigned, contentDigest })
}

const createSeedVersion = (
  source: MockCanonicalAdminQuestionSource
): MockPhase7AdminVersion => {
  const fingerprint = getQuestionVersionFingerprint(source.question)
  const publicQuestion = toContractPracticeQuestion(
    toPracticeQuestion(source.question),
    fingerprint
  )
  const correctIndex = source.question.options.findIndex(
    (option) => option.isCorrect
  )
  const correctOption = publicQuestion.options[correctIndex]
  if (
    correctIndex < 0 ||
    source.question.options.filter((option) => option.isCorrect).length !== 1 ||
    !correctOption
  ) {
    throw new Error('Canonical admin seed requires exactly one correct option.')
  }
  return {
    questionVersionId: publicQuestion.questionVersionId,
    questionId: publicQuestion.id,
    versionNumber: 1,
    versionStatus: 'PUBLISHED',
    retirementKind: null,
    rowVersion: 1,
    provenance: 'SYSTEM_SEED',
    level: publicQuestion.level,
    subject: publicQuestion.subject,
    questionType: publicQuestion.questionType,
    difficulty: publicQuestion.difficulty,
    questionText: publicQuestion.questionText,
    passage: publicQuestion.passage,
    explanationKo: source.question.explanationKo,
    explanationJa: source.question.explanationJa,
    options: publicQuestion.options.map((option, index) => ({
      id: option.id,
      ordinal: index + 1,
      text: option.text
    })),
    correctOptionId: correctOption.id,
    tags: publicQuestion.tags
      .map((tag) => ({
        ...tag,
        normalizedName: normalizePhase7TagKey(tag.label)
      }))
      .toSorted(compareAdminTags),
    author: null,
    latestReviewer: null,
    publishedAt: source.question.createdAt,
    retiredAt: null,
    createdAt: source.question.createdAt,
    updatedAt: source.question.updatedAt
  }
}

export class MockPhase7AdminCmsState {
  private auditLogs: AdminAuditLogItem[] = []
  private lifecycleControlledQuestionIds = new Set<string>()
  private mutationTail: Promise<void> = Promise.resolve()
  private pendingMutationCount = 0
  private questionById = new Map<string, MockPhase7AdminQuestion>()
  private reviews: AdminContentReviewItem[] = []
  private sessionIssuedAtByActorId = new Map<string, string>()
  private successfulMutationRevision = 0
  private versionById = new Map<string, MockPhase7AdminVersion>()

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly auditEnvironment: AdminAuditLogItem['environment'] = 'TEST'
  ) {}

  reset(): void {
    this.auditLogs = []
    this.lifecycleControlledQuestionIds.clear()
    this.mutationTail = Promise.resolve()
    this.pendingMutationCount = 0
    this.questionById.clear()
    this.reviews = []
    this.sessionIssuedAtByActorId.clear()
    this.successfulMutationRevision = 0
    this.versionById.clear()
  }

  startSession(actorId: string, issuedAt?: string): void {
    this.sessionIssuedAtByActorId.set(actorId, issuedAt ?? this.now())
  }

  endSession(actorId: string): void {
    this.sessionIssuedAtByActorId.delete(actorId)
  }

  hasFreshAssurance(actorId: string, now?: number): boolean {
    const issuedAt = this.sessionIssuedAtByActorId.get(actorId)
    return (
      issuedAt !== undefined &&
      Date.parse(issuedAt) + FIVE_MINUTES_MS > (now ?? Date.parse(this.now()))
    )
  }

  snapshot(
    sources: readonly MockCanonicalAdminQuestionSource[]
  ): MockPhase7AdminCmsSnapshot {
    this.synchronizeSeeds(sources)
    return clone({
      auditLogs: this.auditLogs,
      questions: [...this.questionById.values()],
      reviews: this.reviews,
      versions: [...this.versionById.values()]
    })
  }

  createQuestion(input: {
    actorId: string
    assertAuthority: () => void
    request: CreateAdminQuestionRequest
    requestId: string
    sources: readonly MockCanonicalAdminQuestionSource[]
  }): Promise<AdminQuestionMutationResult> {
    this.synchronizeSeeds(input.sources)
    const duplicateWasVisible = this.hasCrossQuestionDuplicate(
      toRequestDuplicateIdentity(input.request)
    )
    return this.runExclusive(async ({ hasConcurrentPredecessor }) => {
      this.synchronizeSeeds(input.sources)
      const tags = this.resolveTags(input.sources, input.request)
      const occurredAt = this.now()
      const question: MutableQuestion = {
        questionId: crypto.randomUUID(),
        lifecycleStatus: 'ACTIVE',
        rowVersion: 1,
        currentPublishedVersionId: null,
        openCandidateVersionId: null,
        archivedAt: null,
        createdAt: occurredAt,
        updatedAt: occurredAt
      }
      const version = this.createVersionContent({
        actorId: input.actorId,
        content: input.request,
        occurredAt,
        questionId: question.questionId,
        tags,
        versionNumber: 1
      })
      question.openCandidateVersionId = version.questionVersionId
      this.assertNoCrossQuestionDuplicate(
        version,
        !duplicateWasVisible && hasConcurrentPredecessor
      )
      const operationId = crypto.randomUUID()
      const audit = await createAudit({
        command: 'QUESTION_CREATE',
        targetType: 'QUESTION',
        targetId: question.questionId,
        actor: accountActor(input.actorId),
        beforeState: null,
        afterState: 'ACTIVE',
        beforeRowVersion: null,
        afterRowVersion: 1,
        changedFields: [...CREATE_CHANGED_FIELDS],
        metadata: { kind: 'NONE_V1' },
        operationId,
        requestId: input.requestId,
        environment: this.auditEnvironment,
        occurredAt
      })
      input.assertAuthority()
      this.questionById.set(question.questionId, question)
      this.versionById.set(version.questionVersionId, version)
      this.auditLogs.push(audit)
      return toMutationResult({ occurredAt, question, version })
    })
  }

  createVersion(input: {
    actorId: string
    assertAuthority: () => void
    questionId: string
    request: CreateAdminQuestionVersionRequest
    requestId: string
    sources: readonly MockCanonicalAdminQuestionSource[]
  }): Promise<AdminQuestionMutationResult> {
    this.synchronizeSeeds(input.sources)
    const duplicateWasVisible = this.hasCrossQuestionDuplicate(
      toRequestDuplicateIdentity(input.request),
      input.questionId
    )
    return this.runExclusive(async ({ hasConcurrentPredecessor }) => {
      this.synchronizeSeeds(input.sources)
      const current = this.questionById.get(input.questionId)
      if (!current) {
        throw new MockPhase7AdminCommandError({
          code: 'RESOURCE_NOT_FOUND',
          message: '관리자 문제를 찾을 수 없습니다.'
        })
      }
      if (current.rowVersion !== input.request.expectedQuestionRowVersion) {
        throw new MockPhase7AdminCommandError({
          code: 'VERSION_CONFLICT',
          message: '다른 요청이 먼저 문제를 변경했습니다.'
        })
      }
      if (
        current.lifecycleStatus !== 'ACTIVE' ||
        current.openCandidateVersionId !== null
      ) {
        throw new MockPhase7AdminCommandError({
          code: 'INVALID_STATE_TRANSITION',
          message: '현재 문제 상태에서는 새 버전을 만들 수 없습니다.'
        })
      }
      const tags = this.resolveTags(input.sources, input.request)
      const occurredAt = this.now()
      const question: MutableQuestion = {
        ...current,
        rowVersion: current.rowVersion + 1,
        updatedAt: occurredAt
      }
      const maximumVersionNumber = Math.max(
        0,
        ...[...this.versionById.values()]
          .filter((version) => version.questionId === input.questionId)
          .map((version) => version.versionNumber)
      )
      const version = this.createVersionContent({
        actorId: input.actorId,
        content: input.request,
        occurredAt,
        questionId: input.questionId,
        tags,
        versionNumber: maximumVersionNumber + 1
      })
      question.openCandidateVersionId = version.questionVersionId
      this.assertNoCrossQuestionDuplicate(
        version,
        !duplicateWasVisible && hasConcurrentPredecessor
      )
      const operationId = crypto.randomUUID()
      const audit = await createAudit({
        command: 'QUESTION_VERSION_CREATE',
        targetType: 'QUESTION_VERSION',
        targetId: version.questionVersionId,
        actor: accountActor(input.actorId),
        beforeState: null,
        afterState: 'DRAFT',
        beforeRowVersion: null,
        afterRowVersion: 1,
        changedFields: [...VERSION_CREATE_CHANGED_FIELDS],
        metadata: { kind: 'NONE_V1' },
        operationId,
        requestId: input.requestId,
        environment: this.auditEnvironment,
        occurredAt
      })
      input.assertAuthority()
      this.questionById.set(question.questionId, question)
      this.versionById.set(version.questionVersionId, version)
      this.auditLogs.push(audit)
      return toMutationResult({ occurredAt, question, version })
    })
  }

  updateVersion(input: {
    actorId: string
    assertAuthority: () => void
    request: UpdateQuestionVersionRequest
    requestId: string
    sources: readonly MockCanonicalAdminQuestionSource[]
    versionId: string
  }): Promise<AdminQuestionMutationResult> {
    this.synchronizeSeeds(input.sources)
    const submissionVersion = this.versionById.get(input.versionId)
    const duplicateWasVisible = this.hasCrossQuestionDuplicate(
      toRequestDuplicateIdentity(input.request),
      submissionVersion?.questionId
    )
    return this.runExclusive(async ({ hasConcurrentPredecessor }) => {
      this.synchronizeSeeds(input.sources)
      const current = this.versionById.get(input.versionId)
      if (!current) {
        throw new MockPhase7AdminCommandError({
          code: 'RESOURCE_NOT_FOUND',
          message: '문제 버전을 찾을 수 없습니다.'
        })
      }
      if (current.author?.actorId !== input.actorId) {
        throw new MockPhase7AdminCommandError({
          code: 'FORBIDDEN',
          message: '작성자만 문제 버전을 수정할 수 있습니다.'
        })
      }
      if (current.rowVersion !== input.request.expectedRowVersion) {
        throw new MockPhase7AdminCommandError({
          code: 'VERSION_CONFLICT',
          message:
            '다른 요청이 먼저 변경했습니다. 최신 상태를 다시 불러와 주세요.'
        })
      }
      const question = this.questionById.get(current.questionId)
      if (!question || question.lifecycleStatus !== 'ACTIVE') {
        throw new MockPhase7AdminCommandError({
          code: 'INVALID_STATE_TRANSITION',
          message: '보관된 문제의 버전은 수정할 수 없습니다.'
        })
      }
      if (!['DRAFT', 'CHANGES_REQUESTED'].includes(current.versionStatus)) {
        throw new MockPhase7AdminCommandError({
          code: 'QUESTION_VERSION_IMMUTABLE',
          message: '검수 또는 학습에 사용된 문제 버전은 수정할 수 없습니다.'
        })
      }
      const existingIds = new Set(current.options.map((option) => option.id))
      const requestedIds = new Set(
        input.request.options.map((option) => option.id)
      )
      if (
        existingIds.size !== 4 ||
        requestedIds.size !== 4 ||
        [...existingIds].some((id) => !requestedIds.has(id))
      ) {
        throw new MockPhase7AdminCommandError({
          code: 'VALIDATION_ERROR',
          message: '기존 보기 ID 네 개를 모두 유지해야 합니다.',
          fieldErrors: {
            options: ['option ID 집합은 기존 문제 버전과 정확히 같아야 합니다.']
          }
        })
      }
      const tags = this.resolveTags(input.sources, input.request)
      const changedFields = this.computeUpdateChangedFields(
        current,
        input.request,
        tags
      )
      const occurredAt = this.now()
      const version: MutableVersion = {
        ...current,
        level: input.request.level,
        subject: input.request.subject,
        questionType: input.request.questionType,
        difficulty: input.request.difficulty,
        questionText: input.request.questionText,
        passage: input.request.passage,
        explanationKo: input.request.explanationKo,
        explanationJa: input.request.explanationJa,
        options: input.request.options
          .map((option) => ({
            id: option.id,
            ordinal: option.ordinal,
            text: option.text
          }))
          .toSorted((left, right) => left.ordinal - right.ordinal),
        correctOptionId: input.request.correctOptionId,
        tags,
        rowVersion: current.rowVersion + 1,
        updatedAt: occurredAt
      }
      this.assertNoCrossQuestionDuplicate(
        version,
        !duplicateWasVisible && hasConcurrentPredecessor
      )
      const operationId = crypto.randomUUID()
      const audit = await createAudit({
        command: 'QUESTION_VERSION_UPDATE',
        targetType: 'QUESTION_VERSION',
        targetId: version.questionVersionId,
        actor: accountActor(input.actorId),
        beforeState: current.versionStatus,
        afterState: current.versionStatus,
        beforeRowVersion: current.rowVersion,
        afterRowVersion: version.rowVersion,
        changedFields,
        metadata: { kind: 'NONE_V1' },
        operationId,
        requestId: input.requestId,
        environment: this.auditEnvironment,
        occurredAt
      })
      input.assertAuthority()
      this.versionById.set(version.questionVersionId, version)
      this.auditLogs.push(audit)
      return toMutationResult({ occurredAt, question, version })
    })
  }

  transitionVersion(input: {
    actorId: string
    assertAuthority: () => void
    operation: TransitionOperation
    request: TransitionRequest
    requestId: string
    sources: readonly MockCanonicalAdminQuestionSource[]
    versionId: string
  }): Promise<AdminQuestionMutationResult> {
    return this.runExclusive(async () => {
      this.synchronizeSeeds(input.sources)
      const current = this.versionById.get(input.versionId)
      if (!current) {
        throw new MockPhase7AdminCommandError({
          code: 'RESOURCE_NOT_FOUND',
          message: '문제 버전을 찾을 수 없습니다.'
        })
      }
      const config = transitionConfigByOperation[input.operation]
      if (config.authorOnly && current.author?.actorId !== input.actorId) {
        throw new MockPhase7AdminCommandError({
          code: 'FORBIDDEN',
          message: '작성자만 검수를 요청할 수 있습니다.'
        })
      }
      if (current.rowVersion !== input.request.expectedRowVersion) {
        throw new MockPhase7AdminCommandError({
          code: 'VERSION_CONFLICT',
          message:
            '다른 요청이 먼저 변경했습니다. 최신 상태를 다시 불러와 주세요.'
        })
      }
      const question = this.questionById.get(current.questionId)
      if (!question || question.lifecycleStatus !== 'ACTIVE') {
        throw new MockPhase7AdminCommandError({
          code: 'INVALID_STATE_TRANSITION',
          message: '보관된 문제에서는 검수 상태를 변경할 수 없습니다.'
        })
      }
      if (!config.fromStates.includes(current.versionStatus)) {
        throw new MockPhase7AdminCommandError({
          code: 'INVALID_STATE_TRANSITION',
          message: '현재 버전 상태에서는 요청한 검수 전이를 수행할 수 없습니다.'
        })
      }
      if (!config.authorOnly && current.author?.actorId === input.actorId) {
        throw new MockPhase7AdminCommandError({
          code: 'SEPARATION_OF_DUTIES_VIOLATION',
          message: '작성자와 검수자는 서로 달라야 합니다.'
        })
      }
      if (!current.author) {
        throw new MockPhase7AdminCommandError({
          code: 'INVALID_STATE_TRANSITION',
          message: '시스템 seed 버전은 이 검수 명령의 대상이 아닙니다.'
        })
      }
      const occurredAt = this.now()
      const actor = accountActor(input.actorId)
      const operationId = crypto.randomUUID()
      const review = adminContentReviewItemSchema.parse({
        id: crypto.randomUUID(),
        questionId: current.questionId,
        questionVersionId: current.questionVersionId,
        action: config.action,
        fromState: current.versionStatus,
        toState: config.toState,
        actor,
        counterpart: config.authorOnly ? null : current.author,
        reason: 'reason' in input.request ? input.request.reason : null,
        comment: input.request.comment ?? null,
        operationId,
        requestId: input.requestId,
        occurredAt
      })
      const latestDecision = config.authorOnly
        ? undefined
        : [...this.reviews, review]
            .filter(
              (candidate) =>
                candidate.questionVersionId === current.questionVersionId &&
                candidate.action !== 'REQUESTED'
            )
            .toSorted(
              (left, right) =>
                compareUnicodeScalars(right.occurredAt, left.occurredAt) ||
                compareUnicodeScalars(right.id, left.id)
            )[0]
      const version: MutableVersion = {
        ...current,
        versionStatus: config.toState,
        latestReviewer: config.authorOnly
          ? current.latestReviewer
          : latestDecision?.actor.kind === 'ACCOUNT'
            ? latestDecision.actor
            : actor,
        rowVersion: current.rowVersion + 1,
        updatedAt: occurredAt
      }
      const audit = await createAudit({
        command: config.command,
        targetType: 'QUESTION_VERSION',
        targetId: current.questionVersionId,
        actor,
        beforeState: current.versionStatus,
        afterState: config.toState,
        beforeRowVersion: current.rowVersion,
        afterRowVersion: version.rowVersion,
        changedFields: ['VERSION_STATUS'],
        metadata: { kind: 'NONE_V1' },
        operationId,
        requestId: input.requestId,
        environment: this.auditEnvironment,
        occurredAt
      })
      input.assertAuthority()
      this.versionById.set(version.questionVersionId, version)
      this.reviews.push(review)
      this.auditLogs.push(audit)
      return toMutationResult({ occurredAt, question, version })
    })
  }

  publishQuestionVersion(input: {
    actorId: string
    assertAuthority: () => void
    request: PublishQuestionVersionRequest
    requestId: string
    sources: readonly MockCanonicalAdminQuestionSource[]
    versionId: string
  }): Promise<AdminQuestionMutationResult> {
    this.synchronizeSeeds(input.sources)
    const submitted = this.versionById.get(input.versionId)
    const duplicateWasVisible = submitted
      ? this.hasCrossQuestionDuplicate(
          toDuplicateIdentity(submitted),
          submitted.questionId
        )
      : false

    return this.runExclusive(async ({ hasConcurrentPredecessor }) => {
      this.synchronizeSeeds(input.sources)
      const current = this.versionById.get(input.versionId)
      if (!current) {
        throw new MockPhase7AdminCommandError({
          code: 'RESOURCE_NOT_FOUND',
          message: '문제 버전을 찾을 수 없습니다.'
        })
      }
      const questionCurrent = this.questionById.get(current.questionId)
      if (!questionCurrent) {
        throw new MockPhase7AdminCommandError({
          code: 'RESOURCE_NOT_FOUND',
          message: '관리자 문제를 찾을 수 없습니다.'
        })
      }
      const conflictDisposition = hasConcurrentPredecessor
        ? 'DEFINITE_ROLLBACK'
        : undefined
      if (
        questionCurrent.rowVersion !== input.request.expectedQuestionRowVersion
      ) {
        throw new MockPhase7AdminCommandError({
          code: 'VERSION_CONFLICT',
          message: '다른 요청이 먼저 문제를 변경했습니다.',
          ...(conflictDisposition ? { disposition: conflictDisposition } : {})
        })
      }
      if (current.rowVersion !== input.request.expectedRowVersion) {
        throw new MockPhase7AdminCommandError({
          code: 'VERSION_CONFLICT',
          message: '다른 요청이 먼저 버전을 변경했습니다.',
          ...(conflictDisposition ? { disposition: conflictDisposition } : {})
        })
      }
      if (
        questionCurrent.lifecycleStatus !== 'ACTIVE' ||
        questionCurrent.openCandidateVersionId !== input.versionId ||
        current.versionStatus !== 'APPROVED'
      ) {
        throw new MockPhase7AdminCommandError({
          code: 'INVALID_STATE_TRANSITION',
          message: '승인된 활성 문제 버전만 게시할 수 있습니다.'
        })
      }
      if (!current.author) {
        throw new MockPhase7AdminCommandError({
          code: 'INVALID_STATE_TRANSITION',
          message: '게시 대상에는 작성자와 최신 승인 증거가 필요합니다.'
        })
      }
      const latestApproval = this.reviews
        .filter(
          (review) =>
            review.questionVersionId === input.versionId &&
            review.action === 'APPROVED'
        )
        .toSorted(
          (left, right) =>
            compareUnicodeScalars(right.occurredAt, left.occurredAt) ||
            compareUnicodeScalars(right.id, left.id)
        )[0]
      if (!latestApproval || latestApproval.actor.kind !== 'ACCOUNT') {
        throw new MockPhase7AdminCommandError({
          code: 'INVALID_STATE_TRANSITION',
          message: '게시 대상에는 작성자와 최신 승인 증거가 필요합니다.'
        })
      }
      if (latestApproval.actor.actorId === current.author.actorId) {
        throw new MockPhase7AdminCommandError({
          code: 'SEPARATION_OF_DUTIES_VIOLATION',
          message: '작성자와 최신 승인자는 서로 달라야 합니다.'
        })
      }
      const previousCurrentId = questionCurrent.currentPublishedVersionId
      const previousCurrent = previousCurrentId
        ? this.versionById.get(previousCurrentId)
        : undefined
      if (
        previousCurrentId !== null &&
        (!previousCurrent ||
          previousCurrent.questionId !== questionCurrent.questionId ||
          previousCurrent.versionStatus !== 'PUBLISHED')
      ) {
        throw new MockPhase7AdminCommandError({
          code: 'INVALID_STATE_TRANSITION',
          message: '현재 공개 버전 포인터가 올바르지 않습니다.'
        })
      }
      this.assertNoCrossQuestionDuplicate(
        current,
        !duplicateWasVisible && hasConcurrentPredecessor
      )

      const occurredAt = this.now()
      const operationId = crypto.randomUUID()
      const actor = accountActor(input.actorId)
      const question: MutableQuestion = {
        ...questionCurrent,
        currentPublishedVersionId: input.versionId,
        openCandidateVersionId: null,
        rowVersion: questionCurrent.rowVersion + 1,
        updatedAt: occurredAt
      }
      const published: MutableVersion = {
        ...current,
        versionStatus: 'PUBLISHED',
        retirementKind: null,
        publishedAt: occurredAt,
        retiredAt: null,
        rowVersion: current.rowVersion + 1,
        updatedAt: occurredAt
      }
      const retired: MutableVersion | undefined = previousCurrent
        ? {
            ...previousCurrent,
            versionStatus: 'RETIRED',
            retirementKind: 'PUBLISHED_RETIREMENT',
            retiredAt: occurredAt,
            rowVersion: previousCurrent.rowVersion + 1,
            updatedAt: occurredAt
          }
        : undefined
      const retiredReview = retired
        ? adminContentReviewItemSchema.parse({
            id: crypto.randomUUID(),
            questionId: retired.questionId,
            questionVersionId: retired.questionVersionId,
            action: 'RETIRED',
            fromState: 'PUBLISHED',
            toState: 'RETIRED',
            actor,
            counterpart: null,
            reason: 'PUBLISHED_REPLACEMENT',
            comment: null,
            operationId,
            requestId: input.requestId,
            occurredAt
          })
        : undefined
      const publishedReview = adminContentReviewItemSchema.parse({
        id: crypto.randomUUID(),
        questionId: published.questionId,
        questionVersionId: published.questionVersionId,
        action: 'PUBLISHED',
        fromState: 'APPROVED',
        toState: 'PUBLISHED',
        actor,
        counterpart: latestApproval.actor,
        reason: null,
        comment: null,
        operationId,
        requestId: input.requestId,
        occurredAt
      })
      const audit = await createAudit({
        command: 'PUBLICATION',
        targetType: 'QUESTION_VERSION',
        targetId: published.questionVersionId,
        actor,
        beforeState: 'APPROVED',
        afterState: 'PUBLISHED',
        beforeRowVersion: current.rowVersion,
        afterRowVersion: published.rowVersion,
        changedFields: ['VERSION_STATUS', 'CURRENT_PUBLISHED_VERSION_ID'],
        metadata: { kind: 'NONE_V1' },
        operationId,
        requestId: input.requestId,
        environment: this.auditEnvironment,
        occurredAt
      })

      input.assertAuthority()
      this.questionById.set(question.questionId, question)
      if (retired) {
        this.versionById.set(retired.questionVersionId, retired)
      }
      this.versionById.set(published.questionVersionId, published)
      if (retiredReview) this.reviews.push(retiredReview)
      this.reviews.push(publishedReview)
      this.auditLogs.push(audit)
      this.lifecycleControlledQuestionIds.add(question.questionId)
      return toMutationResult({ occurredAt, question, version: published })
    })
  }

  retireQuestionVersion(input: {
    actorId: string
    assertAuthority: () => void
    request: RetireQuestionVersionRequest
    requestId: string
    sources: readonly MockCanonicalAdminQuestionSource[]
    versionId: string
  }): Promise<AdminQuestionMutationResult> {
    return this.runExclusive(async ({ hasConcurrentPredecessor }) => {
      this.synchronizeSeeds(input.sources)
      const current = this.versionById.get(input.versionId)
      if (!current) {
        throw new MockPhase7AdminCommandError({
          code: 'RESOURCE_NOT_FOUND',
          message: '문제 버전을 찾을 수 없습니다.'
        })
      }
      const questionCurrent = this.questionById.get(current.questionId)
      if (!questionCurrent) {
        throw new MockPhase7AdminCommandError({
          code: 'RESOURCE_NOT_FOUND',
          message: '관리자 문제를 찾을 수 없습니다.'
        })
      }
      const conflictDisposition = hasConcurrentPredecessor
        ? 'DEFINITE_ROLLBACK'
        : undefined
      if (
        questionCurrent.rowVersion !== input.request.expectedQuestionRowVersion
      ) {
        throw new MockPhase7AdminCommandError({
          code: 'VERSION_CONFLICT',
          message: '다른 요청이 먼저 문제를 변경했습니다.',
          ...(conflictDisposition ? { disposition: conflictDisposition } : {})
        })
      }
      if (current.rowVersion !== input.request.expectedRowVersion) {
        throw new MockPhase7AdminCommandError({
          code: 'VERSION_CONFLICT',
          message: '다른 요청이 먼저 버전을 변경했습니다.',
          ...(conflictDisposition ? { disposition: conflictDisposition } : {})
        })
      }
      if (
        questionCurrent.lifecycleStatus !== 'ACTIVE' ||
        questionCurrent.currentPublishedVersionId !== input.versionId ||
        current.versionStatus !== 'PUBLISHED'
      ) {
        throw new MockPhase7AdminCommandError({
          code: 'INVALID_STATE_TRANSITION',
          message: '현재 공개 중인 활성 문제 버전만 단독 폐기할 수 있습니다.'
        })
      }

      const occurredAt = this.now()
      const operationId = crypto.randomUUID()
      const actor = accountActor(input.actorId)
      const question: MutableQuestion = {
        ...questionCurrent,
        currentPublishedVersionId: null,
        rowVersion: questionCurrent.rowVersion + 1,
        updatedAt: occurredAt
      }
      const retired: MutableVersion = {
        ...current,
        versionStatus: 'RETIRED',
        retirementKind: 'PUBLISHED_RETIREMENT',
        retiredAt: occurredAt,
        rowVersion: current.rowVersion + 1,
        updatedAt: occurredAt
      }
      const review = adminContentReviewItemSchema.parse({
        id: crypto.randomUUID(),
        questionId: retired.questionId,
        questionVersionId: retired.questionVersionId,
        action: 'RETIRED',
        fromState: 'PUBLISHED',
        toState: 'RETIRED',
        actor,
        counterpart: null,
        reason: 'PUBLISHED_RETIREMENT',
        comment: null,
        operationId,
        requestId: input.requestId,
        occurredAt
      })
      const audit = await createAudit({
        command: 'RETIREMENT',
        targetType: 'QUESTION_VERSION',
        targetId: retired.questionVersionId,
        actor,
        beforeState: 'PUBLISHED',
        afterState: 'RETIRED',
        beforeRowVersion: current.rowVersion,
        afterRowVersion: retired.rowVersion,
        changedFields: ['VERSION_STATUS', 'CURRENT_PUBLISHED_VERSION_ID'],
        metadata: { kind: 'NONE_V1' },
        operationId,
        requestId: input.requestId,
        environment: this.auditEnvironment,
        occurredAt
      })

      input.assertAuthority()
      this.questionById.set(question.questionId, question)
      this.versionById.set(retired.questionVersionId, retired)
      this.reviews.push(review)
      this.auditLogs.push(audit)
      this.lifecycleControlledQuestionIds.add(question.questionId)
      return toMutationResult({ occurredAt, question, version: retired })
    })
  }

  archiveAdminQuestion(input: {
    actorId: string
    assertAuthority: () => void
    questionId: string
    request: ArchiveAdminQuestionRequest
    requestId: string
    sources: readonly MockCanonicalAdminQuestionSource[]
  }): Promise<AdminQuestionMutationResult> {
    return this.runExclusive(async ({ hasConcurrentPredecessor }) => {
      this.synchronizeSeeds(input.sources)
      const questionCurrent = this.questionById.get(input.questionId)
      if (!questionCurrent) {
        throw new MockPhase7AdminCommandError({
          code: 'RESOURCE_NOT_FOUND',
          message: '관리자 문제를 찾을 수 없습니다.'
        })
      }
      const conflictDisposition = hasConcurrentPredecessor
        ? 'DEFINITE_ROLLBACK'
        : undefined
      if (
        questionCurrent.rowVersion !== input.request.expectedQuestionRowVersion
      ) {
        throw new MockPhase7AdminCommandError({
          code: 'VERSION_CONFLICT',
          message: '다른 요청이 먼저 문제를 변경했습니다.',
          ...(conflictDisposition ? { disposition: conflictDisposition } : {})
        })
      }
      if (
        questionCurrent.openCandidateVersionId !==
        input.request.expectedOpenCandidateVersionId
      ) {
        throw new MockPhase7AdminCommandError({
          code: 'VERSION_CONFLICT',
          message: '열린 후보 버전 구성이 변경되었습니다.',
          ...(conflictDisposition ? { disposition: conflictDisposition } : {})
        })
      }
      const candidate = questionCurrent.openCandidateVersionId
        ? this.versionById.get(questionCurrent.openCandidateVersionId)
        : undefined
      if (
        candidate &&
        candidate.rowVersion !== input.request.expectedOpenCandidateRowVersion
      ) {
        throw new MockPhase7AdminCommandError({
          code: 'VERSION_CONFLICT',
          message: '다른 요청이 먼저 후보 버전을 변경했습니다.',
          ...(conflictDisposition ? { disposition: conflictDisposition } : {})
        })
      }
      const current = questionCurrent.currentPublishedVersionId
        ? this.versionById.get(questionCurrent.currentPublishedVersionId)
        : undefined
      if (
        questionCurrent.lifecycleStatus !== 'ACTIVE' ||
        (questionCurrent.currentPublishedVersionId !== null &&
          (!current ||
            current.questionId !== questionCurrent.questionId ||
            current.versionStatus !== 'PUBLISHED')) ||
        (questionCurrent.openCandidateVersionId !== null &&
          (!candidate ||
            candidate.questionId !== questionCurrent.questionId ||
            !['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'].includes(
              candidate.versionStatus
            )))
      ) {
        throw new MockPhase7AdminCommandError({
          code: 'INVALID_STATE_TRANSITION',
          message: '활성 문제만 현재 공개·후보 버전과 함께 보관할 수 있습니다.'
        })
      }
      if (candidate && !candidate.author) {
        throw new MockPhase7AdminCommandError({
          code: 'INVALID_STATE_TRANSITION',
          message: '열린 후보 버전에는 작성자 증거가 필요합니다.'
        })
      }

      const occurredAt = this.now()
      const operationId = crypto.randomUUID()
      const actor = accountActor(input.actorId)
      const question: MutableQuestion = {
        ...questionCurrent,
        lifecycleStatus: 'ARCHIVED',
        currentPublishedVersionId: null,
        openCandidateVersionId: null,
        archivedAt: occurredAt,
        rowVersion: questionCurrent.rowVersion + 1,
        updatedAt: occurredAt
      }
      const retiredCurrent: MutableVersion | undefined = current
        ? {
            ...current,
            versionStatus: 'RETIRED',
            retirementKind: 'PUBLISHED_RETIREMENT',
            retiredAt: occurredAt,
            rowVersion: current.rowVersion + 1,
            updatedAt: occurredAt
          }
        : undefined
      const abandonedCandidate: MutableVersion | undefined = candidate
        ? {
            ...candidate,
            versionStatus: 'RETIRED',
            retirementKind: 'QUESTION_ARCHIVE_ABANDONED',
            retiredAt: occurredAt,
            rowVersion: candidate.rowVersion + 1,
            updatedAt: occurredAt
          }
        : undefined
      const currentReview = retiredCurrent
        ? adminContentReviewItemSchema.parse({
            id: crypto.randomUUID(),
            questionId: retiredCurrent.questionId,
            questionVersionId: retiredCurrent.questionVersionId,
            action: 'RETIRED',
            fromState: 'PUBLISHED',
            toState: 'RETIRED',
            actor,
            counterpart: null,
            reason: 'QUESTION_ARCHIVE',
            comment: null,
            operationId,
            requestId: input.requestId,
            occurredAt
          })
        : undefined
      const candidateReview = abandonedCandidate
        ? adminContentReviewItemSchema.parse({
            id: crypto.randomUUID(),
            questionId: abandonedCandidate.questionId,
            questionVersionId: abandonedCandidate.questionVersionId,
            action: 'ARCHIVE_ABANDONED',
            fromState: candidate!.versionStatus,
            toState: 'RETIRED',
            actor,
            counterpart: candidate!.author,
            reason: 'QUESTION_ARCHIVE',
            comment: null,
            operationId,
            requestId: input.requestId,
            occurredAt
          })
        : undefined
      const changedFields: AdminAuditLogItem['changedFields'] = [
        'LIFECYCLE_STATUS'
      ]
      if (retiredCurrent || abandonedCandidate) {
        changedFields.push('VERSION_STATUS')
      }
      if (retiredCurrent) changedFields.push('CURRENT_PUBLISHED_VERSION_ID')
      const audit = await createAudit({
        command: 'QUESTION_ARCHIVE',
        targetType: 'QUESTION',
        targetId: question.questionId,
        actor,
        beforeState: 'ACTIVE',
        afterState: 'ARCHIVED',
        beforeRowVersion: questionCurrent.rowVersion,
        afterRowVersion: question.rowVersion,
        changedFields,
        metadata: {
          kind: 'QUESTION_ARCHIVE_V1',
          retiredPublishedCount: retiredCurrent ? 1 : 0,
          abandonedCandidateCount: abandonedCandidate ? 1 : 0
        },
        operationId,
        requestId: input.requestId,
        environment: this.auditEnvironment,
        occurredAt
      })

      input.assertAuthority()
      this.questionById.set(question.questionId, question)
      if (retiredCurrent) {
        this.versionById.set(retiredCurrent.questionVersionId, retiredCurrent)
      }
      if (abandonedCandidate) {
        this.versionById.set(
          abandonedCandidate.questionVersionId,
          abandonedCandidate
        )
      }
      if (currentReview) this.reviews.push(currentReview)
      if (candidateReview) this.reviews.push(candidateReview)
      this.auditLogs.push(audit)
      this.lifecycleControlledQuestionIds.add(question.questionId)
      return toArchiveMutationResult({ occurredAt, question })
    })
  }

  getLearnerProjection(
    sources: readonly MockCanonicalAdminQuestionSource[],
    pins: MockPhase7LearnerPins
  ): MockPhase7LearnerProjection {
    this.synchronizeSeeds(sources)
    const publicQuestions = [...this.questionById.values()]
      .flatMap((question) => {
        const current = this.getCurrentPublicVersion(question)
        return current ? [toPublicQuestion(current)] : []
      })
      .toSorted((left, right) => compareUnicodeScalars(left.id, right.id))
    const resolveVersion = (versionId: string): MockPhase7AdminVersion => {
      const version = this.versionById.get(versionId)
      if (!version) {
        throw new Error(`Retained learner version is unavailable: ${versionId}`)
      }
      if (
        version.publishedAt === null ||
        (version.versionStatus !== 'PUBLISHED' &&
          !(
            version.versionStatus === 'RETIRED' &&
            version.retirementKind === 'PUBLISHED_RETIREMENT'
          ))
      ) {
        throw new Error(
          `Learner pin does not reference published lineage: ${versionId}`
        )
      }
      return version
    }
    const bookmarks = pins.bookmarkedQuestionIds
      .map((questionId) => {
        const question = this.questionById.get(questionId)
        if (!question) {
          throw new Error(`Bookmarked Question is unavailable: ${questionId}`)
        }
        const current = this.getCurrentPublicVersion(question)
        const summary =
          current ?? this.getLatestPublishedLineageVersion(question.questionId)
        if (!summary) {
          throw new Error(
            `Bookmarked Question has no safe published summary: ${questionId}`
          )
        }
        return {
          availability: current
            ? ('AVAILABLE' as const)
            : ('ARCHIVED' as const),
          question: toPublicQuestion(summary),
          questionId,
          summaryVersionId: summary.questionVersionId
        }
      })
      .toSorted((left, right) =>
        compareUnicodeScalars(left.questionId, right.questionId)
      )
    const wrongNotes = pins.wrongNotes
      .map((pin) => {
        const question = this.questionById.get(pin.questionId)
        if (!question) {
          throw new Error(
            `WrongNote Question is unavailable: ${pin.questionId}`
          )
        }
        const lastWrong = resolveVersion(pin.lastWrongQuestionVersionId)
        if (lastWrong.questionId !== pin.questionId) {
          throw new Error(
            'WrongNote historical version belongs to another Question.'
          )
        }
        if (pin.currentReviewQuestionVersionId !== null) {
          const currentReview = resolveVersion(
            pin.currentReviewQuestionVersionId
          )
          if (currentReview.questionId !== pin.questionId) {
            throw new Error(
              'WrongNote current review version belongs to another Question.'
            )
          }
        }
        const reviewCandidate = this.getCurrentPublicVersion(question)
        return {
          currentReviewQuestionVersionId: pin.currentReviewQuestionVersionId,
          lastWrongQuestion: toReviewedQuestion(lastWrong),
          questionId: pin.questionId,
          reviewAvailability: reviewCandidate
            ? ('AVAILABLE' as const)
            : ('ARCHIVED' as const),
          reviewCandidate: reviewCandidate
            ? toPublicQuestion(reviewCandidate)
            : null
        }
      })
      .toSorted((left, right) =>
        compareUnicodeScalars(left.questionId, right.questionId)
      )

    return clone({
      bookmarks,
      practiceCandidates: publicQuestions,
      publicQuestions,
      studyResultQuestions: pins.studyResultQuestionVersionIds.map(
        (versionId) => toReviewedQuestion(resolveVersion(versionId))
      ),
      studySessionQuestions: pins.studySessionQuestionVersionIds.map(
        (versionId) => toPublicQuestion(resolveVersion(versionId))
      ),
      wrongNotes
    })
  }

  reauthenticate(input: {
    actorId: string
    assertAuthority: () => void
    requestId: string
  }): Promise<{
    assuranceExpiresAt: string
    reauthenticatedAt: string
  }> {
    return this.runExclusive(async () => {
      const reauthenticatedAt = this.now()
      const operationId = crypto.randomUUID()
      const audit = await createAudit({
        command: 'REAUTHENTICATION',
        targetType: 'ADMIN_SESSION',
        targetId: operationId,
        actor: accountActor(input.actorId),
        beforeState: this.hasFreshAssurance(input.actorId)
          ? 'SESSION_FRESH'
          : 'SESSION_STALE',
        afterState: 'SESSION_FRESH',
        beforeRowVersion: null,
        afterRowVersion: null,
        changedFields: ['SESSION_ROTATION'],
        metadata: {
          kind: 'REAUTHENTICATION_V1',
          rotation: 'OLD_REVOKED_NEW_ISSUED'
        },
        operationId,
        requestId: input.requestId,
        environment: this.auditEnvironment,
        occurredAt: reauthenticatedAt
      })
      input.assertAuthority()
      this.sessionIssuedAtByActorId.set(input.actorId, reauthenticatedAt)
      this.auditLogs.push(audit)
      return {
        reauthenticatedAt,
        assuranceExpiresAt: new Date(
          Date.parse(reauthenticatedAt) + FIVE_MINUTES_MS
        ).toISOString()
      }
    })
  }

  private runExclusive<Result>(
    operation: (context: {
      hasConcurrentPredecessor: boolean
    }) => Promise<Result>
  ): Promise<Result> {
    const queuedBehindAnotherMutation = this.pendingMutationCount > 0
    const observedRevision = this.successfulMutationRevision
    this.pendingMutationCount += 1
    const invoke = async (): Promise<Result> => {
      const result = await operation({
        hasConcurrentPredecessor:
          queuedBehindAnotherMutation &&
          this.successfulMutationRevision !== observedRevision
      })
      this.successfulMutationRevision += 1
      return result
    }
    const result = this.mutationTail.then(invoke, invoke)
    this.mutationTail = result.then(
      () => undefined,
      () => undefined
    )
    void result.then(
      () => {
        this.pendingMutationCount -= 1
      },
      () => {
        this.pendingMutationCount -= 1
      }
    )
    return result
  }

  private getCurrentPublicVersion(
    question: MockPhase7AdminQuestion
  ): MockPhase7AdminVersion | null {
    if (
      question.lifecycleStatus !== 'ACTIVE' ||
      question.currentPublishedVersionId === null
    ) {
      return null
    }
    const version = this.versionById.get(question.currentPublishedVersionId)
    if (
      !version ||
      version.questionId !== question.questionId ||
      version.versionStatus !== 'PUBLISHED'
    ) {
      throw new Error('Canonical public Question pointer is invalid.')
    }
    return version
  }

  private getLatestPublishedLineageVersion(
    questionId: string
  ): MockPhase7AdminVersion | null {
    return (
      [...this.versionById.values()]
        .filter(
          (version) =>
            version.questionId === questionId &&
            version.publishedAt !== null &&
            (version.versionStatus === 'PUBLISHED' ||
              (version.versionStatus === 'RETIRED' &&
                version.retirementKind === 'PUBLISHED_RETIREMENT'))
        )
        .toSorted(
          (left, right) =>
            right.versionNumber - left.versionNumber ||
            compareUnicodeScalars(
              right.questionVersionId,
              left.questionVersionId
            )
        )[0] ?? null
    )
  }

  private synchronizeSeeds(
    sources: readonly MockCanonicalAdminQuestionSource[]
  ): void {
    const sourceQuestionIds = new Set(
      sources.map((source) => getContractQuestionId(source.question.id))
    )

    for (const [questionId, question] of this.questionById) {
      if (this.lifecycleControlledQuestionIds.has(questionId)) continue
      if (sourceQuestionIds.has(questionId)) continue
      const versions = [...this.versionById.values()].filter(
        (version) => version.questionId === questionId
      )
      const seedVersions = versions.filter(
        (version) => version.provenance === 'SYSTEM_SEED'
      )
      if (seedVersions.length === 0) continue
      for (const version of seedVersions) {
        this.versionById.delete(version.questionVersionId)
      }
      const authoredVersions = versions.filter(
        (version) => version.provenance === 'ADMIN_AUTHORED'
      )
      if (authoredVersions.length === 0) {
        this.questionById.delete(questionId)
        continue
      }
      this.questionById.set(questionId, {
        ...question,
        currentPublishedVersionId: null
      })
    }

    for (const source of sources) {
      const questionId = getContractQuestionId(source.question.id)
      if (this.lifecycleControlledQuestionIds.has(questionId)) continue
      const version = createSeedVersion(source)
      const existing = this.questionById.get(questionId)
      for (const candidate of this.versionById.values()) {
        if (
          candidate.questionId === questionId &&
          candidate.provenance === 'SYSTEM_SEED' &&
          candidate.questionVersionId !== version.questionVersionId
        ) {
          this.versionById.delete(candidate.questionVersionId)
        }
      }
      this.versionById.set(version.questionVersionId, version)
      this.questionById.set(
        questionId,
        existing
          ? {
              ...existing,
              currentPublishedVersionId: version.questionVersionId,
              updatedAt:
                existing.openCandidateVersionId === null
                  ? source.question.updatedAt
                  : existing.updatedAt
            }
          : {
              questionId,
              lifecycleStatus: 'ACTIVE',
              rowVersion: 1,
              currentPublishedVersionId: version.questionVersionId,
              openCandidateVersionId: null,
              archivedAt: null,
              createdAt: source.question.createdAt,
              updatedAt: source.question.updatedAt
            }
      )
    }
  }

  private resolveTags(
    sources: readonly MockCanonicalAdminQuestionSource[],
    content: Pick<
      CreateAdminQuestionRequest,
      'level' | 'questionType' | 'subject' | 'tagNames'
    >
  ): AdminTagSummary[] {
    const applicable = new Map<string, AdminTagSummary>()
    for (const source of sources) {
      if (
        source.question.level !== content.level ||
        source.question.subject !== content.subject ||
        source.question.questionType !== content.questionType
      ) {
        continue
      }
      const version = createSeedVersion(source)
      for (const tag of version.tags) applicable.set(tag.normalizedName, tag)
    }
    const tags = content.tagNames.map((name) =>
      applicable.get(normalizePhase7TagKey(name))
    )
    if (tags.some((tag) => tag === undefined)) {
      throw new MockPhase7AdminCommandError({
        code: 'VALIDATION_ERROR',
        message: '문제에 적용할 수 없는 태그가 포함되어 있습니다.',
        fieldErrors: {
          tagNames: ['모든 태그는 존재하며 문제 분류에 적용 가능해야 합니다.']
        }
      })
    }
    return tags
      .filter((tag): tag is AdminTagSummary => tag !== undefined)
      .toSorted(compareAdminTags)
  }

  private createVersionContent(input: {
    actorId: string
    content: CreateAdminQuestionRequest
    occurredAt: string
    questionId: string
    tags: readonly AdminTagSummary[]
    versionNumber: number
  }): MockPhase7AdminVersion {
    const optionIdByKey = new Map(
      input.content.options.map((option) => [
        option.clientOptionKey,
        crypto.randomUUID()
      ])
    )
    const correctOptionId = optionIdByKey.get(input.content.correctOptionKey)
    if (!correctOptionId) {
      throw new Error('Canonical mock correct option key is unavailable.')
    }
    return {
      questionVersionId: crypto.randomUUID(),
      questionId: input.questionId,
      versionNumber: input.versionNumber,
      versionStatus: 'DRAFT',
      retirementKind: null,
      rowVersion: 1,
      provenance: 'ADMIN_AUTHORED',
      level: input.content.level,
      subject: input.content.subject,
      questionType: input.content.questionType,
      difficulty: input.content.difficulty,
      questionText: input.content.questionText,
      passage: input.content.passage,
      explanationKo: input.content.explanationKo,
      explanationJa: input.content.explanationJa,
      options: input.content.options.map((option, index) => ({
        id: optionIdByKey.get(option.clientOptionKey)!,
        ordinal: index + 1,
        text: option.text
      })),
      correctOptionId,
      tags: clone(input.tags),
      author: accountActor(input.actorId),
      latestReviewer: null,
      publishedAt: null,
      retiredAt: null,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt
    }
  }

  private hasCrossQuestionDuplicate(
    identity: string,
    questionId?: string
  ): boolean {
    return [...this.versionById.values()].some(
      (version) =>
        version.questionId !== questionId &&
        toDuplicateIdentity(version) === identity
    )
  }

  private assertNoCrossQuestionDuplicate(
    candidate: MockPhase7AdminVersion,
    concurrentRace = false
  ): void {
    const identity = toDuplicateIdentity(candidate)
    const duplicate = this.hasCrossQuestionDuplicate(
      identity,
      candidate.questionId
    )
    if (duplicate) {
      if (concurrentRace) {
        throw new MockPhase7AdminCommandError({
          code: 'SERVICE_UNAVAILABLE',
          message: '동시 콘텐츠 중복 여부를 안전하게 확정할 수 없습니다.',
          disposition: 'DEFINITE_ROLLBACK',
          internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE'
        })
      }
      throw new MockPhase7AdminCommandError({
        code: 'DUPLICATE_QUESTION_CONTENT',
        message: '동일한 내용의 문제가 이미 존재합니다.'
      })
    }
  }

  private computeUpdateChangedFields(
    current: MockPhase7AdminVersion,
    request: UpdateQuestionVersionRequest,
    tags: readonly AdminTagSummary[]
  ): Array<(typeof UPDATE_CHANGED_FIELD_ORDER)[number]> {
    const changed = new Set<(typeof UPDATE_CHANGED_FIELD_ORDER)[number]>()
    if (current.level !== request.level) changed.add('LEVEL')
    if (current.subject !== request.subject) changed.add('SUBJECT')
    if (current.questionType !== request.questionType)
      changed.add('QUESTION_TYPE')
    if (current.difficulty !== request.difficulty) changed.add('DIFFICULTY')
    if (current.passage !== request.passage) changed.add('PASSAGE')
    if (current.questionText !== request.questionText)
      changed.add('QUESTION_TEXT')
    if (current.explanationKo !== request.explanationKo)
      changed.add('EXPLANATION_KO')
    if (current.explanationJa !== request.explanationJa)
      changed.add('EXPLANATION_JA')
    const existingOptions = [...current.options].toSorted(
      (left, right) => left.ordinal - right.ordinal
    )
    const desiredOptions = request.options.toSorted(
      (left, right) => left.ordinal - right.ordinal
    )
    if (
      existingOptions.some((option, index) => {
        const desired = desiredOptions[index]
        return (
          !desired ||
          option.id !== desired.id ||
          option.ordinal !== desired.ordinal ||
          option.text !== desired.text
        )
      })
    ) {
      changed.add('OPTIONS')
    }
    if (current.correctOptionId !== request.correctOptionId)
      changed.add('CORRECT_OPTION')
    if (
      JSON.stringify(current.tags.map((tag) => tag.id).toSorted()) !==
      JSON.stringify(tags.map((tag) => tag.id).toSorted())
    ) {
      changed.add('TAGS')
    }
    return UPDATE_CHANGED_FIELD_ORDER.filter((field) => changed.has(field))
  }
}
