import {
  accountActorSnapshotSchema,
  adminAuditLogItemSchema,
  adminContentReviewItemSchema,
  adminImportApplyResponseSchema,
  adminImportIssueCodeSchema,
  adminImportValidationResponseSchema,
  adminQuestionContentInputSchema,
  adminQuestionMutationResultSchema,
  adminReviewRequestBatchResultSchema,
  adminTagSummarySchema,
  assertAdminTagList,
  assertAdminQuestionExportDocumentForRequest,
  canonicalizeJson,
  compareAdminTags,
  compareUnicodeScalars,
  createAdminAuditContentDigestPreimage,
  createAdminImportMappingDigest,
  createAdminImportValidationDigest,
  createPhase7QuestionDuplicateIdentity,
  createQuestionReportDescriptionDigest,
  isApplicablePhase7ContentType,
  normalizePhase7OptionComparison,
  normalizePhase7TagKey,
  normalizePhase7Text,
  questionReportDetailSchema,
  questionReportMutationResultSchema,
  type AccountActorSnapshot,
  type AdminAuditLogItem,
  type AdminContentReviewItem,
  type AdminImportApplyResponse,
  type AdminImportItem,
  type AdminImportValidationResponse,
  type AdminQuestionExportDocumentV1,
  type AdminQuestionMutationResult,
  type AdminReviewRequestBatchResult,
  type AdminTagSummary,
  type ApplyQuestionImportRequest,
  type ApproveQuestionVersionRequest,
  type ArchiveAdminQuestionRequest,
  type CreateAdminQuestionRequest,
  type CreateAdminQuestionVersionRequest,
  type CreateQuestionReportRequest,
  type CanonicalJsonValue,
  type ExportAdminQuestionsRequest,
  type Phase7ExecutionDisposition,
  type Phase7InternalFailureReason,
  type PublishQuestionVersionRequest,
  type QuestionReportDetail,
  type QuestionReportMutationResult,
  type QuestionVersionStatus,
  type RequestContentReviewBatchRequest,
  type RetirementKind,
  type RequestContentReviewRequest,
  type RequestQuestionChangesRequest,
  type ResolveAdminQuestionReportRequest,
  type RetireQuestionVersionRequest,
  type Sha256TextPort,
  type TriageAdminQuestionReportRequest,
  type UpdateQuestionVersionRequest,
  type ValidateQuestionImportRequest,
  type WithdrawQuestionApprovalRequest
} from '@nihongo/contracts/admin/phase7'
import { isoDateTimeSchema } from '@nihongo/contracts/common/date'
import type { StableErrorCode } from '@nihongo/contracts/common/error'
import { opaqueIdSchema } from '@nihongo/contracts/common/id'
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
const EXPORT_BODY_CAP = 8 * 1024 * 1024

const clone = <Value>(value: Value): Value => structuredClone(value)

const isCanonicalOpaqueId = (value: unknown): value is string => {
  const parsed = opaqueIdSchema.safeParse(value)
  return parsed.success && parsed.data === value
}

const isCanonicalIsoInstant = (value: unknown): value is string => {
  const parsed = isoDateTimeSchema.safeParse(value)
  return parsed.success && parsed.data === value
}

const hasCanonicalPersistedContent = (
  version: Record<string, unknown>,
  options: unknown,
  tags: unknown
): boolean => {
  if (!Array.isArray(options) || !Array.isArray(tags)) return false
  const optionRecords = options.map((option) =>
    typeof option === 'object' && option !== null
      ? (option as Record<string, unknown>)
      : {}
  )
  const correctIndex = optionRecords.findIndex(
    (option) => option.id === version.correctOptionId
  )
  if (correctIndex < 0) return false

  const parsed = adminQuestionContentInputSchema.safeParse({
    level: version.level,
    subject: version.subject,
    questionType: version.questionType,
    difficulty: version.difficulty,
    questionText: version.questionText,
    passage: version.passage,
    explanationKo: version.explanationKo,
    explanationJa: version.explanationJa,
    tagNames: tags.map((tag) =>
      typeof tag === 'object' && tag !== null
        ? (tag as Record<string, unknown>).label
        : undefined
    ),
    options: optionRecords.map((option, index) => ({
      clientOptionKey: `persisted-option-${index + 1}`,
      text: option.text
    })),
    correctOptionKey: `persisted-option-${correctIndex + 1}`
  })
  if (!parsed.success) return false

  return (
    parsed.data.questionText === version.questionText &&
    parsed.data.passage === version.passage &&
    parsed.data.explanationKo === version.explanationKo &&
    parsed.data.explanationJa === version.explanationJa &&
    parsed.data.options.every(
      (option, index) => option.text === optionRecords[index]?.text
    ) &&
    parsed.data.tagNames.every(
      (tagName, index) =>
        tagName === (tags[index] as Record<string, unknown> | undefined)?.label
    )
  )
}

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
  readonly reports: readonly QuestionReportDetail[]
  readonly reviews: readonly AdminContentReviewItem[]
  readonly versions: readonly MockPhase7AdminVersion[]
}

export interface MockPhase7AdminCmsPersistedState
  extends MockPhase7AdminCmsSnapshot {
  readonly lifecycleControlledQuestionIds: readonly string[]
  readonly mutationRevision?: number
  readonly sessionIssuedAtByActorId: readonly (readonly [string, string])[]
}

export type MockPhase7MutationLease = <Result>(
  operation: () => Promise<Result>
) => Promise<Result>

export interface MockPhase7AdminExportResult {
  readonly auditEvidence: {
    readonly selectionDigest: string
    readonly responseBodyDigest: string
    readonly questionCount: number
    readonly versionCount: number
  }
  readonly canonicalBody: string
  readonly document: AdminQuestionExportDocumentV1
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
  | 'applyQuestionImport'
  | 'archiveAdminQuestion'
  | 'createQuestionReport'
  | 'createQuestion'
  | 'createVersion'
  | 'exportAdminQuestions'
  | 'hasFreshAssurance'
  | 'publishQuestionVersion'
  | 'reauthenticate'
  | 'requestContentReviewBatch'
  | 'resolveQuestionReport'
  | 'retireQuestionVersion'
  | 'transitionVersion'
  | 'triageQuestionReport'
  | 'updateVersion'
  | 'validateQuestionImport'
>

export const createMockPhase7ActiveAdminCmsState = (
  state: MockPhase7AdminCmsState
): MockPhase7ActiveAdminCmsState => ({
  applyQuestionImport: state.applyQuestionImport.bind(state),
  archiveAdminQuestion: state.archiveAdminQuestion.bind(state),
  createQuestionReport: state.createQuestionReport.bind(state),
  createQuestion: state.createQuestion.bind(state),
  createVersion: state.createVersion.bind(state),
  exportAdminQuestions: state.exportAdminQuestions.bind(state),
  hasFreshAssurance: state.hasFreshAssurance.bind(state),
  publishQuestionVersion: state.publishQuestionVersion.bind(state),
  reauthenticate: state.reauthenticate.bind(state),
  requestContentReviewBatch: state.requestContentReviewBatch.bind(state),
  resolveQuestionReport: state.resolveQuestionReport.bind(state),
  retireQuestionVersion: state.retireQuestionVersion.bind(state),
  transitionVersion: state.transitionVersion.bind(state),
  triageQuestionReport: state.triageQuestionReport.bind(state),
  updateVersion: state.updateVersion.bind(state),
  validateQuestionImport: state.validateQuestionImport.bind(state)
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

const reporterActor = (
  actorId: string,
  role: 'USER' | 'ADMIN'
): AccountActorSnapshot => ({
  kind: 'ACCOUNT',
  actorId,
  role,
  label: role === 'ADMIN' ? 'ACTIVE_ADMIN' : 'ACTIVE_USER'
})

type AdminImportValidationIssue =
  AdminImportValidationResponse['errors'][number]

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const sha256Utf8 = async (value: string): Promise<string> =>
  toHex(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    )
  )

const sha256Port: Sha256TextPort = { digestUtf8: sha256Utf8 }

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
  content:
    | CreateAdminQuestionRequest
    | UpdateQuestionVersionRequest
    | AdminImportItem['content']
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

const toQuestionReportMutation = (
  report: QuestionReportDetail
): QuestionReportMutationResult =>
  questionReportMutationResultSchema.parse({
    id: report.id,
    questionId: report.questionId,
    questionVersionId: report.questionVersionId,
    status: report.status,
    rowVersion: report.rowVersion,
    assignee: report.assignee,
    resolution: report.resolution,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt
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
      .map((tag) => {
        const label = normalizePhase7Text(tag.label)
        return {
          ...tag,
          label,
          normalizedName: normalizePhase7TagKey(label)
        }
      })
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
  private reports: QuestionReportDetail[] = []
  private reviews: AdminContentReviewItem[] = []
  private sessionIssuedAtByActorId = new Map<string, string>()
  private successfulMutationRevision = 0
  private versionById = new Map<string, MockPhase7AdminVersion>()

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly auditEnvironment: AdminAuditLogItem['environment'] = 'TEST',
    private readonly persistState?: () => void,
    private readonly synchronizeBeforeMutation?: () => boolean,
    private readonly withMutationLease: MockPhase7MutationLease = async (
      operation
    ) => await operation(),
    private readonly onMutationQueueIdle?: () => void
  ) {}

  reset(): void {
    this.auditLogs = []
    this.lifecycleControlledQuestionIds.clear()
    this.mutationTail = Promise.resolve()
    this.pendingMutationCount = 0
    this.questionById.clear()
    this.reports = []
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
      reports: this.reports,
      reviews: this.reviews,
      versions: [...this.versionById.values()]
    })
  }

  persistedSnapshot(
    sources: readonly MockCanonicalAdminQuestionSource[]
  ): MockPhase7AdminCmsPersistedState {
    const snapshot = this.snapshot(sources)
    return clone({
      ...snapshot,
      lifecycleControlledQuestionIds: [
        ...this.lifecycleControlledQuestionIds
      ].toSorted(compareUnicodeScalars),
      mutationRevision: this.successfulMutationRevision,
      sessionIssuedAtByActorId: [...this.sessionIssuedAtByActorId].toSorted(
        ([left], [right]) => compareUnicodeScalars(left, right)
      )
    })
  }

  restore(
    persisted: MockPhase7AdminCmsPersistedState,
    sources: readonly MockCanonicalAdminQuestionSource[]
  ): void {
    this.restorePersistedState(persisted, true, sources)
  }

  restoreGraph(
    persisted: MockPhase7AdminCmsPersistedState,
    sources: readonly MockCanonicalAdminQuestionSource[]
  ): void {
    const localSessions = new Map(this.sessionIssuedAtByActorId)
    this.restorePersistedState(persisted, true, sources)
    this.mergeGraphSessions(localSessions)
  }

  restoreForMutation(
    persisted: MockPhase7AdminCmsPersistedState,
    sources: readonly MockCanonicalAdminQuestionSource[]
  ): void {
    const localSessions = new Map(this.sessionIssuedAtByActorId)
    this.restorePersistedState(persisted, false, sources)
    this.mergeGraphSessions(localSessions)
  }

  private mergeGraphSessions(localSessions: ReadonlyMap<string, string>): void {
    const incomingSessions = this.sessionIssuedAtByActorId
    this.sessionIssuedAtByActorId = new Map(
      [...localSessions].map(([actorId, localIssuedAt]) => {
        const incomingIssuedAt = incomingSessions.get(actorId)
        if (
          incomingIssuedAt !== undefined &&
          Date.parse(incomingIssuedAt) > Date.parse(localIssuedAt)
        ) {
          return [actorId, incomingIssuedAt] as const
        }
        return [actorId, localIssuedAt] as const
      })
    )
  }

  hasPendingMutations(): boolean {
    return this.pendingMutationCount > 0
  }

  private restorePersistedState(
    persisted: MockPhase7AdminCmsPersistedState,
    resetQueue: boolean,
    sources: readonly MockCanonicalAdminQuestionSource[]
  ): void {
    const auditLogs = persisted.auditLogs.map((item) =>
      adminAuditLogItemSchema.parse(item)
    )
    const reviews = persisted.reviews.map((item) =>
      adminContentReviewItemSchema.parse(item)
    )
    const reports = persisted.reports.map((item) =>
      questionReportDetailSchema.parse(item)
    )
    if (
      !Array.isArray(persisted.questions) ||
      !Array.isArray(persisted.versions) ||
      !Array.isArray(persisted.lifecycleControlledQuestionIds) ||
      !Array.isArray(persisted.sessionIssuedAtByActorId) ||
      (persisted.mutationRevision !== undefined &&
        (!Number.isSafeInteger(persisted.mutationRevision) ||
          persisted.mutationRevision < 0)) ||
      persisted.questions.some(
        (question) => !this.isPersistedQuestion(question)
      ) ||
      persisted.versions.some((version) => !this.isPersistedVersion(version)) ||
      persisted.lifecycleControlledQuestionIds.some(
        (questionId) => !isCanonicalOpaqueId(questionId)
      ) ||
      persisted.sessionIssuedAtByActorId.some(
        (entry) =>
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          !isCanonicalOpaqueId(entry[0]) ||
          !isCanonicalIsoInstant(entry[1])
      )
    ) {
      throw new Error('Persisted Phase 7 CMS state is malformed.')
    }
    const questionById = new Map(
      persisted.questions.map((question) => [
        question.questionId,
        clone(question)
      ])
    )
    const versionById = new Map(
      persisted.versions.map((version) => [
        version.questionVersionId,
        clone(version)
      ])
    )
    const lifecycleControlledQuestionIds = new Set(
      persisted.lifecycleControlledQuestionIds
    )
    const sessionIssuedAtByActorId = new Map<string, string>(
      persisted.sessionIssuedAtByActorId.map(([actorId, issuedAt]) => [
        actorId,
        issuedAt
      ])
    )
    if (
      questionById.size !== persisted.questions.length ||
      versionById.size !== persisted.versions.length ||
      auditLogs.length !== new Set(auditLogs.map((item) => item.id)).size ||
      reviews.length !== new Set(reviews.map((item) => item.id)).size ||
      reports.length !== new Set(reports.map((report) => report.id)).size ||
      lifecycleControlledQuestionIds.size !==
        persisted.lifecycleControlledQuestionIds.length ||
      sessionIssuedAtByActorId.size !==
        persisted.sessionIssuedAtByActorId.length ||
      ![...lifecycleControlledQuestionIds].every((questionId) =>
        questionById.has(questionId)
      ) ||
      [...versionById.values()].some(
        (version) => !questionById.has(version.questionId)
      )
    ) {
      throw new Error('Persisted Phase 7 CMS identity graph is malformed.')
    }
    this.assertPersistedGraph({
      auditLogs,
      questionById,
      reports,
      reviews,
      versionById,
      sources
    })
    this.auditLogs = clone(auditLogs)
    this.lifecycleControlledQuestionIds = lifecycleControlledQuestionIds
    if (resetQueue) {
      this.mutationTail = Promise.resolve()
      this.pendingMutationCount = 0
    }
    this.questionById = questionById
    this.reports = clone(reports)
    this.reviews = clone(reviews)
    this.sessionIssuedAtByActorId = sessionIssuedAtByActorId
    this.successfulMutationRevision = persisted.mutationRevision ?? 0
    this.versionById = versionById
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
      input.assertAuthority()
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
      input.assertAuthority()
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
      input.assertAuthority()
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
      input.assertAuthority()
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

  requestContentReviewBatch(input: {
    actorId: string
    assertAuthority: () => void
    request: RequestContentReviewBatchRequest
    requestId: string
    sources: readonly MockCanonicalAdminQuestionSource[]
  }): Promise<AdminReviewRequestBatchResult> {
    return this.runExclusive(async () => {
      input.assertAuthority()
      this.synchronizeSeeds(input.sources)
      const targets = input.request.items.map((item) => {
        const version = this.versionById.get(item.versionId)
        if (!version) {
          throw new MockPhase7AdminCommandError({
            code: 'RESOURCE_NOT_FOUND',
            message: '일괄 검수 요청 대상 문제 버전을 찾을 수 없습니다.'
          })
        }
        if (version.author?.actorId !== input.actorId) {
          throw new MockPhase7AdminCommandError({
            code: 'FORBIDDEN',
            message: '각 문제 버전의 작성자만 일괄 검수를 요청할 수 있습니다.'
          })
        }
        if (version.rowVersion !== item.expectedRowVersion) {
          throw new MockPhase7AdminCommandError({
            code: 'VERSION_CONFLICT',
            message: '일괄 검수 요청 대상이 다른 요청으로 변경되었습니다.'
          })
        }
        const question = this.questionById.get(version.questionId)
        if (
          !question ||
          question.lifecycleStatus !== 'ACTIVE' ||
          !['DRAFT', 'CHANGES_REQUESTED'].includes(version.versionStatus)
        ) {
          throw new MockPhase7AdminCommandError({
            code: 'INVALID_STATE_TRANSITION',
            message: '현재 상태에서는 일괄 검수를 요청할 수 없습니다.'
          })
        }
        return { item, question, version }
      })
      const occurredAt = this.now()
      const operationId = crypto.randomUUID()
      const actor = accountActor(input.actorId)
      const staged = await Promise.all(
        targets.map(async ({ item, question, version }) => {
          const next: MutableVersion = {
            ...version,
            versionStatus: 'IN_REVIEW',
            rowVersion: version.rowVersion + 1,
            updatedAt: occurredAt
          }
          const review = adminContentReviewItemSchema.parse({
            id: crypto.randomUUID(),
            questionId: version.questionId,
            questionVersionId: version.questionVersionId,
            action: 'REQUESTED',
            fromState: version.versionStatus,
            toState: 'IN_REVIEW',
            actor,
            counterpart: null,
            reason: null,
            comment: item.comment ?? null,
            operationId,
            requestId: input.requestId,
            occurredAt
          })
          const audit = await createAudit({
            command: 'REVIEW_REQUEST',
            targetType: 'QUESTION_VERSION',
            targetId: version.questionVersionId,
            actor,
            beforeState: version.versionStatus,
            afterState: 'IN_REVIEW',
            beforeRowVersion: version.rowVersion,
            afterRowVersion: next.rowVersion,
            changedFields: ['VERSION_STATUS'],
            metadata: { kind: 'NONE_V1' },
            operationId,
            requestId: input.requestId,
            environment: this.auditEnvironment,
            occurredAt
          })
          return {
            audit,
            next,
            question,
            result: toMutationResult({ occurredAt, question, version: next }),
            review
          }
        })
      )
      const batchAudit = await createAudit({
        command: 'REVIEW_REQUEST_BATCH',
        targetType: 'REVIEW_REQUEST_BATCH',
        targetId: operationId,
        actor,
        beforeState: null,
        afterState: null,
        beforeRowVersion: null,
        afterRowVersion: null,
        changedFields: ['VERSION_STATUS'],
        metadata: {
          kind: 'REVIEW_REQUEST_BATCH_V1',
          itemCount: staged.length
        },
        operationId,
        requestId: input.requestId,
        environment: this.auditEnvironment,
        occurredAt
      })
      const result = adminReviewRequestBatchResultSchema.parse({
        items: staged.map(({ result: item }) => item)
      })
      input.assertAuthority()
      staged.forEach(({ audit, next, review }) => {
        this.versionById.set(next.questionVersionId, next)
        this.reviews.push(review)
        this.auditLogs.push(audit)
      })
      this.auditLogs.push(batchAudit)
      return result
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
      input.assertAuthority()
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
      input.assertAuthority()
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
      input.assertAuthority()
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

  async validateQuestionImport(input: {
    request: ValidateQuestionImportRequest
    sources: readonly MockCanonicalAdminQuestionSource[]
  }): Promise<AdminImportValidationResponse> {
    await this.mutationTail
    this.synchronizeSeeds(input.sources)
    return this.collectImportValidation(input.request.items, input.sources)
  }

  async applyQuestionImport(input: {
    actorId: string
    assertAuthority: () => void
    request: ApplyQuestionImportRequest
    requestId: string
    sources: readonly MockCanonicalAdminQuestionSource[]
  }): Promise<AdminImportApplyResponse> {
    const requestedDigest = await createAdminImportValidationDigest(
      sha256Port,
      input.request.items
    )
    if (requestedDigest !== input.request.validationDigest) {
      throw new MockPhase7AdminCommandError({
        code: 'IMPORT_IDENTITY_CONFLICT',
        message: 'import 검증 digest와 적용 요청이 일치하지 않습니다.'
      })
    }
    this.synchronizeSeeds(input.sources)
    const preflight = await this.collectImportValidation(
      input.request.items,
      input.sources
    )
    this.assertImportValidationForApply(input.request, preflight)

    return this.runExclusive(async ({ hasConcurrentPredecessor }) => {
      input.assertAuthority()
      this.synchronizeSeeds(input.sources)
      const validation = await this.collectImportValidation(
        input.request.items,
        input.sources
      )
      if (!validation.valid && hasConcurrentPredecessor) {
        throw new MockPhase7AdminCommandError({
          code: 'SERVICE_UNAVAILABLE',
          message: '동시 콘텐츠 중복으로 import를 확정하지 못했습니다.',
          disposition: 'DEFINITE_ROLLBACK',
          internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE'
        })
      }
      this.assertImportValidationForApply(input.request, validation)

      const occurredAt = this.now()
      const operationId = crypto.randomUUID()
      const actor = accountActor(input.actorId)
      const staged = await Promise.all(
        input.request.items.map(async (item) => {
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
          const tags = this.resolveTags(input.sources, item.content)
          const version = this.createVersionContent({
            actorId: input.actorId,
            content: item.content,
            occurredAt,
            questionId: question.questionId,
            tags,
            versionNumber: 1
          })
          question.openCandidateVersionId = version.questionVersionId
          const audit = await createAudit({
            command: 'QUESTION_CREATE',
            targetType: 'QUESTION',
            targetId: question.questionId,
            actor,
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
          return { audit, item, question, version }
        })
      )
      const responseItems = staged.map(({ item, question, version }) => ({
        clientItemId: item.clientItemId,
        questionId: question.questionId,
        questionVersionId: version.questionVersionId,
        lifecycleStatus: 'ACTIVE' as const,
        versionStatus: 'DRAFT' as const,
        questionRowVersion: 1 as const,
        versionRowVersion: 1 as const
      }))
      const mappingDigest = await createAdminImportMappingDigest(
        sha256Port,
        responseItems
      )
      const importAudit = await createAudit({
        command: 'IMPORT_APPLY',
        targetType: 'IMPORT_REQUEST',
        targetId: operationId,
        actor,
        beforeState: null,
        afterState: null,
        beforeRowVersion: null,
        afterRowVersion: null,
        changedFields: ['IMPORT_ITEMS'],
        metadata: {
          kind: 'IMPORT_APPLY_V1',
          validationDigest: input.request.validationDigest,
          mappingDigest,
          itemCount: staged.length
        },
        operationId,
        requestId: input.requestId,
        environment: this.auditEnvironment,
        occurredAt
      })
      const response = adminImportApplyResponseSchema.parse({
        createdCount: staged.length,
        items: responseItems,
        occurredAt
      })
      input.assertAuthority()
      staged.forEach(({ audit, question, version }) => {
        this.questionById.set(question.questionId, question)
        this.versionById.set(version.questionVersionId, version)
        this.auditLogs.push(audit)
      })
      this.auditLogs.push(importAudit)
      return response
    })
  }

  exportAdminQuestions(input: {
    actorId: string
    assertAuthority: () => void
    request: ExportAdminQuestionsRequest
    requestId: string
    sources: readonly MockCanonicalAdminQuestionSource[]
  }): Promise<MockPhase7AdminExportResult> {
    return this.runExclusive(async () => {
      input.assertAuthority()
      this.synchronizeSeeds(input.sources)
      const exportedAt = this.now()
      const questions = input.request.questionIds.map((questionId) => {
        const question = this.questionById.get(questionId)
        if (!question) {
          throw new MockPhase7AdminCommandError({
            code: 'RESOURCE_NOT_FOUND',
            message: '내보낼 관리자 문제를 찾을 수 없습니다.'
          })
        }
        const versions = [...this.versionById.values()]
          .filter((version) => version.questionId === questionId)
          .toSorted(
            (left, right) =>
              left.versionNumber - right.versionNumber ||
              compareUnicodeScalars(
                left.questionVersionId,
                right.questionVersionId
              )
          )
        if (versions.length === 0) {
          throw new MockPhase7AdminCommandError({
            code: 'SERVICE_UNAVAILABLE',
            message: '내보낼 문제의 보존 버전을 확인할 수 없습니다.'
          })
        }
        return {
          questionId: question.questionId,
          lifecycleStatus: question.lifecycleStatus,
          currentPublishedVersionId: question.currentPublishedVersionId,
          versions: versions.map((version) => ({
            questionVersionId: version.questionVersionId,
            versionNumber: version.versionNumber,
            versionStatus: version.versionStatus,
            content: {
              level: version.level,
              subject: version.subject,
              questionType: version.questionType,
              difficulty: version.difficulty,
              passage: version.passage,
              questionText: version.questionText,
              explanationKo: version.explanationKo,
              explanationJa: version.explanationJa,
              options: version.options
                .toSorted((left, right) => left.ordinal - right.ordinal)
                .map(({ id, ordinal, text }) => ({ id, ordinal, text })),
              correctOptionId: version.correctOptionId,
              tags: [...version.tags].toSorted(compareAdminTags)
            }
          }))
        }
      })
      const document: AdminQuestionExportDocumentV1 = {
        schemaVersion: 'admin-question-export-v1',
        exportedAt,
        questions
      }
      const canonicalBody = canonicalizeJson(
        document as unknown as CanonicalJsonValue
      )
      if (
        new TextEncoder().encode(canonicalBody).byteLength > EXPORT_BODY_CAP
      ) {
        throw new MockPhase7AdminCommandError({
          code: 'VALIDATION_ERROR',
          message: '선택한 문제의 내보내기 결과가 8 MiB를 초과합니다.',
          fieldErrors: {
            questionIds: ['더 작은 문제 묶음으로 나누어 내보내 주세요.']
          }
        })
      }
      const asserted = await assertAdminQuestionExportDocumentForRequest(
        sha256Port,
        input.request,
        document,
        { canonicalResponseBody: canonicalBody }
      )
      const auditEvidence = {
        selectionDigest: asserted.selectionDigest,
        responseBodyDigest: asserted.responseBodyDigest,
        questionCount: asserted.questionCount,
        versionCount: asserted.versionCount
      }
      const operationId = crypto.randomUUID()
      const audit = await createAudit({
        command: 'EXPORT',
        targetType: 'EXPORT_REQUEST',
        targetId: operationId,
        actor: accountActor(input.actorId),
        beforeState: null,
        afterState: null,
        beforeRowVersion: null,
        afterRowVersion: null,
        changedFields: ['EXPORT_SELECTION'],
        metadata: { kind: 'EXPORT_V1', ...auditEvidence },
        operationId,
        requestId: input.requestId,
        environment: this.auditEnvironment,
        occurredAt: exportedAt
      })
      input.assertAuthority()
      this.auditLogs.push(audit)
      return {
        document: asserted.document,
        canonicalBody,
        auditEvidence
      }
    })
  }

  createQuestionReport(input: {
    actorId: string
    actorRole: 'USER' | 'ADMIN'
    assertAuthority: () => void
    resolveEntitledQuestionId: (
      disposition: 'DEFINITE_ROLLBACK' | 'NO_TX'
    ) => string | null
    request: CreateQuestionReportRequest
  }): Promise<QuestionReportMutationResult> {
    const entitledQuestionId = input.resolveEntitledQuestionId('NO_TX')
    if (!entitledQuestionId) {
      throw new MockPhase7AdminCommandError({
        code: 'RESOURCE_NOT_FOUND',
        message: '신고할 수 있는 문제 버전을 찾을 수 없습니다.'
      })
    }
    const duplicateWasVisible = this.hasOpenQuestionReportDuplicate(
      input.actorId,
      input.request.questionVersionId,
      input.request.reason
    )
    if (duplicateWasVisible) {
      throw new MockPhase7AdminCommandError({
        code: 'QUESTION_REPORT_DUPLICATE',
        message: '같은 문제 버전과 사유의 처리 중 신고가 이미 있습니다.'
      })
    }
    return this.runExclusive(async ({ hasConcurrentPredecessor }) => {
      input.assertAuthority()
      const questionId = input.resolveEntitledQuestionId('DEFINITE_ROLLBACK')
      if (!questionId || questionId !== entitledQuestionId) {
        throw new MockPhase7AdminCommandError({
          code: 'RESOURCE_NOT_FOUND',
          message: '신고할 수 있는 문제 버전을 찾을 수 없습니다.',
          disposition: 'DEFINITE_ROLLBACK'
        })
      }
      if (
        this.hasOpenQuestionReportDuplicate(
          input.actorId,
          input.request.questionVersionId,
          input.request.reason
        )
      ) {
        throw new MockPhase7AdminCommandError({
          code: 'QUESTION_REPORT_DUPLICATE',
          message: '같은 문제 버전과 사유의 처리 중 신고가 이미 있습니다.',
          disposition: hasConcurrentPredecessor ? 'DEFINITE_ROLLBACK' : 'NO_TX'
        })
      }
      const occurredAt = this.now()
      const report = questionReportDetailSchema.parse({
        id: crypto.randomUUID(),
        questionId,
        questionVersionId: input.request.questionVersionId,
        reason: input.request.reason,
        description: input.request.description,
        descriptionDigest: await createQuestionReportDescriptionDigest(
          sha256Port,
          input.request.description
        ),
        status: 'OPEN',
        rowVersion: 1,
        reporter: reporterActor(input.actorId, input.actorRole),
        assignee: null,
        resolution: null,
        createdAt: occurredAt,
        updatedAt: occurredAt
      })
      input.assertAuthority()
      if (input.resolveEntitledQuestionId('DEFINITE_ROLLBACK') !== questionId) {
        throw new MockPhase7AdminCommandError({
          code: 'RESOURCE_NOT_FOUND',
          message: '신고할 수 있는 문제 버전을 찾을 수 없습니다.',
          disposition: 'DEFINITE_ROLLBACK'
        })
      }
      this.reports.push(report)
      return toQuestionReportMutation(report)
    })
  }

  triageQuestionReport(input: {
    actorId: string
    assertAuthority: () => void
    reportId: string
    request: TriageAdminQuestionReportRequest
    requestId: string
  }): Promise<QuestionReportMutationResult> {
    return this.runExclusive(async () => {
      input.assertAuthority()
      const current = this.reports.find(
        (report) => report.id === input.reportId
      )
      if (!current) {
        throw new MockPhase7AdminCommandError({
          code: 'RESOURCE_NOT_FOUND',
          message: '문제 신고를 찾을 수 없습니다.'
        })
      }
      if (current.rowVersion !== input.request.expectedRowVersion) {
        throw new MockPhase7AdminCommandError({
          code: 'VERSION_CONFLICT',
          message: '다른 요청이 먼저 문제 신고를 변경했습니다.'
        })
      }
      if (current.status !== 'OPEN') {
        throw new MockPhase7AdminCommandError({
          code: 'INVALID_STATE_TRANSITION',
          message: 'OPEN 문제 신고만 triage할 수 있습니다.'
        })
      }
      const occurredAt = this.now()
      const report = questionReportDetailSchema.parse({
        ...current,
        status: 'TRIAGED',
        rowVersion: current.rowVersion + 1,
        assignee: accountActor(input.actorId),
        updatedAt: occurredAt
      })
      const operationId = crypto.randomUUID()
      const audit = await createAudit({
        command: 'REPORT_TRIAGE',
        targetType: 'QUESTION_REPORT',
        targetId: report.id,
        actor: accountActor(input.actorId),
        beforeState: 'OPEN',
        afterState: 'TRIAGED',
        beforeRowVersion: current.rowVersion,
        afterRowVersion: report.rowVersion,
        changedFields: ['ASSIGNEE', 'REPORT_STATUS'],
        metadata: { kind: 'NONE_V1' },
        operationId,
        requestId: input.requestId,
        environment: this.auditEnvironment,
        occurredAt
      })
      input.assertAuthority()
      this.reports = this.reports.map((item) =>
        item.id === report.id ? report : item
      )
      this.auditLogs.push(audit)
      return toQuestionReportMutation(report)
    })
  }

  resolveQuestionReport(input: {
    actorId: string
    assertAuthority: () => void
    reportId: string
    request: ResolveAdminQuestionReportRequest
    requestId: string
  }): Promise<QuestionReportMutationResult> {
    return this.runExclusive(async () => {
      input.assertAuthority()
      const current = this.reports.find(
        (report) => report.id === input.reportId
      )
      if (!current) {
        throw new MockPhase7AdminCommandError({
          code: 'RESOURCE_NOT_FOUND',
          message: '문제 신고를 찾을 수 없습니다.'
        })
      }
      if (current.rowVersion !== input.request.expectedRowVersion) {
        throw new MockPhase7AdminCommandError({
          code: 'VERSION_CONFLICT',
          message: '다른 요청이 먼저 문제 신고를 변경했습니다.'
        })
      }
      if (current.status !== 'TRIAGED') {
        throw new MockPhase7AdminCommandError({
          code: 'INVALID_STATE_TRANSITION',
          message: 'TRIAGED 문제 신고만 종결할 수 있습니다.'
        })
      }
      const remediationId = input.request.remediationVersionId ?? null
      const remediation = remediationId
        ? this.versionById.get(remediationId)
        : undefined
      const reportedVersion = this.versionById.get(current.questionVersionId)
      if (!reportedVersion) {
        throw new MockPhase7AdminCommandError({
          code: 'RESOURCE_NOT_FOUND',
          message: '사용할 수 있는 신고 대상 버전을 찾을 수 없습니다.'
        })
      }
      if (
        remediationId !== null &&
        (!remediation ||
          remediation.questionId !== current.questionId ||
          remediation.questionVersionId === current.questionVersionId ||
          remediation.versionNumber <= reportedVersion.versionNumber ||
          !(
            remediation.versionStatus === 'PUBLISHED' ||
            (remediation.versionStatus === 'RETIRED' &&
              remediation.retirementKind === 'PUBLISHED_RETIREMENT' &&
              remediation.publishedAt !== null)
          ))
      ) {
        throw new MockPhase7AdminCommandError({
          code: 'RESOURCE_NOT_FOUND',
          message: '사용할 수 있는 조치 버전을 찾을 수 없습니다.'
        })
      }
      if (input.request.outcome === 'DISMISSED' && remediationId !== null) {
        throw new MockPhase7AdminCommandError({
          code: 'VALIDATION_ERROR',
          message: '기각 처리에는 조치 버전을 지정할 수 없습니다.',
          fieldErrors: {
            remediationVersionId: [
              'DISMISSED remediationVersionId는 null이어야 합니다.'
            ]
          }
        })
      }
      const occurredAt = this.now()
      const report = questionReportDetailSchema.parse({
        ...current,
        status: input.request.outcome,
        rowVersion: current.rowVersion + 1,
        resolution: {
          outcome: input.request.outcome,
          reason: input.request.reason,
          remediationVersionId: remediationId,
          resolvedAt: occurredAt
        },
        updatedAt: occurredAt
      })
      const operationId = crypto.randomUUID()
      const audit = await createAudit({
        command: 'REPORT_RESOLUTION',
        targetType: 'QUESTION_REPORT',
        targetId: report.id,
        actor: accountActor(input.actorId),
        beforeState: 'TRIAGED',
        afterState: input.request.outcome,
        beforeRowVersion: current.rowVersion,
        afterRowVersion: report.rowVersion,
        changedFields: ['RESOLUTION', 'REPORT_STATUS'],
        metadata: { kind: 'NONE_V1' },
        operationId,
        requestId: input.requestId,
        environment: this.auditEnvironment,
        occurredAt
      })
      input.assertAuthority()
      this.reports = this.reports.map((item) =>
        item.id === report.id ? report : item
      )
      this.auditLogs.push(audit)
      return toQuestionReportMutation(report)
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
      input.assertAuthority()
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
    const invoke = async (): Promise<Result> =>
      await this.withMutationLease(async () => {
        const synchronizedExternalMutation =
          this.synchronizeBeforeMutation?.() ?? false
        const before = this.captureMutableState()
        try {
          const result = await operation({
            hasConcurrentPredecessor:
              synchronizedExternalMutation ||
              (queuedBehindAnotherMutation &&
                this.successfulMutationRevision !== observedRevision) ||
              this.successfulMutationRevision !== observedRevision
          })
          this.successfulMutationRevision += 1
          try {
            this.persistState?.()
          } catch {
            this.restoreMutableState(before)
            throw new MockPhase7AdminCommandError({
              code: 'SERVICE_UNAVAILABLE',
              message: '관리자 명령을 브라우저 저장소에 저장하지 못했습니다.',
              disposition: 'DEFINITE_ROLLBACK'
            })
          }
          return result
        } catch (error: unknown) {
          this.restoreMutableState(before)
          throw error
        }
      })
    const result = this.mutationTail.then(invoke, invoke)
    this.mutationTail = result.then(
      () => undefined,
      () => undefined
    )
    const settle = (): void => {
      this.pendingMutationCount -= 1
      if (this.pendingMutationCount === 0) this.onMutationQueueIdle?.()
    }
    void result.then(settle, settle)
    return result
  }

  private captureMutableState(): MockPhase7AdminCmsPersistedState {
    return clone({
      auditLogs: this.auditLogs,
      lifecycleControlledQuestionIds: [...this.lifecycleControlledQuestionIds],
      mutationRevision: this.successfulMutationRevision,
      questions: [...this.questionById.values()],
      reports: this.reports,
      reviews: this.reviews,
      sessionIssuedAtByActorId: [...this.sessionIssuedAtByActorId],
      versions: [...this.versionById.values()]
    })
  }

  private restoreMutableState(state: MockPhase7AdminCmsPersistedState): void {
    this.auditLogs = clone([...state.auditLogs])
    this.lifecycleControlledQuestionIds = new Set(
      state.lifecycleControlledQuestionIds
    )
    this.questionById = new Map(
      state.questions.map((question) => [question.questionId, clone(question)])
    )
    this.reports = clone([...state.reports])
    this.reviews = clone([...state.reviews])
    this.sessionIssuedAtByActorId = new Map(
      state.sessionIssuedAtByActorId.map(([actorId, issuedAt]) => [
        actorId,
        issuedAt
      ])
    )
    this.successfulMutationRevision = state.mutationRevision ?? 0
    this.versionById = new Map(
      state.versions.map((version) => [
        version.questionVersionId,
        clone(version)
      ])
    )
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

  private async collectImportValidation(
    items: readonly AdminImportItem[],
    sources: readonly MockCanonicalAdminQuestionSource[]
  ): Promise<AdminImportValidationResponse> {
    this.synchronizeSeeds(sources)
    const validationDigest = await createAdminImportValidationDigest(
      sha256Port,
      items
    )
    const issues: AdminImportValidationIssue[] = []
    const pushIssue = (issue: AdminImportValidationIssue): void => {
      if (
        !issues.some(
          (current) =>
            current.itemIndex === issue.itemIndex &&
            current.fieldPath === issue.fieldPath &&
            current.code === issue.code
        )
      ) {
        issues.push(issue)
      }
    }
    const applicableTagKeys = new Set<string>()
    for (const version of this.versionById.values()) {
      for (const tag of version.tags) {
        applicableTagKeys.add(
          this.tagApplicabilityKey(tag.normalizedName, version)
        )
      }
    }
    const seenItemIds = new Set<string>()
    const eligibleIdentities: Array<string | null> = items.map(() => null)

    items.forEach((item, itemIndex) => {
      const prefix = `/items/${itemIndex}`
      if (seenItemIds.has(item.clientItemId)) {
        pushIssue({
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
          pushIssue({
            itemIndex,
            fieldPath: `${prefix}/content/options/${optionIndex}/clientOptionKey`,
            code: 'DUPLICATE_CLIENT_OPTION_KEY',
            message: 'clientOptionKey는 문제 안에서 고유해야 합니다.'
          })
        }
        const normalizedText = normalizePhase7OptionComparison(option.text)
        if (optionTexts.has(normalizedText)) {
          hasDuplicateOptionText = true
          pushIssue({
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
        pushIssue({
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
          pushIssue({
            itemIndex,
            fieldPath: `${prefix}/content/tagNames/${tagIndex}`,
            code: 'DUPLICATE_TAG',
            message: '정규화된 태그는 문제 안에서 고유해야 합니다.'
          })
        }
        if (
          !applicableTagKeys.has(
            this.tagApplicabilityKey(normalizedName, item.content)
          )
        ) {
          pushIssue({
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
        pushIssue({
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
        pushIssue({
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
        eligibleIdentities[itemIndex] = toRequestDuplicateIdentity(item.content)
      }
    })

    const existingIdentities = new Set(
      [...this.versionById.values()].map(toDuplicateIdentity)
    )
    const seenIdentities = new Set<string>()
    eligibleIdentities.forEach((identity, itemIndex) => {
      if (!identity) return
      if (existingIdentities.has(identity) || seenIdentities.has(identity)) {
        pushIssue({
          itemIndex,
          fieldPath: `/items/${itemIndex}/content/questionText`,
          code: 'DUPLICATE_QUESTION_CONTENT',
          message: '동일한 내용의 문제가 이미 존재합니다.'
        })
      }
      seenIdentities.add(identity)
    })
    issues.sort(
      (left, right) =>
        left.itemIndex - right.itemIndex ||
        compareUnicodeScalars(left.fieldPath, right.fieldPath) ||
        adminImportIssueCodeSchema.options.indexOf(left.code) -
          adminImportIssueCodeSchema.options.indexOf(right.code) ||
        compareUnicodeScalars(left.message, right.message)
    )
    return adminImportValidationResponseSchema.parse({
      valid: issues.length === 0,
      validationDigest,
      itemCount: items.length,
      errors: issues
    })
  }

  private assertImportValidationForApply(
    request: ApplyQuestionImportRequest,
    validation: AdminImportValidationResponse
  ): void {
    if (validation.validationDigest !== request.validationDigest) {
      throw new MockPhase7AdminCommandError({
        code: 'IMPORT_IDENTITY_CONFLICT',
        message: 'import 검증 digest와 적용 요청이 일치하지 않습니다.'
      })
    }
    if (validation.valid) return
    const fieldErrors: Record<string, string[]> = {}
    validation.errors.forEach((issue) => {
      fieldErrors[issue.fieldPath] = [
        ...(fieldErrors[issue.fieldPath] ?? []),
        issue.message
      ]
    })
    throw new MockPhase7AdminCommandError({
      code: 'IMPORT_VALIDATION_FAILED',
      message: 'import 의미 검증을 통과하지 못했습니다.',
      fieldErrors
    })
  }

  private tagApplicabilityKey(
    normalizedName: string,
    content: Pick<
      CreateAdminQuestionRequest,
      'level' | 'subject' | 'questionType'
    >
  ): string {
    return `${normalizedName}\u0000${content.level}\u0000${content.subject}\u0000${content.questionType}`
  }

  private hasOpenQuestionReportDuplicate(
    actorId: string,
    versionId: string,
    reason: CreateQuestionReportRequest['reason']
  ): boolean {
    return this.reports.some(
      (report) =>
        report.reporter.kind === 'ACCOUNT' &&
        report.reporter.actorId === actorId &&
        report.questionVersionId === versionId &&
        report.reason === reason &&
        (report.status === 'OPEN' || report.status === 'TRIAGED')
    )
  }

  private assertPersistedGraph(input: {
    readonly auditLogs: readonly AdminAuditLogItem[]
    readonly questionById: ReadonlyMap<string, MockPhase7AdminQuestion>
    readonly reports: readonly QuestionReportDetail[]
    readonly reviews: readonly AdminContentReviewItem[]
    readonly sources: readonly MockCanonicalAdminQuestionSource[]
    readonly versionById: ReadonlyMap<string, MockPhase7AdminVersion>
  }): void {
    const fail = (): never => {
      throw new Error('Persisted Phase 7 CMS relation graph is malformed.')
    }
    const tagIdentity = (tag: AdminTagSummary): string =>
      JSON.stringify([tag.id, tag.label, tag.normalizedName])
    const authoritativeTagIdentities = new Map<string, Set<string>>()
    const authoritativeVersions = input.sources.map(createSeedVersion)
    for (const version of authoritativeVersions) {
      for (const tag of version.tags) {
        const key = this.tagApplicabilityKey(tag.normalizedName, version)
        const identities = authoritativeTagIdentities.get(key) ?? new Set()
        identities.add(tagIdentity(tag))
        authoritativeTagIdentities.set(key, identities)
      }
    }
    const versionsByQuestionId = new Map<string, MockPhase7AdminVersion[]>()
    for (const version of input.versionById.values()) {
      const versions = versionsByQuestionId.get(version.questionId) ?? []
      versions.push(version)
      versionsByQuestionId.set(version.questionId, versions)

      const createdAt = Date.parse(version.createdAt)
      const updatedAt = Date.parse(version.updatedAt)
      const publishedAt =
        version.publishedAt === null ? null : Date.parse(version.publishedAt)
      const retiredAt =
        version.retiredAt === null ? null : Date.parse(version.retiredAt)
      const statusTimesAreValid =
        createdAt <= updatedAt &&
        (publishedAt === null ||
          (publishedAt >= createdAt && publishedAt <= updatedAt)) &&
        (retiredAt === null ||
          (retiredAt >= createdAt && retiredAt <= updatedAt))
      const lifecycleIsValid =
        version.versionStatus === 'PUBLISHED'
          ? version.publishedAt !== null &&
            version.retiredAt === null &&
            version.retirementKind === null
          : version.versionStatus === 'RETIRED'
            ? version.retiredAt !== null &&
              version.retirementKind !== null &&
              (version.retirementKind === 'PUBLISHED_RETIREMENT'
                ? version.publishedAt !== null
                : version.publishedAt === null)
            : version.publishedAt === null &&
              version.retiredAt === null &&
              version.retirementKind === null
      const ordinals = version.options
        .map((option) => option.ordinal)
        .toSorted((left, right) => left - right)
      const tagIds = new Set(version.tags.map((tag) => tag.id))
      const tagNames = new Set(version.tags.map((tag) => tag.normalizedName))
      let tagsAreCanonical = true
      try {
        assertAdminTagList(version.tags)
      } catch {
        tagsAreCanonical = false
      }
      const tagsAreApplicable = version.tags.every((tag) => {
        const identities = authoritativeTagIdentities.get(
          this.tagApplicabilityKey(tag.normalizedName, version)
        )
        return (
          normalizePhase7TagKey(tag.label) === tag.normalizedName &&
          identities?.has(tagIdentity(tag)) === true
        )
      })
      const normalizedOptionTexts = new Set(
        version.options.map((option) =>
          normalizePhase7OptionComparison(option.text)
        )
      )
      const passageIsValid =
        version.subject === 'READING'
          ? version.passage !== null
          : version.questionType === 'TEXT_GRAMMAR' || version.passage === null
      if (
        !statusTimesAreValid ||
        !lifecycleIsValid ||
        !isApplicablePhase7ContentType(
          version.level,
          version.subject,
          version.questionType
        ) ||
        !passageIsValid ||
        ordinals.some((ordinal, index) => ordinal !== index + 1) ||
        normalizedOptionTexts.size !== version.options.length ||
        tagIds.size !== version.tags.length ||
        tagNames.size !== version.tags.length ||
        !tagsAreCanonical ||
        !tagsAreApplicable ||
        (version.provenance === 'ADMIN_AUTHORED' && version.author === null)
      ) {
        fail()
      }
    }

    const duplicateQuestionByIdentity = new Map<string, string>()
    for (const question of input.questionById.values()) {
      const versions = versionsByQuestionId.get(question.questionId) ?? []
      if (versions.length === 0) fail()
      const versionNumbers = versions
        .map((version) => version.versionNumber)
        .toSorted((left, right) => left - right)
      if (
        new Set(versionNumbers).size !== versionNumbers.length ||
        versionNumbers.some(
          (versionNumber, index) => versionNumber !== index + 1
        )
      ) {
        fail()
      }
      const published = versions.filter(
        (version) => version.versionStatus === 'PUBLISHED'
      )
      const open = versions.filter((version) =>
        ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'].includes(
          version.versionStatus
        )
      )
      if (
        published.length > 1 ||
        open.length > 1 ||
        question.currentPublishedVersionId !==
          (published[0]?.questionVersionId ?? null) ||
        question.openCandidateVersionId !==
          (open[0]?.questionVersionId ?? null) ||
        Date.parse(question.createdAt) > Date.parse(question.updatedAt) ||
        (question.lifecycleStatus === 'ARCHIVED'
          ? question.archivedAt === null ||
            question.currentPublishedVersionId !== null ||
            question.openCandidateVersionId !== null
          : question.archivedAt !== null)
      ) {
        fail()
      }
      for (const version of versions) {
        const identity = toDuplicateIdentity(version)
        const existingQuestionId = duplicateQuestionByIdentity.get(identity)
        if (
          existingQuestionId !== undefined &&
          existingQuestionId !== question.questionId
        ) {
          fail()
        }
        duplicateQuestionByIdentity.set(identity, question.questionId)
      }
    }

    for (const review of input.reviews) {
      const version = input.versionById.get(review.questionVersionId)
      if (!version || version.questionId !== review.questionId) fail()
    }
    for (const report of input.reports) {
      const version = input.versionById.get(report.questionVersionId)
      const remediationVersion = report.resolution?.remediationVersionId
        ? input.versionById.get(report.resolution.remediationVersionId)
        : undefined
      if (
        !input.questionById.has(report.questionId) ||
        !version ||
        version.questionId !== report.questionId ||
        (report.resolution !== null &&
          report.resolution.remediationVersionId !== null &&
          (!remediationVersion ||
            remediationVersion.questionId !== report.questionId ||
            remediationVersion.questionVersionId === report.questionVersionId ||
            remediationVersion.versionNumber <= version.versionNumber ||
            !(
              remediationVersion.versionStatus === 'PUBLISHED' ||
              (remediationVersion.versionStatus === 'RETIRED' &&
                remediationVersion.retirementKind === 'PUBLISHED_RETIREMENT' &&
                remediationVersion.publishedAt !== null)
            )))
      ) {
        fail()
      }
    }
    for (const audit of input.auditLogs) {
      if (
        (audit.targetType === 'QUESTION' &&
          !input.questionById.has(audit.targetId)) ||
        (audit.targetType === 'QUESTION_VERSION' &&
          !input.versionById.has(audit.targetId)) ||
        (audit.targetType === 'QUESTION_REPORT' &&
          !input.reports.some((report) => report.id === audit.targetId))
      ) {
        fail()
      }
    }
  }

  private isPersistedQuestion(
    value: unknown
  ): value is MockPhase7AdminQuestion {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false
    }
    const question = value as Record<string, unknown>
    return (
      isCanonicalOpaqueId(question.questionId) &&
      (question.lifecycleStatus === 'ACTIVE' ||
        question.lifecycleStatus === 'ARCHIVED') &&
      typeof question.rowVersion === 'number' &&
      Number.isSafeInteger(question.rowVersion) &&
      question.rowVersion > 0 &&
      (question.currentPublishedVersionId === null ||
        isCanonicalOpaqueId(question.currentPublishedVersionId)) &&
      (question.openCandidateVersionId === null ||
        isCanonicalOpaqueId(question.openCandidateVersionId)) &&
      (question.archivedAt === null ||
        isCanonicalIsoInstant(question.archivedAt)) &&
      isCanonicalIsoInstant(question.createdAt) &&
      isCanonicalIsoInstant(question.updatedAt)
    )
  }

  private isPersistedVersion(value: unknown): value is MockPhase7AdminVersion {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false
    }
    const version = value as Record<string, unknown>
    const options = version.options
    const tags = version.tags
    return (
      isCanonicalOpaqueId(version.questionVersionId) &&
      isCanonicalOpaqueId(version.questionId) &&
      typeof version.versionNumber === 'number' &&
      Number.isSafeInteger(version.versionNumber) &&
      version.versionNumber > 0 &&
      typeof version.rowVersion === 'number' &&
      Number.isSafeInteger(version.rowVersion) &&
      version.rowVersion > 0 &&
      [
        'DRAFT',
        'IN_REVIEW',
        'CHANGES_REQUESTED',
        'APPROVED',
        'PUBLISHED',
        'RETIRED'
      ].includes(String(version.versionStatus)) &&
      (version.retirementKind === null ||
        version.retirementKind === 'PUBLISHED_RETIREMENT' ||
        version.retirementKind === 'QUESTION_ARCHIVE_ABANDONED' ||
        version.retirementKind === 'AUTHOR_ERASURE_ABANDONED') &&
      (version.provenance === 'SYSTEM_SEED' ||
        version.provenance === 'ADMIN_AUTHORED') &&
      ['N5', 'N4', 'N3', 'N2', 'N1'].includes(String(version.level)) &&
      ['VOCABULARY', 'GRAMMAR', 'READING'].includes(String(version.subject)) &&
      ['EASY', 'NORMAL', 'HARD'].includes(String(version.difficulty)) &&
      typeof version.questionType === 'string' &&
      typeof version.questionText === 'string' &&
      (version.passage === null || typeof version.passage === 'string') &&
      typeof version.explanationKo === 'string' &&
      (version.explanationJa === null ||
        typeof version.explanationJa === 'string') &&
      hasCanonicalPersistedContent(version, options, tags) &&
      isCanonicalOpaqueId(version.correctOptionId) &&
      Array.isArray(options) &&
      options.length === 4 &&
      options.every(
        (option) =>
          typeof option === 'object' &&
          option !== null &&
          isCanonicalOpaqueId((option as Record<string, unknown>).id) &&
          typeof (option as Record<string, unknown>).ordinal === 'number' &&
          Number.isSafeInteger((option as Record<string, unknown>).ordinal) &&
          typeof (option as Record<string, unknown>).text === 'string'
      ) &&
      new Set(options.map((option) => (option as Record<string, unknown>).id))
        .size === 4 &&
      options.some(
        (option) =>
          (option as Record<string, unknown>).id === version.correctOptionId
      ) &&
      Array.isArray(tags) &&
      tags.length > 0 &&
      tags.length <= 12 &&
      tags.every((tag) => adminTagSummarySchema.safeParse(tag).success) &&
      (version.author === null ||
        accountActorSnapshotSchema.safeParse(version.author).success) &&
      (version.latestReviewer === null ||
        accountActorSnapshotSchema.safeParse(version.latestReviewer).success) &&
      (version.publishedAt === null ||
        isCanonicalIsoInstant(version.publishedAt)) &&
      (version.retiredAt === null ||
        isCanonicalIsoInstant(version.retiredAt)) &&
      isCanonicalIsoInstant(version.createdAt) &&
      isCanonicalIsoInstant(version.updatedAt)
    )
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
    content: CreateAdminQuestionRequest | AdminImportItem['content']
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
