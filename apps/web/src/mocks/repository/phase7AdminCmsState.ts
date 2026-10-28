import {
  accountActorSnapshotSchema,
  adminAuditLogItemSchema,
  adminContentReviewItemSchema,
  adminQuestionContentInputSchema,
  adminTagSummarySchema,
  assertAdminTagList,
  compareAdminTags,
  compareUnicodeScalars,
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
  type AdminQuestionExportDocumentV1,
  type AdminTagSummary,
  type CreateAdminQuestionRequest,
  type CreateQuestionReportRequest,
  type Phase7ExecutionDisposition,
  type Phase7InternalFailureReason,
  type QuestionReportDetail,
  type QuestionReportMutationResult,
  type QuestionVersionStatus,
  type RetirementKind,
  type Sha256TextPort
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
  getCanonicalQuestionId,
  getPhase7QuestionContractIdentity,
  getQuestionVersionFingerprint,
  toContractPracticeQuestion
} from '@mocks/adapters/questionContractAdapter'
import type { MockCanonicalAdminQuestionSource } from '@mocks/repository/mockDatabase'
import { toPracticeQuestion } from '@mocks/logic/question'

const FIVE_MINUTES_MS = 5 * 60 * 1000

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
  'createQuestionReport'
>

export const createMockPhase7ActiveAdminCmsState = (
  state: MockPhase7AdminCmsState
): MockPhase7ActiveAdminCmsState => ({
  createQuestionReport: state.createQuestionReport.bind(state)
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

const createSeedVersion = (
  source: MockCanonicalAdminQuestionSource
): MockPhase7AdminVersion => {
  const fingerprint = getQuestionVersionFingerprint(source.question)
  const publicQuestion = toContractPracticeQuestion(
    toPracticeQuestion(source.question),
    fingerprint,
    getPhase7QuestionContractIdentity(source.question)
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
      sources.map((source) => getCanonicalQuestionId(source.question))
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
      const questionId = getCanonicalQuestionId(source.question)
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
}
