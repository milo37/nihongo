import {
  LEVELS,
  SUBJECTS,
  type Bookmark,
  type DashboardStats,
  type JlptLevel,
  type PracticeQuestion,
  type QuestionDifficulty,
  type QuestionOptionLabel,
  type QuestionRecord,
  type QuestionStatus,
  type QuestionSubject,
  type QuestionType,
  type StudyAnswerInput,
  type StudyMode,
  type StudyResult,
  type StudySession,
  type User,
  type UserRole,
  type WrongNote,
  type WrongNoteStatus
} from '@common/types/domain'
import { normalizeQuestionTagText } from '@nihongo/contracts/question/get-question'
import { isoDateTimeSchema } from '@nihongo/contracts/common/date'
import {
  cachedStorage,
  MOCK_DATABASE_STORAGE_KEY,
  subscribeStorageChanges
} from '@libs/storage'
import type { ParsedSubmitStudySessionBody } from '@nihongo/contracts/study/submit-study-session'
import type { ParsedSubmitStudySessionV2Body } from '@nihongo/contracts/study/submit-study-session'
import type { ParsedSaveStudyDraftAnswersBody } from '@nihongo/contracts/study/save-study-draft-answers'
import type { ReviewSelectionFilter } from '@nihongo/contracts/study/create-study-session'
import {
  compareReviewQueueItems,
  type ListReviewQueueResponse,
  type ParsedListReviewQueueQuery,
  type ReviewQueueItem
} from '@nihongo/contracts/wrong-note/list-review-queue'
import type { ReviewEventHistoryItem } from '@nihongo/contracts/wrong-note/list-review-events'
import type { UserMemo } from '@nihongo/contracts/wrong-note/user-memo'
import {
  createTargetedReviewSessionCanonicalMaterial,
  createTargetedReviewSessionResponseForQuestionSchema,
  type CreateTargetedReviewSessionResponse
} from '@nihongo/contracts/wrong-note/create-targeted-review-session'
import { compareWrongNoteTagLabels } from '@nihongo/contracts/wrong-note/list-wrong-notes'
import type {
  ListResumableStudySessionsResponse,
  ResumableStudySessionSummary
} from '@nihongo/contracts/study/list-resumable-study-sessions'
import type { StudyDraftSnapshot } from '@nihongo/contracts/study/study-draft'
import type { VersionedStudySessionPayload } from '@nihongo/contracts/study/study-session'
import {
  reviewedQuestionSchema as canonicalReviewedQuestionSchema,
  studyResultSchema as canonicalStudyResultSchema,
  type StudyResult as CanonicalStudyResult
} from '@nihongo/contracts/study/study-result'
import {
  getContractQuestionId,
  getQuestionVersionFingerprint,
  toContractPracticeQuestion,
  toStableMockUuid
} from '@mocks/adapters/questionContractAdapter'
import type {
  MockCanonicalGradedItem,
  MockCanonicalGrading
} from '@mocks/adapters/studySubmissionContractAdapter'
import { mockSeedData } from '@mocks/data'
import { DEMO_ADMIN_ID, DEMO_USER_ID } from '@mocks/data/users'
import { addDaysToIso, toDateKey } from '@util/date'
import { toPracticeQuestion } from '@util/question'
import {
  createSeededRandom,
  seededShuffle,
  type ShuffleSeed
} from '@util/shuffle'
import { toVersionedContractStudySessionPayload } from '@mocks/adapters/studySessionContractAdapter'
import {
  selectBookmarkStudyCandidates,
  selectDailyReviewStudyCandidates,
  selectRandomStudyCandidates,
  selectWeaknessStudyCandidates,
  selectWrongNoteStudyCandidates
} from '@mocks/adapters/studyCandidateSelection'
import { calculateStudyResult } from '@util/study'
import {
  createWrongNoteFromIncorrectAnswer,
  updateWrongNoteAfterCorrectReview,
  updateWrongNoteAfterIncorrectAnswer
} from '@util/wrongNote'

const RECENT_SESSION_LIMIT = 5
const REPEATED_WRONG_LIMIT = 5
const MIN_WEAKNESS_ATTEMPTS = 3
const WEAKNESS_SESSION_LIMIT = 10

export type MockDatabaseErrorCode =
  | 'ANSWER_NOT_IN_SESSION'
  | 'AUTH_REQUIRED'
  | 'DUPLICATE_RESOURCE'
  | 'DRAFT_SUBMIT_MISMATCH'
  | 'DRAFT_VERSION_CONFLICT'
  | 'FORBIDDEN'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'NO_ELIGIBLE_QUESTIONS'
  | 'OPTION_NOT_IN_VERSION'
  | 'PERSISTENCE_FAILED'
  | 'PRACTICE_CONTRACT_VERSION_MISMATCH'
  | 'QUESTION_NOT_AVAILABLE'
  | 'SESSION_SUBMITTED'
  | 'STUDY_RESULT_NOT_READY'
  | 'STUDY_SESSION_NOT_EDITABLE'

export class MockDatabaseError extends Error {
  readonly code: MockDatabaseErrorCode
  readonly status: number

  constructor(code: MockDatabaseErrorCode, status: number, message: string) {
    super(message)
    this.name = 'MockDatabaseError'
    this.code = code
    this.status = status
  }
}

export interface QuestionListFilters {
  level?: JlptLevel
  subject?: QuestionSubject
  questionType?: QuestionType
  difficulty?: QuestionDifficulty
  tag?: string
  search?: string
  page?: number
  pageSize?: number
}

export interface QuestionListResult {
  items: PracticeQuestion[]
  total: number
  page: number
  pageSize: number
}

export interface CreateStudySessionInput {
  canonicalGuestPrincipalId?: string
  canonicalContractVersion?: 1 | 2
  userId?: string | null
  level: JlptLevel
  subject: QuestionSubject
  mode: StudyMode
  reviewFilter?: ReviewSelectionFilter
  count: number
  questionIds?: string[]
  seed?: ShuffleSeed
}

export interface StudySessionPayload {
  session: StudySession
  questions: PracticeQuestion[]
  requestedCount: number
  actualCount: number
  usedFallback: boolean
}

export interface MockStudySessionSnapshotRecord {
  canonicalStatus?: 'CANCELLED' | 'EXPIRED'
  practiceContractVersion?: 1 | 2
  session: StudySession
  requestedCount: number
  questions: QuestionRecord[]
}

export interface SubmitStudySessionInput {
  sessionId: string
  answers: StudyAnswerInput[]
  durationSec: number
}

export type WrongNoteSort = 'RECENT' | 'MOST_WRONG' | 'OLDEST'

export interface WrongNoteListFilters {
  level?: JlptLevel
  subject?: QuestionSubject
  status?: WrongNoteStatus
  tag?: string
  sort?: WrongNoteSort
  page?: number
  pageSize?: number
}

export interface WrongNoteQuestionSummary {
  id: string
  level: JlptLevel
  subject: QuestionSubject
  questionType: QuestionType
  questionText: string
  difficulty: QuestionDifficulty
  tags: string[]
}

export interface WrongNoteListItem {
  wrongNote: WrongNote
  question: WrongNoteQuestionSummary
}

export interface WrongNoteListResult {
  items: WrongNoteListItem[]
  total: number
  page: number
  pageSize: number
  availableTags: string[]
}

export interface WrongNoteDetail {
  wrongNote: WrongNote
  question: QuestionRecord
}

export interface WrongNoteReviewResult {
  wrongNote: WrongNote
  isCorrect: boolean
}

export interface BookmarkListItem {
  bookmark: Bookmark
  question: PracticeQuestion
}

export interface BookmarkListResult {
  items: BookmarkListItem[]
  total: number
}

export interface CanonicalBookmarkSourceRecord {
  availability: 'AVAILABLE' | 'ARCHIVED'
  bookmark: Bookmark
  question: QuestionRecord
}

export interface AdminQuestionOptionInput {
  id?: string
  label: QuestionOptionLabel
  text: string
}

export interface AdminQuestionInput {
  level: JlptLevel
  subject: QuestionSubject
  questionType: QuestionType
  passage: string | null
  questionText: string
  options: AdminQuestionOptionInput[]
  correctOptionId: string
  explanationKo: string
  explanationJa: string | null
  difficulty: QuestionDifficulty
  tags: string[]
  status: QuestionStatus
}

export interface AdminQuestionSummary {
  id: string
  level: JlptLevel
  subject: QuestionSubject
  questionType: QuestionType
  questionText: string
  difficulty: QuestionDifficulty
  tags: string[]
  status: QuestionStatus
  updatedAt: string
}

export interface MockCanonicalStudyAnswerRecord {
  readonly id: string
  readonly answeredAt: string
  readonly elapsedSec: number
  readonly isCorrect: boolean
  readonly questionVersionId: string
  readonly selectedOptionId: string | null
  readonly sessionId: string
  readonly sourceQuestionId: string
  readonly studySessionQuestionId: string
}

export interface MockCanonicalReviewEventRecord {
  readonly algorithmVersion: 1
  readonly id: string
  readonly isCorrect: boolean | null
  readonly nextCorrectStreak: number
  readonly nextStatus: WrongNoteStatus
  readonly occurredAt: string
  readonly previousCorrectStreak: number | null
  readonly previousStatus: WrongNoteStatus | null
  readonly previousWrongCount: number | null
  readonly questionId: string
  readonly questionVersionId: string
  readonly selectedOptionId: string | null
  readonly source: 'STUDY_SUBMIT' | 'WRONG_NOTE_REVIEW' | 'VERSION_REBASE'
  readonly studyAnswerId: string | null
  readonly studySessionId: string | null
  readonly userId: string
  readonly wrongCountAfter: number
  readonly wrongNoteId: string
}

export interface MockCanonicalWrongNoteRecord {
  readonly correctStreak: number
  readonly currentReviewQuestionVersionId: string | null
  readonly isCurrentPublished: boolean
  readonly lastReviewedAt: string | null
  readonly lastWrongAt: string
  readonly lastWrongQuestion: QuestionRecord
  readonly lastWrongQuestionVersionId: string
  readonly nextReviewAt: string
  readonly sourceQuestionId: string
  readonly status: WrongNoteStatus
  readonly updatedAt: string
  readonly userId: string
  readonly wrongCount: number
  readonly wrongNoteId: string
}

interface MockCanonicalUserMemoRecord {
  readonly createdAt: string
  readonly text: string
  readonly updatedAt: string
  readonly wrongNoteId: string
}

export interface MockCanonicalDashboardSessionRecord {
  readonly correctCount: number
  readonly durationSec: number
  readonly id: string
  readonly level: JlptLevel
  readonly mode: StudyMode
  readonly subject: QuestionSubject
  readonly submittedAt: string
  readonly totalCount: number
}

export interface MockCanonicalDashboardRecord {
  readonly observedAt: string
  readonly sessions: readonly MockCanonicalDashboardSessionRecord[]
  readonly wrongNotes: readonly MockCanonicalWrongNoteRecord[]
}

interface MockCanonicalIdempotencyRecordBase {
  readonly completedAt: string
  readonly contractVersion: 1 | 2
  readonly expiresAt: string
  readonly idempotencyKey: string
  readonly principalId: string
  readonly principalKind: 'GUEST' | 'USER'
  readonly requestMaterial: string
  readonly sessionId: string
}

export interface MockCanonicalSubmissionIdempotencyRecord
  extends MockCanonicalIdempotencyRecordBase {
  readonly operation: 'study.submitStudySession'
  readonly response: CanonicalStudyResult
  readonly responseStatus: 201
}

export interface MockCanonicalDraftIdempotencyRecord
  extends MockCanonicalIdempotencyRecordBase {
  readonly operation: 'study.saveStudyDraftAnswers'
  readonly response: StudyDraftSnapshot
  readonly responseStatus: 200
}

export interface MockCanonicalRetryIdempotencyRecord
  extends MockCanonicalIdempotencyRecordBase {
  readonly operation: 'study.createResultRetrySession'
  readonly response: VersionedStudySessionPayload
  readonly responseStatus: 201
  readonly sourceSessionId: string
}

export interface MockCanonicalTargetedReviewIdempotencyRecord
  extends MockCanonicalIdempotencyRecordBase {
  readonly operation: 'wrongNote.createTargetedReviewSession'
  readonly questionId: string
  readonly response: CreateTargetedReviewSessionResponse
  readonly responseStatus: 201
}

export type MockCanonicalIdempotencyRecord =
  | MockCanonicalSubmissionIdempotencyRecord
  | MockCanonicalDraftIdempotencyRecord
  | MockCanonicalRetryIdempotencyRecord
  | MockCanonicalTargetedReviewIdempotencyRecord

export interface SubmitCanonicalStudySessionInput {
  readonly body: ParsedSubmitStudySessionBody | ParsedSubmitStudySessionV2Body
  readonly contractVersion?: 1 | 2
  readonly guestPrincipalId: string | null
  readonly idempotencyKey: string
  readonly sessionId: string
}

export interface MockCanonicalSubmissionOperations {
  readonly canonicalize: (
    record: MockStudySessionSnapshotRecord,
    body: ParsedSubmitStudySessionBody | ParsedSubmitStudySessionV2Body
  ) => string
  readonly grade: (
    record: MockStudySessionSnapshotRecord,
    body: ParsedSubmitStudySessionBody | ParsedSubmitStudySessionV2Body,
    submittedAt: string
  ) => MockCanonicalGrading
  readonly toResult: (
    grading: MockCanonicalGrading,
    wrongNoteStatusBySessionQuestionId: ReadonlyMap<
      string,
      CanonicalStudyResult['items'][number]['wrongNoteStatus']
    >
  ) => CanonicalStudyResult
}

export interface SubmitCanonicalStudySessionResult {
  readonly replayed: boolean
  readonly response: CanonicalStudyResult
}

export interface SaveCanonicalStudyDraftInput {
  readonly body: ParsedSaveStudyDraftAnswersBody
  readonly guestPrincipalId: string | null
  readonly idempotencyKey: string
  readonly sessionId: string
}

export interface SaveCanonicalStudyDraftResult {
  readonly replayed: boolean
  readonly response: StudyDraftSnapshot
}

export interface CreateCanonicalResultRetryInput {
  readonly guestPrincipalId: string | null
  readonly idempotencyKey: string
  readonly sourceSessionId: string
}

export interface CreateCanonicalResultRetryResult {
  readonly replayed: boolean
  readonly response: VersionedStudySessionPayload
}

export interface CreateCanonicalTargetedReviewInput {
  readonly idempotencyKey: string
  readonly questionId: string
  readonly userId: string
}

export interface CreateCanonicalTargetedReviewResult {
  readonly replayed: boolean
  readonly response: CreateTargetedReviewSessionResponse
}

interface MockCanonicalOwner {
  readonly principalId: string
  readonly principalKind: 'GUEST' | 'USER'
  readonly userId: string | null
}

interface MockCanonicalAnswerEvidence {
  readonly answer: MockCanonicalStudyAnswerRecord
  readonly question: QuestionRecord
  readonly resultItem: CanonicalStudyResult['items'][number]
}

interface MockCanonicalSubmissionEvidence {
  readonly answers: readonly MockCanonicalAnswerEvidence[]
  readonly result: CanonicalStudyResult
  readonly session: StudySession
}

export type AdminQuestionSort = 'RECENT' | 'LEVEL' | 'STATUS'

export interface AdminQuestionListFilters {
  search?: string
  level?: JlptLevel
  subject?: QuestionSubject
  status?: QuestionStatus
  difficulty?: QuestionDifficulty
  sort?: AdminQuestionSort
  page?: number
  pageSize?: number
}

export interface AdminQuestionListResult {
  items: AdminQuestionSummary[]
  total: number
  page: number
  pageSize: number
}

interface SessionMetadata {
  canonicalGuestPrincipalId?: string
  canonicalContractVersion?: 1 | 2
  canonicalTerminalStatus?: 'CANCELLED' | 'EXPIRED'
  creationOrder?: number
  retryOfStudySessionId?: string
  requestedCount: number
  usedFallback: boolean
}

interface PersistedMockStateBase {
  activeCanonicalGuestPrincipalIds?: string[]
  currentUserId: string | null
  questions: QuestionRecord[]
  sessions: StudySession[]
  sessionMetadata: Array<[string, SessionMetadata]>
  sessionQuestionSnapshots: Array<[string, QuestionRecord[]]>
  results: StudyResult[]
  wrongNotes: WrongNote[]
  bookmarks: Bookmark[]
}

interface PersistedMockStateV2 extends PersistedMockStateBase {
  version: 2
}

interface PersistedMockStateV3 extends PersistedMockStateBase {
  version: 3
  canonicalIdempotencyRecords: MockCanonicalIdempotencyRecord[]
  canonicalReviewEvents: MockCanonicalReviewEventRecord[]
  canonicalStudyAnswers: Array<[string, MockCanonicalStudyAnswerRecord[]]>
  canonicalStudyResults: CanonicalStudyResult[]
}

interface PersistedMockStateV4 extends PersistedMockStateBase {
  version: 4
  canonicalDrafts: StudyDraftSnapshot[]
  canonicalIdempotencyRecords: MockCanonicalIdempotencyRecord[]
  canonicalReviewEvents: MockCanonicalReviewEventRecord[]
  canonicalStudyAnswers: Array<[string, MockCanonicalStudyAnswerRecord[]]>
  canonicalStudyResults: CanonicalStudyResult[]
}

interface PersistedMockStateV5 extends PersistedMockStateBase {
  version: 5
  archivedQuestions: QuestionRecord[]
  canonicalDrafts: StudyDraftSnapshot[]
  canonicalIdempotencyRecords: MockCanonicalIdempotencyRecord[]
  canonicalReviewEvents: MockCanonicalReviewEventRecord[]
  canonicalStudyAnswers: Array<[string, MockCanonicalStudyAnswerRecord[]]>
  canonicalStudyResults: CanonicalStudyResult[]
}

interface PersistedMockStateV6 extends PersistedMockStateBase {
  version: 6
  archivedQuestions: QuestionRecord[]
  canonicalDrafts: StudyDraftSnapshot[]
  canonicalIdempotencyRecords: MockCanonicalIdempotencyRecord[]
  canonicalReviewEvents: MockCanonicalReviewEventRecord[]
  canonicalStudyAnswers: Array<[string, MockCanonicalStudyAnswerRecord[]]>
  canonicalStudyResults: CanonicalStudyResult[]
}

interface PersistedMockState extends PersistedMockStateBase {
  version: 7
  archivedQuestions: QuestionRecord[]
  canonicalDrafts: StudyDraftSnapshot[]
  canonicalIdempotencyRecords: MockCanonicalIdempotencyRecord[]
  canonicalReviewEvents: MockCanonicalReviewEventRecord[]
  canonicalStudyAnswers: Array<[string, MockCanonicalStudyAnswerRecord[]]>
  canonicalStudyResults: CanonicalStudyResult[]
  canonicalUserMemos: MockCanonicalUserMemoRecord[]
}

type HydratablePersistedMockState =
  | PersistedMockState
  | PersistedMockStateV2
  | PersistedMockStateV3
  | PersistedMockStateV4
  | PersistedMockStateV5
  | PersistedMockStateV6

export interface MockStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => boolean | void
  removeItem: (key: string) => void
}

export interface MockDatabaseOptions {
  now?: () => string
  seed?: ShuffleSeed
  storage?: MockStorage
  listenToStorage?: boolean
}

const defaultStorage: MockStorage = {
  getItem: (key): string | null => {
    const value = cachedStorage.getItem(key)
    return typeof value === 'string' ? value : null
  },
  setItem: (key, value): boolean => {
    return cachedStorage.setItem(key, value)
  },
  removeItem: (key): void => {
    void cachedStorage.removeItem(key)
  }
}

const clone = <Value>(value: Value): Value => structuredClone(value)

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function throwCanonicalIntegrityError(message: string): never {
  throw new MockDatabaseError('PERSISTENCE_FAILED', 500, message)
}

const toCanonicalIsoInstant = (value: unknown, field: string): string => {
  const parsed = isoDateTimeSchema.safeParse(value)
  if (!parsed.success) {
    return throwCanonicalIntegrityError(`${field} 시각이 올바르지 않습니다.`)
  }
  return parsed.data
}

const getCanonicalSessionQuestionId = (
  sessionId: string,
  ordinal: number
): string =>
  toStableMockUuid('study-session-question', `${sessionId}:${ordinal}`)

const getCanonicalQuestionVersionId = (question: QuestionRecord): string =>
  toStableMockUuid(
    'question-version',
    `${question.id}:${getQuestionVersionFingerprint(question)}`
  )

const getCanonicalOptionId = (
  question: QuestionRecord,
  optionId: string
): string =>
  toStableMockUuid(
    'question-option',
    `${optionId}:${getQuestionVersionFingerprint(question)}`
  )

const toCanonicalReviewedQuestion = (
  question: QuestionRecord
): CanonicalStudyResult['items'][number]['question'] => {
  const correctOptions = question.options.filter(({ isCorrect }) => isCorrect)
  const correctOption = correctOptions[0]
  if (!correctOption || correctOptions.length !== 1) {
    return throwCanonicalIntegrityError(
      'canonical 문제 snapshot에는 정답 보기가 정확히 하나여야 합니다.'
    )
  }
  const fingerprint = getQuestionVersionFingerprint(question)

  return {
    ...toContractPracticeQuestion(toPracticeQuestion(question), fingerprint),
    correctOptionId: getCanonicalOptionId(question, correctOption.id),
    explanationKo: question.explanationKo,
    explanationJa: question.explanationJa
  }
}

const assertCanonicalProjectionEqual = (
  actual: unknown,
  expected: unknown,
  message: string
): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throwCanonicalIntegrityError(message)
  }
}

const getCanonicalReviewIntervalDays = (correctStreak: number): number => {
  if (correctStreak === 1) {
    return 3
  }
  if (correctStreak === 2) {
    return 7
  }
  if (correctStreak === 3) {
    return 14
  }
  return 30
}

const isPersistedMockState = (
  value: unknown
): value is HydratablePersistedMockState => {
  if (
    !isRecord(value) ||
    (value.version !== 2 &&
      value.version !== 3 &&
      value.version !== 4 &&
      value.version !== 5 &&
      value.version !== 6 &&
      value.version !== 7)
  ) {
    return false
  }

  return (
    (typeof value.currentUserId === 'string' || value.currentUserId === null) &&
    Array.isArray(value.questions) &&
    Array.isArray(value.sessions) &&
    Array.isArray(value.sessionMetadata) &&
    (value.activeCanonicalGuestPrincipalIds === undefined ||
      (Array.isArray(value.activeCanonicalGuestPrincipalIds) &&
        value.activeCanonicalGuestPrincipalIds.every(
          (guestPrincipalId) => typeof guestPrincipalId === 'string'
        ))) &&
    Array.isArray(value.sessionQuestionSnapshots) &&
    Array.isArray(value.results) &&
    Array.isArray(value.wrongNotes) &&
    Array.isArray(value.bookmarks) &&
    (value.version === 2 ||
      (Array.isArray(value.canonicalIdempotencyRecords) &&
        Array.isArray(value.canonicalReviewEvents) &&
        Array.isArray(value.canonicalStudyAnswers) &&
        Array.isArray(value.canonicalStudyResults) &&
        (value.version === 3 || Array.isArray(value.canonicalDrafts)) &&
        (value.version < 5 || Array.isArray(value.archivedQuestions)) &&
        (value.version < 7 || Array.isArray(value.canonicalUserMemos))))
  )
}

const makeUserQuestionKey = (userId: string, questionId: string): string => {
  return `${userId}:${questionId}`
}

const makeCanonicalIdempotencyKey = (
  principalKind: MockCanonicalIdempotencyRecord['principalKind'],
  principalId: string,
  operation: MockCanonicalIdempotencyRecord['operation'],
  idempotencyKey: string
): string => `${principalKind}:${principalId}:${operation}:${idempotencyKey}`

const getCanonicalIdempotencyExpiresAt = (
  completedAt: string,
  operation: MockCanonicalIdempotencyRecord['operation']
): string => {
  const completedAtMs = Date.parse(completedAt)
  if (!Number.isFinite(completedAtMs)) {
    throw new MockDatabaseError(
      'PERSISTENCE_FAILED',
      500,
      'canonical IdempotencyRecord 완료 시간이 올바르지 않습니다.'
    )
  }
  const ttlMs =
    operation === 'study.createResultRetrySession' ||
    operation === 'wrongNote.createTargetedReviewSession'
      ? 7 * 24 * 60 * 60 * 1_000
      : operation === 'study.saveStudyDraftAnswers'
        ? 48 * 60 * 60 * 1_000
        : 24 * 60 * 60 * 1_000
  return new Date(completedAtMs + ttlMs).toISOString()
}

const isCanonicalIdempotencyRecordActive = (
  record: MockCanonicalIdempotencyRecord,
  observedAt: string
): boolean => {
  const expiresAtMs = Date.parse(record.expiresAt)
  const observedAtMs = Date.parse(observedAt)
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(observedAtMs)) {
    throw new MockDatabaseError(
      'PERSISTENCE_FAILED',
      500,
      'canonical IdempotencyRecord 만료 시간이 올바르지 않습니다.'
    )
  }
  return expiresAtMs > observedAtMs
}

const canonicalizeMockStudyDraftSave = (
  sessionId: string,
  orderedSessionQuestionIds: readonly string[],
  body: ParsedSaveStudyDraftAnswersBody
): string => {
  const ordinalById = new Map(
    orderedSessionQuestionIds.map((id, index) => [id, index + 1])
  )
  const answers = body.answers
    .map((answer) => ({
      studySessionQuestionId: answer.studySessionQuestionId,
      selectedOptionId: answer.selectedOptionId,
      elapsedSec: answer.elapsedSec
    }))
    .toSorted((left, right) => {
      const leftOrdinal =
        ordinalById.get(left.studySessionQuestionId) ?? Number.MAX_SAFE_INTEGER
      const rightOrdinal =
        ordinalById.get(right.studySessionQuestionId) ?? Number.MAX_SAFE_INTEGER
      return (
        leftOrdinal - rightOrdinal ||
        left.studySessionQuestionId.localeCompare(right.studySessionQuestionId)
      )
    })

  return `draft-save-v2:${JSON.stringify({
    sessionId,
    expectedRevision: body.expectedRevision,
    currentOrdinal: body.currentOrdinal,
    answers
  })}`
}

const toDuplicatePreservingKey = (
  records: ReadonlyMap<string, unknown>,
  key: string,
  index: number
): string => (records.has(key) ? `${key}:duplicate:${index}` : key)

const fromDuplicatePreservingKey = (key: string): string =>
  key.replace(/:duplicate:\d+$/u, '')

const isCanonicalSessionMetadata = (
  metadata: SessionMetadata | undefined
): boolean =>
  metadata?.canonicalContractVersion !== undefined ||
  metadata?.canonicalGuestPrincipalId !== undefined

const normalizePagination = (
  page = 1,
  pageSize = 20
): { page: number; pageSize: number } => ({
  page: Math.max(1, Math.trunc(page)),
  pageSize: Math.min(100, Math.max(1, Math.trunc(pageSize)))
})

const paginate = <Item>(
  items: readonly Item[],
  page: number,
  pageSize: number
): Item[] => {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}

const toWrongNoteSummary = (
  question: QuestionRecord
): WrongNoteQuestionSummary => ({
  id: question.id,
  level: question.level,
  subject: question.subject,
  questionType: question.questionType,
  questionText: question.questionText,
  difficulty: question.difficulty,
  tags: [...question.tags]
})

const toAdminSummary = (question: QuestionRecord): AdminQuestionSummary => ({
  id: question.id,
  level: question.level,
  subject: question.subject,
  questionType: question.questionType,
  questionText: question.questionText,
  difficulty: question.difficulty,
  tags: [...question.tags],
  status: question.status,
  updatedAt: question.updatedAt
})

export class MockDatabase {
  private readonly now: () => string
  private readonly randomSeed: ShuffleSeed
  private readonly storage: MockStorage
  private unsubscribeStorage: (() => void) | undefined
  private readonly userById = new Map<string, User>()
  private questionById = new Map<string, QuestionRecord>()
  private archivedQuestionById = new Map<string, QuestionRecord>()
  private sessionById = new Map<string, StudySession>()
  private sessionMetadataById = new Map<string, SessionMetadata>()
  private sessionQuestionSnapshotsById = new Map<string, QuestionRecord[]>()
  private canonicalAnswerBySessionId = new Map<
    string,
    MockCanonicalStudyAnswerRecord[]
  >()
  private canonicalResultBySessionId = new Map<string, CanonicalStudyResult>()
  private canonicalDraftBySessionId = new Map<string, StudyDraftSnapshot>()
  private canonicalReviewEventByStudyAnswerId = new Map<
    string,
    MockCanonicalReviewEventRecord
  >()
  private canonicalIdempotencyRecordByKey = new Map<
    string,
    MockCanonicalIdempotencyRecord
  >()
  private canonicalUserMemoByWrongNoteId = new Map<
    string,
    MockCanonicalUserMemoRecord
  >()
  private activeCanonicalGuestPrincipalIds = new Set<string>()
  private resultBySessionId = new Map<string, StudyResult>()
  private wrongNoteByQuestionId = new Map<string, WrongNote>()
  private bookmarkByQuestionId = new Map<string, Bookmark>()
  private currentUserId: string | null = null
  private sequence = 0

  constructor(options: MockDatabaseOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.randomSeed = options.seed ?? 'jlpt-drill-note'
    this.storage = options.storage ?? defaultStorage

    for (const user of mockSeedData.users) {
      this.userById.set(user.id, clone(user))
    }

    this.resetMemoryToSeed()
    this.hydrateFromStorage(this.storage.getItem(MOCK_DATABASE_STORAGE_KEY))

    if (options.listenToStorage !== false) {
      this.listenForExternalStorageChanges()
    }
  }

  getCurrentUser(): User | null {
    if (!this.currentUserId) {
      return null
    }

    const user = this.userById.get(this.currentUserId)
    return user ? clone(user) : null
  }

  loginAs(role: Extract<UserRole, 'USER' | 'ADMIN'>): User {
    const userId = role === 'ADMIN' ? DEMO_ADMIN_ID : DEMO_USER_ID
    const user = this.userById.get(userId)

    if (!user) {
      throw new MockDatabaseError('NOT_FOUND', 404, '데모 사용자가 없습니다.')
    }

    this.currentUserId = user.id
    this.persist()
    return clone(user)
  }

  logout(): void {
    this.currentUserId = null
    this.persist()
  }

  isCanonicalGuestPrincipalActive(guestPrincipalId: string): boolean {
    return this.activeCanonicalGuestPrincipalIds.has(guestPrincipalId)
  }

  deleteCanonicalGuestPrincipal(guestPrincipalId: string): number {
    this.activeCanonicalGuestPrincipalIds.delete(guestPrincipalId)
    let deletedSessionCount = 0

    for (const [sessionId, metadata] of this.sessionMetadataById) {
      if (metadata.canonicalGuestPrincipalId !== guestPrincipalId) {
        continue
      }

      const session = this.sessionById.get(sessionId)
      if (session?.userId === null && this.sessionById.delete(sessionId)) {
        deletedSessionCount += 1
      }
      this.sessionMetadataById.delete(sessionId)
      this.sessionQuestionSnapshotsById.delete(sessionId)
      this.canonicalDraftBySessionId.delete(sessionId)
      this.canonicalAnswerBySessionId.delete(sessionId)
      this.canonicalResultBySessionId.delete(sessionId)
      for (const [studyAnswerId, event] of this
        .canonicalReviewEventByStudyAnswerId) {
        if (event.studySessionId === sessionId) {
          this.canonicalReviewEventByStudyAnswerId.delete(studyAnswerId)
        }
      }
      this.resultBySessionId.delete(sessionId)
    }

    for (const [key, record] of this.canonicalIdempotencyRecordByKey) {
      if (
        record.principalKind === 'GUEST' &&
        record.principalId === guestPrincipalId
      ) {
        this.canonicalIdempotencyRecordByKey.delete(key)
      }
    }

    this.persist()
    return deletedSessionCount
  }

  listQuestions(filters: QuestionListFilters = {}): QuestionListResult {
    const { page, pageSize } = normalizePagination(
      filters.page,
      filters.pageSize
    )
    const normalizedSearch = filters.search?.trim().toLocaleLowerCase()
    const normalizedTag = filters.tag
      ? normalizeQuestionTagText(filters.tag)
      : undefined
    const matches: QuestionRecord[] = []

    for (const question of this.questionById.values()) {
      if (question.status !== 'PUBLISHED') {
        continue
      }
      if (filters.level && question.level !== filters.level) {
        continue
      }
      if (filters.subject && question.subject !== filters.subject) {
        continue
      }
      if (
        filters.questionType &&
        question.questionType !== filters.questionType
      ) {
        continue
      }
      if (filters.difficulty && question.difficulty !== filters.difficulty) {
        continue
      }
      if (
        normalizedTag &&
        !question.tags.some(
          (tag) => normalizeQuestionTagText(tag) === normalizedTag
        )
      ) {
        continue
      }
      if (
        normalizedSearch &&
        !`${question.questionText} ${question.tags.join(' ')}`
          .toLocaleLowerCase()
          .includes(normalizedSearch)
      ) {
        continue
      }

      matches.push(question)
    }

    const sortedMatches = matches.toSorted((left, right) =>
      left.id.localeCompare(right.id)
    )
    return {
      items: paginate(sortedMatches, page, pageSize).map(toPracticeQuestion),
      total: matches.length,
      page,
      pageSize
    }
  }

  getQuestion(questionId: string): QuestionRecord {
    const question = this.questionById.get(questionId)

    if (!question) {
      throw new MockDatabaseError('NOT_FOUND', 404, '문제를 찾을 수 없습니다.')
    }

    return clone(question)
  }

  getPracticeQuestion(questionId: string): PracticeQuestion {
    const question = this.getQuestion(questionId)

    if (question.status !== 'PUBLISHED') {
      throw new MockDatabaseError('NOT_FOUND', 404, '문제를 찾을 수 없습니다.')
    }

    return toPracticeQuestion(question)
  }

  createStudySession(input: CreateStudySessionInput): StudySessionPayload {
    const requestedCount = Math.min(20, Math.max(1, Math.trunc(input.count)))
    const userId = input.userId ?? this.currentUserId
    const eligible = this.getEligibleQuestions(
      input.level,
      input.subject
    ).filter(
      (question) =>
        input.reviewFilter === undefined ||
        ((input.reviewFilter.questionType === undefined ||
          question.questionType === input.reviewFilter.questionType) &&
          (input.reviewFilter.tag === undefined ||
            question.tags.includes(input.reviewFilter.tag)))
    )
    const startedAt = this.now()

    if (
      !userId &&
      (input.mode === 'WRONG_NOTE' ||
        input.mode === 'BOOKMARK' ||
        input.mode === 'DAILY_REVIEW')
    ) {
      throw new MockDatabaseError(
        'AUTH_REQUIRED',
        401,
        '이 출제 모드는 로그인이 필요합니다.'
      )
    }

    if (eligible.length === 0) {
      throw new MockDatabaseError(
        'NOT_FOUND',
        404,
        '선택한 조건에 출제 가능한 문제가 없습니다.'
      )
    }

    const selection = input.canonicalContractVersion
      ? this.selectCanonicalQuestions(input, eligible, userId, startedAt)
      : this.selectQuestions(input, eligible, userId)
    const sessionId = this.createStudySessionId()
    const session: StudySession = {
      id: sessionId,
      userId,
      level: input.level,
      subject: input.subject,
      mode: input.mode,
      questionIds: selection.questions.map(({ id }) => id),
      status: 'IN_PROGRESS',
      startedAt,
      submittedAt: null,
      durationSec: null
    }

    this.sessionById.set(sessionId, session)
    this.sessionMetadataById.set(sessionId, {
      ...(input.canonicalContractVersion
        ? { canonicalContractVersion: input.canonicalContractVersion }
        : {}),
      ...(!userId && input.canonicalGuestPrincipalId
        ? { canonicalGuestPrincipalId: input.canonicalGuestPrincipalId }
        : {}),
      creationOrder: this.sequence,
      requestedCount,
      usedFallback: selection.usedFallback
    })
    if (!userId && input.canonicalGuestPrincipalId) {
      this.activeCanonicalGuestPrincipalIds.add(input.canonicalGuestPrincipalId)
    }
    this.sessionQuestionSnapshotsById.set(sessionId, clone(selection.questions))
    if (input.canonicalContractVersion === 2) {
      this.canonicalDraftBySessionId.set(sessionId, {
        studySessionId: sessionId,
        revision: 0,
        currentOrdinal: 1,
        savedAt: null,
        answers: selection.questions.map((_, index) => ({
          studySessionQuestionId: getCanonicalSessionQuestionId(
            sessionId,
            index + 1
          ),
          selectedOptionId: null,
          elapsedSec: 0
        }))
      })
    }
    this.persist()

    return this.buildStudySessionPayload(
      session,
      input.canonicalContractVersion !== undefined
    )
  }

  getStudySession(sessionId: string): StudySession {
    const session = this.sessionById.get(sessionId)

    if (!session) {
      throw new MockDatabaseError('NOT_FOUND', 404, '학습 세션이 없습니다.')
    }

    this.assertCurrentSessionOwner(session)

    return clone(session)
  }

  getStudySessionPayload(sessionId: string): StudySessionPayload {
    this.assertLegacyStudySession(sessionId)
    return this.buildStudySessionPayload(this.getStudySession(sessionId))
  }

  getStudySessionSnapshotRecord(
    sessionId: string
  ): MockStudySessionSnapshotRecord {
    this.assertLegacyStudySession(sessionId)
    const session = this.getStudySession(sessionId)
    const metadata = this.sessionMetadataById.get(session.id) ?? {
      requestedCount: session.questionIds.length,
      usedFallback: false
    }

    return {
      session,
      requestedCount: metadata.requestedCount,
      questions: this.getSessionQuestionSnapshot(session)
    }
  }

  getCanonicalStudySessionSnapshotRecord(
    sessionId: string,
    guestPrincipalId: string | null
  ): MockStudySessionSnapshotRecord {
    const session = this.sessionById.get(sessionId)

    if (!session) {
      throw new MockDatabaseError('NOT_FOUND', 404, '학습 세션이 없습니다.')
    }

    const metadata = this.sessionMetadataById.get(session.id)
    if (!metadata || !isCanonicalSessionMetadata(metadata)) {
      throw new MockDatabaseError(
        'NOT_FOUND',
        404,
        'canonical 학습 세션이 아닙니다.'
      )
    }
    this.resolveCanonicalOwner(session, metadata, guestPrincipalId)
    const canonicalStatus = this.observeCanonicalStatus(session, metadata)

    return {
      ...(canonicalStatus === 'CANCELLED' || canonicalStatus === 'EXPIRED'
        ? { canonicalStatus }
        : {}),
      practiceContractVersion: metadata?.canonicalContractVersion,
      session: clone(session),
      requestedCount: metadata?.requestedCount ?? session.questionIds.length,
      questions: this.getSessionQuestionSnapshot(session)
    }
  }

  listCanonicalResumableStudySessions(
    guestPrincipalId: string | null,
    page = 1,
    pageSize = 20
  ): ListResumableStudySessionsResponse {
    const normalized = normalizePagination(page, pageSize)
    const currentUser = this.getCurrentUser()
    if (!currentUser) {
      if (!guestPrincipalId) {
        throw new MockDatabaseError(
          'AUTH_REQUIRED',
          401,
          '재개 가능한 세션을 조회하려면 인증 정보가 필요합니다.'
        )
      }
      if (!this.activeCanonicalGuestPrincipalIds.has(guestPrincipalId)) {
        throw new MockDatabaseError(
          'AUTH_REQUIRED',
          401,
          '게스트 세션이 만료됐습니다.'
        )
      }
    }

    const rows: Array<{
      draft: StudyDraftSnapshot | null
      session: StudySession
      summary: ResumableStudySessionSummary
    }> = []
    for (const session of this.sessionById.values()) {
      const metadata = this.sessionMetadataById.get(session.id)
      if (!metadata?.canonicalContractVersion) {
        continue
      }
      const owned = currentUser
        ? session.userId === currentUser.id
        : session.userId === null &&
          metadata.canonicalGuestPrincipalId === guestPrincipalId
      if (
        !owned ||
        this.getEffectiveCanonicalStatus(session, metadata) !== 'IN_PROGRESS'
      ) {
        continue
      }

      const draft = this.canonicalDraftBySessionId.get(session.id) ?? null
      if (metadata.canonicalContractVersion === 2 && !draft) {
        throw new MockDatabaseError(
          'PERSISTENCE_FAILED',
          500,
          'v2 학습 세션 draft가 완전하지 않습니다.'
        )
      }
      const startedAtMs = Date.parse(session.startedAt)
      const summary: ResumableStudySessionSummary = {
        id: session.id,
        level: session.level,
        subject: session.subject,
        mode: session.mode,
        status: 'IN_PROGRESS',
        actualCount: session.questionIds.length,
        startedAt: session.startedAt,
        expiresAt: new Date(startedAtMs + 24 * 60 * 60 * 1_000).toISOString(),
        practiceContractVersion: metadata.canonicalContractVersion,
        draftRevision: draft?.revision ?? null,
        draftSavedAt: draft?.savedAt ?? null,
        currentOrdinal: draft?.currentOrdinal ?? null,
        resumeAvailability:
          metadata.canonicalContractVersion === 1
            ? 'LEGACY_LOCAL_ONLY'
            : 'SERVER'
      }
      rows.push({ draft, session, summary })
    }

    rows.sort((left, right) => {
      const leftSavedAt = left.draft?.savedAt
      const rightSavedAt = right.draft?.savedAt
      if (leftSavedAt !== rightSavedAt) {
        if (leftSavedAt === null || leftSavedAt === undefined) return 1
        if (rightSavedAt === null || rightSavedAt === undefined) return -1
        return rightSavedAt.localeCompare(leftSavedAt)
      }
      return (
        right.session.startedAt.localeCompare(left.session.startedAt) ||
        left.session.id.localeCompare(right.session.id)
      )
    })

    return {
      items: paginate(rows, normalized.page, normalized.pageSize).map(
        ({ summary }) => clone(summary)
      ),
      total: rows.length,
      page: normalized.page,
      pageSize: normalized.pageSize
    }
  }

  getCanonicalStudyDraft(
    sessionId: string,
    guestPrincipalId: string | null
  ): StudyDraftSnapshot {
    const snapshot = this.getCanonicalStudySessionSnapshotRecord(
      sessionId,
      guestPrincipalId
    )
    if (snapshot.practiceContractVersion !== 2) {
      throw new MockDatabaseError(
        'PRACTICE_CONTRACT_VERSION_MISMATCH',
        409,
        'v2 학습 세션에서만 server draft를 조회할 수 있습니다.'
      )
    }
    if (snapshot.canonicalStatus || snapshot.session.status !== 'IN_PROGRESS') {
      throw new MockDatabaseError(
        'STUDY_SESSION_NOT_EDITABLE',
        409,
        '현재 상태에서는 학습 draft를 조회할 수 없습니다.'
      )
    }
    const draft = this.canonicalDraftBySessionId.get(sessionId)
    if (!draft) {
      throw new MockDatabaseError(
        'PERSISTENCE_FAILED',
        500,
        'v2 학습 세션 draft가 완전하지 않습니다.'
      )
    }
    return clone(draft)
  }

  saveCanonicalStudyDraft(
    input: SaveCanonicalStudyDraftInput
  ): SaveCanonicalStudyDraftResult {
    const snapshot = this.getCanonicalStudySessionSnapshotRecord(
      input.sessionId,
      input.guestPrincipalId
    )
    const session = this.sessionById.get(input.sessionId)
    const metadata = this.sessionMetadataById.get(input.sessionId)
    if (!session || !metadata) {
      throw new MockDatabaseError(
        'PERSISTENCE_FAILED',
        500,
        'canonical 학습 세션 상태가 완전하지 않습니다.'
      )
    }
    const owner = this.resolveCanonicalOwner(
      session,
      metadata,
      input.guestPrincipalId
    )
    const orderedSessionQuestionIds = snapshot.questions.map((_, index) =>
      getCanonicalSessionQuestionId(session.id, index + 1)
    )
    const requestMaterial = canonicalizeMockStudyDraftSave(
      session.id,
      orderedSessionQuestionIds,
      input.body
    )
    const recordKey = makeCanonicalIdempotencyKey(
      owner.principalKind,
      owner.principalId,
      'study.saveStudyDraftAnswers',
      input.idempotencyKey
    )
    const observedAt = this.now()
    const storedRecord = this.canonicalIdempotencyRecordByKey.get(recordKey)
    const existingRecord =
      storedRecord &&
      isCanonicalIdempotencyRecordActive(storedRecord, observedAt)
        ? storedRecord
        : undefined
    if (existingRecord) {
      if (
        existingRecord.operation !== 'study.saveStudyDraftAnswers' ||
        existingRecord.contractVersion !== 2 ||
        existingRecord.requestMaterial !== requestMaterial
      ) {
        throw new MockDatabaseError(
          'IDEMPOTENCY_KEY_REUSED',
          409,
          '같은 멱등 키를 다른 draft 요청에 사용할 수 없습니다.'
        )
      }
      return { replayed: true, response: clone(existingRecord.response) }
    }

    if (metadata.canonicalContractVersion !== 2) {
      throw new MockDatabaseError(
        'PRACTICE_CONTRACT_VERSION_MISMATCH',
        409,
        'v2 학습 세션에서만 server draft를 저장할 수 있습니다.'
      )
    }
    if (metadata.canonicalTerminalStatus || session.status !== 'IN_PROGRESS') {
      throw new MockDatabaseError(
        'STUDY_SESSION_NOT_EDITABLE',
        409,
        '현재 상태에서는 학습 draft를 저장할 수 없습니다.'
      )
    }
    const currentDraft = this.canonicalDraftBySessionId.get(session.id)
    if (!currentDraft) {
      throw new MockDatabaseError(
        'PERSISTENCE_FAILED',
        500,
        'v2 학습 세션 draft가 완전하지 않습니다.'
      )
    }
    if (input.body.expectedRevision !== currentDraft.revision) {
      throw new MockDatabaseError(
        'DRAFT_VERSION_CONFLICT',
        409,
        '학습 draft revision이 현재 서버 상태와 다릅니다.'
      )
    }
    const answerById = new Map(
      input.body.answers.map((answer) => [
        answer.studySessionQuestionId,
        answer
      ])
    )
    if (
      answerById.size !== orderedSessionQuestionIds.length ||
      input.body.answers.length !== orderedSessionQuestionIds.length ||
      orderedSessionQuestionIds.some((id) => !answerById.has(id))
    ) {
      throw new MockDatabaseError(
        'ANSWER_NOT_IN_SESSION',
        422,
        '모든 세션 문제의 draft 답안을 정확히 한 번씩 저장해야 합니다.'
      )
    }
    const answers = snapshot.questions.map((question, index) => {
      const studySessionQuestionId = orderedSessionQuestionIds[index]
      const answer = answerById.get(studySessionQuestionId)
      if (!studySessionQuestionId || !answer) {
        throw new MockDatabaseError(
          'ANSWER_NOT_IN_SESSION',
          422,
          '모든 세션 문제의 draft 답안을 정확히 한 번씩 저장해야 합니다.'
        )
      }
      const optionIds = new Set(
        toContractPracticeQuestion(
          toPracticeQuestion(question),
          getQuestionVersionFingerprint(question)
        ).options.map(({ id }) => id)
      )
      if (
        answer.selectedOptionId !== null &&
        !optionIds.has(answer.selectedOptionId)
      ) {
        throw new MockDatabaseError(
          'OPTION_NOT_IN_VERSION',
          422,
          '선택한 보기가 고정된 문제 version에 속하지 않습니다.'
        )
      }
      return clone(answer)
    })
    const savedAt = observedAt
    const response: StudyDraftSnapshot = {
      studySessionId: session.id,
      revision: currentDraft.revision + 1,
      currentOrdinal: input.body.currentOrdinal,
      savedAt,
      answers
    }
    const record: MockCanonicalDraftIdempotencyRecord = {
      completedAt: savedAt,
      contractVersion: 2,
      expiresAt: getCanonicalIdempotencyExpiresAt(
        savedAt,
        'study.saveStudyDraftAnswers'
      ),
      idempotencyKey: input.idempotencyKey,
      operation: 'study.saveStudyDraftAnswers',
      principalId: owner.principalId,
      principalKind: owner.principalKind,
      requestMaterial,
      response: clone(response),
      responseStatus: 200,
      sessionId: session.id
    }
    this.canonicalDraftBySessionId.set(session.id, response)
    this.canonicalIdempotencyRecordByKey.set(recordKey, record)
    this.persist()
    return { replayed: false, response: clone(response) }
  }

  cancelCanonicalStudySession(
    sessionId: string,
    guestPrincipalId: string | null
  ): void {
    this.getCanonicalStudySessionSnapshotRecord(sessionId, guestPrincipalId)
    const session = this.sessionById.get(sessionId)
    const metadata = this.sessionMetadataById.get(sessionId)
    if (!session || !metadata) {
      throw new MockDatabaseError(
        'PERSISTENCE_FAILED',
        500,
        'canonical 학습 세션 상태가 완전하지 않습니다.'
      )
    }
    if (metadata.canonicalTerminalStatus === 'CANCELLED') {
      return
    }
    if (
      metadata.canonicalTerminalStatus === 'EXPIRED' ||
      session.status !== 'IN_PROGRESS'
    ) {
      throw new MockDatabaseError(
        'STUDY_SESSION_NOT_EDITABLE',
        409,
        '현재 상태에서는 학습 세션을 취소할 수 없습니다.'
      )
    }
    metadata.canonicalTerminalStatus = 'CANCELLED'
    this.canonicalDraftBySessionId.delete(session.id)
    this.persist()
  }

  submitCanonicalStudySession(
    input: SubmitCanonicalStudySessionInput,
    operations: MockCanonicalSubmissionOperations
  ): SubmitCanonicalStudySessionResult {
    const contractVersion = input.contractVersion ?? 1
    const snapshot = this.getCanonicalStudySessionSnapshotRecord(
      input.sessionId,
      input.guestPrincipalId
    )
    const session = this.sessionById.get(input.sessionId)
    const metadata = this.sessionMetadataById.get(input.sessionId)
    if (!session || !metadata) {
      throw new MockDatabaseError(
        'PERSISTENCE_FAILED',
        500,
        'canonical 학습 세션 상태가 완전하지 않습니다.'
      )
    }
    const owner = this.resolveCanonicalOwner(
      session,
      metadata,
      input.guestPrincipalId
    )
    const requestMaterial = operations.canonicalize(snapshot, input.body)
    const recordKey = makeCanonicalIdempotencyKey(
      owner.principalKind,
      owner.principalId,
      'study.submitStudySession',
      input.idempotencyKey
    )
    const observedAt = this.now()
    const storedRecord = this.canonicalIdempotencyRecordByKey.get(recordKey)
    const existingRecord =
      storedRecord &&
      isCanonicalIdempotencyRecordActive(storedRecord, observedAt)
        ? storedRecord
        : undefined
    if (existingRecord) {
      if (
        existingRecord.operation !== 'study.submitStudySession' ||
        existingRecord.contractVersion !== contractVersion ||
        existingRecord.requestMaterial !== requestMaterial
      ) {
        throw new MockDatabaseError(
          'IDEMPOTENCY_KEY_REUSED',
          409,
          '같은 멱등 키를 다른 제출 요청에 사용할 수 없습니다.'
        )
      }
      return { replayed: true, response: clone(existingRecord.response) }
    }

    if (metadata.canonicalContractVersion !== contractVersion) {
      throw new MockDatabaseError(
        'PRACTICE_CONTRACT_VERSION_MISMATCH',
        409,
        '학습 세션 contract version이 요청과 다릅니다.'
      )
    }

    if (snapshot.canonicalStatus) {
      throw new MockDatabaseError(
        'STUDY_SESSION_NOT_EDITABLE',
        409,
        '현재 상태에서는 학습 세션을 제출할 수 없습니다.'
      )
    }

    const observedAtMs = Date.parse(observedAt)
    const startedAtMs = Date.parse(session.startedAt)
    if (!Number.isFinite(observedAtMs) || !Number.isFinite(startedAtMs)) {
      throw new MockDatabaseError(
        'PERSISTENCE_FAILED',
        500,
        '학습 세션 시간이 올바르지 않습니다.'
      )
    }
    if (session.status === 'SUBMITTED') {
      throw new MockDatabaseError(
        'SESSION_SUBMITTED',
        409,
        '이미 제출한 학습 세션입니다.'
      )
    }
    if (
      session.status !== 'IN_PROGRESS' ||
      observedAtMs >= startedAtMs + 24 * 60 * 60 * 1_000
    ) {
      throw new MockDatabaseError(
        'STUDY_SESSION_NOT_EDITABLE',
        409,
        '현재 상태에서는 학습 세션을 제출할 수 없습니다.'
      )
    }

    if (contractVersion === 2) {
      const draft = this.canonicalDraftBySessionId.get(session.id)
      const expectedDraftRevision =
        'expectedDraftRevision' in input.body
          ? input.body.expectedDraftRevision
          : null
      if (!draft || expectedDraftRevision !== draft.revision) {
        throw new MockDatabaseError(
          'DRAFT_VERSION_CONFLICT',
          409,
          '학습 draft revision이 현재 서버 상태와 다릅니다.'
        )
      }
      if (!this.hasMatchingDraftAnswers(draft, input.body.answers)) {
        throw new MockDatabaseError(
          'DRAFT_SUBMIT_MISMATCH',
          422,
          '제출 답안이 저장된 draft와 다릅니다.'
        )
      }
    }

    const canonicalWrongNoteByQuestionId = owner.userId
      ? new Map(
          this.reconstructCanonicalWrongNotes(owner.userId).map((record) => [
            record.sourceQuestionId,
            record
          ])
        )
      : new Map<string, MockCanonicalWrongNoteRecord>()

    let submittedAtMs = Math.max(observedAtMs, startedAtMs)
    if (owner.userId) {
      for (const question of snapshot.questions) {
        const previous = canonicalWrongNoteByQuestionId.get(question.id)
        if (previous) {
          const previousUpdatedAtMs = Date.parse(previous.updatedAt)
          if (!Number.isFinite(previousUpdatedAtMs)) {
            throw new MockDatabaseError(
              'PERSISTENCE_FAILED',
              500,
              '오답 상태 시간이 올바르지 않습니다.'
            )
          }
          submittedAtMs = Math.max(submittedAtMs, previousUpdatedAtMs + 1)
        }
      }
    }
    const submittedAt = new Date(submittedAtMs).toISOString()
    const grading = operations.grade(snapshot, input.body, submittedAt)
    const answerBySessionQuestionId = new Map(
      input.body.answers.map((answer) => [
        answer.studySessionQuestionId,
        answer
      ])
    )
    const answers = grading.items.map((item) => {
      const answer = answerBySessionQuestionId.get(item.studySessionQuestionId)
      if (!answer) {
        throw new MockDatabaseError(
          'PERSISTENCE_FAILED',
          500,
          '채점된 답안 projection이 완전하지 않습니다.'
        )
      }
      return {
        id: toStableMockUuid('study-answer', item.studySessionQuestionId),
        answeredAt: submittedAt,
        elapsedSec: item.elapsedSec,
        isCorrect: item.isCorrect,
        questionVersionId: item.questionVersionId,
        selectedOptionId: answer.selectedOptionId,
        sessionId: session.id,
        sourceQuestionId: item.sourceQuestionId,
        studySessionQuestionId: item.studySessionQuestionId
      } satisfies MockCanonicalStudyAnswerRecord
    })
    const answerRecordBySessionQuestionId = new Map(
      answers.map((answer) => [answer.studySessionQuestionId, answer])
    )
    const wrongNotePlan = this.planCanonicalWrongNoteUpdates(
      owner.userId,
      session.mode,
      grading.items,
      answerRecordBySessionQuestionId,
      canonicalWrongNoteByQuestionId,
      submittedAt
    )
    const response = operations.toResult(
      grading,
      wrongNotePlan.statusBySessionQuestionId
    )
    const idempotencyRecord: MockCanonicalIdempotencyRecord = {
      completedAt: submittedAt,
      contractVersion,
      expiresAt: getCanonicalIdempotencyExpiresAt(
        submittedAt,
        'study.submitStudySession'
      ),
      idempotencyKey: input.idempotencyKey,
      operation: 'study.submitStudySession',
      principalId: owner.principalId,
      principalKind: owner.principalKind,
      requestMaterial,
      response,
      responseStatus: 201,
      sessionId: session.id
    }

    for (const event of wrongNotePlan.events) {
      this.canonicalReviewEventByStudyAnswerId.set(
        event.studyAnswerId ?? event.id,
        event
      )
    }
    session.status = 'SUBMITTED'
    session.submittedAt = submittedAt
    session.durationSec = response.durationSec
    this.canonicalAnswerBySessionId.set(session.id, answers)
    this.canonicalResultBySessionId.set(session.id, response)
    if (contractVersion === 2) {
      this.canonicalDraftBySessionId.delete(session.id)
    }
    this.canonicalIdempotencyRecordByKey.set(recordKey, idempotencyRecord)
    this.persist()

    return { replayed: false, response: clone(response) }
  }

  getCanonicalStudyResult(
    sessionId: string,
    guestPrincipalId: string | null
  ): CanonicalStudyResult {
    const { session } = this.getCanonicalStudySessionSnapshotRecord(
      sessionId,
      guestPrincipalId
    )
    const result = this.canonicalResultBySessionId.get(sessionId)
    if (!result && session.status !== 'SUBMITTED') {
      throw new MockDatabaseError(
        'STUDY_RESULT_NOT_READY',
        409,
        '아직 제출 결과가 준비되지 않았습니다.'
      )
    }
    if (!result) {
      throw new MockDatabaseError(
        'PERSISTENCE_FAILED',
        500,
        '제출된 학습 세션의 결과가 완전하지 않습니다.'
      )
    }
    return clone(result)
  }

  createCanonicalResultRetry(
    input: CreateCanonicalResultRetryInput
  ): CreateCanonicalResultRetryResult {
    const source = this.getCanonicalStudySessionSnapshotRecord(
      input.sourceSessionId,
      input.guestPrincipalId
    )
    const sourceSession = this.sessionById.get(input.sourceSessionId)
    const sourceMetadata = this.sessionMetadataById.get(input.sourceSessionId)
    if (!sourceSession || !sourceMetadata) {
      throw new MockDatabaseError(
        'PERSISTENCE_FAILED',
        500,
        'canonical 원본 학습 세션 상태가 완전하지 않습니다.'
      )
    }
    const owner = this.resolveCanonicalOwner(
      sourceSession,
      sourceMetadata,
      input.guestPrincipalId
    )
    const requestMaterial = `study-result-retry-v1\n${input.sourceSessionId}`
    const recordKey = makeCanonicalIdempotencyKey(
      owner.principalKind,
      owner.principalId,
      'study.createResultRetrySession',
      input.idempotencyKey
    )
    const observedAt = this.now()
    const storedRecord = this.canonicalIdempotencyRecordByKey.get(recordKey)
    const existingRecord =
      storedRecord &&
      isCanonicalIdempotencyRecordActive(storedRecord, observedAt)
        ? storedRecord
        : undefined
    if (existingRecord) {
      if (
        existingRecord.operation !== 'study.createResultRetrySession' ||
        existingRecord.contractVersion !== 2 ||
        existingRecord.principalKind !== owner.principalKind ||
        existingRecord.principalId !== owner.principalId ||
        existingRecord.requestMaterial !== requestMaterial ||
        existingRecord.sourceSessionId !== input.sourceSessionId
      ) {
        throw new MockDatabaseError(
          'IDEMPOTENCY_KEY_REUSED',
          409,
          '같은 멱등 키를 다른 결과 재시도 요청에 사용할 수 없습니다.'
        )
      }
      const targetSession = this.sessionById.get(existingRecord.sessionId)
      const targetMetadata = this.sessionMetadataById.get(
        existingRecord.sessionId
      )
      const targetQuestions = this.sessionQuestionSnapshotsById.get(
        existingRecord.sessionId
      )
      const targetDraft = this.canonicalDraftBySessionId.get(
        existingRecord.sessionId
      )
      const sourceResult = this.canonicalResultBySessionId.get(
        input.sourceSessionId
      )
      if (
        !targetSession ||
        !targetMetadata ||
        !isCanonicalSessionMetadata(targetMetadata) ||
        !targetQuestions ||
        targetMetadata.canonicalContractVersion !== 2 ||
        targetMetadata.retryOfStudySessionId !== input.sourceSessionId ||
        targetMetadata.canonicalGuestPrincipalId !==
          sourceMetadata.canonicalGuestPrincipalId ||
        targetSession.userId !== sourceSession.userId ||
        targetSession.mode !== (owner.userId ? 'WRONG_NOTE' : 'RANDOM') ||
        targetSession.questionIds.length !== targetQuestions.length ||
        targetSession.questionIds.some(
          (questionId, index) => questionId !== targetQuestions[index]?.id
        )
      ) {
        return throwCanonicalIntegrityError(
          '재출제 IdempotencyRecord의 target provenance가 손상되었습니다.'
        )
      }
      let previousSourceOrdinal = 0
      targetQuestions.forEach((targetQuestion, index) => {
        const sourceIndex = source.questions.findIndex(
          ({ id }) => id === targetQuestion.id
        )
        const sourceResultItem = sourceResult?.items[sourceIndex]
        if (
          sourceIndex < previousSourceOrdinal ||
          !sourceResultItem ||
          sourceResultItem.isCorrect ||
          sourceResultItem.question.id !==
            getContractQuestionId(targetQuestion.id) ||
          sourceResultItem.question.questionVersionId !==
            getCanonicalQuestionVersionId(targetQuestion) ||
          targetSession.questionIds[index] !== targetQuestion.id
        ) {
          return throwCanonicalIntegrityError(
            '재출제 target이 source 오답의 historical pin과 다릅니다.'
          )
        }
        assertCanonicalProjectionEqual(
          targetQuestion,
          source.questions[sourceIndex],
          '재출제 target 문제 snapshot이 source historical pin과 다릅니다.'
        )
        previousSourceOrdinal = sourceIndex + 1
      })
      if (
        this.getEffectiveCanonicalStatus(targetSession, targetMetadata) ===
          'IN_PROGRESS' &&
        (!targetDraft ||
          targetDraft.studySessionId !== targetSession.id ||
          targetDraft.answers.length !== targetQuestions.length ||
          targetDraft.answers.some(
            ({ studySessionQuestionId }, index) =>
              studySessionQuestionId !==
              getCanonicalSessionQuestionId(targetSession.id, index + 1)
          ))
      ) {
        return throwCanonicalIntegrityError(
          '진행 중인 재출제 target의 revision draft가 손상되었습니다.'
        )
      }
      const expectedResponse = toVersionedContractStudySessionPayload(
        {
          practiceContractVersion: 2,
          session: {
            ...targetSession,
            status: 'IN_PROGRESS',
            submittedAt: null,
            durationSec: null
          },
          requestedCount: targetMetadata.requestedCount,
          questions: targetQuestions
        },
        new Date(existingRecord.completedAt)
      )
      assertCanonicalProjectionEqual(
        existingRecord.response,
        expectedResponse,
        '재출제 IdempotencyRecord response가 target snapshot과 다릅니다.'
      )
      return { replayed: true, response: clone(existingRecord.response) }
    }

    if (source.session.status !== 'SUBMITTED') {
      throw new MockDatabaseError(
        'STUDY_RESULT_NOT_READY',
        409,
        '제출이 완료된 학습 결과에서만 다시 풀 수 있습니다.'
      )
    }
    const result = this.getCanonicalStudyResult(
      input.sourceSessionId,
      input.guestPrincipalId
    )
    const sourceAnswers = this.canonicalAnswerBySessionId.get(
      input.sourceSessionId
    )
    const answerBySessionQuestionId = new Map(
      sourceAnswers?.map((answer) => [answer.studySessionQuestionId, answer]) ??
        []
    )
    if (
      result.totalCount !== source.questions.length ||
      result.items.length !== source.questions.length ||
      !sourceAnswers ||
      sourceAnswers.length !== source.questions.length ||
      answerBySessionQuestionId.size !== source.questions.length ||
      result.correctCount + result.incorrectCount !== result.totalCount ||
      result.correctCount !==
        result.items.filter(({ isCorrect }) => isCorrect).length ||
      result.incorrectCount !==
        result.items.filter(({ isCorrect }) => !isCorrect).length
    ) {
      throw new MockDatabaseError(
        'PERSISTENCE_FAILED',
        500,
        '원본 결과와 고정된 문제 snapshot의 개수가 다릅니다.'
      )
    }

    const selectedQuestions = source.questions.flatMap((question, index) => {
      const resultItem = result.items[index]
      const expectedSessionQuestionId = getCanonicalSessionQuestionId(
        source.session.id,
        index + 1
      )
      const answer = answerBySessionQuestionId.get(expectedSessionQuestionId)
      const reviewedQuestion = toCanonicalReviewedQuestion(question)
      const isCorrect =
        answer?.selectedOptionId !== null &&
        answer?.selectedOptionId === reviewedQuestion.correctOptionId
      if (
        !resultItem ||
        !answer ||
        resultItem.sessionQuestionId !== expectedSessionQuestionId ||
        resultItem.question.id !== getContractQuestionId(question.id) ||
        resultItem.question.questionVersionId !==
          getCanonicalQuestionVersionId(question) ||
        answer.sessionId !== source.session.id ||
        answer.sourceQuestionId !== question.id ||
        answer.studySessionQuestionId !== expectedSessionQuestionId ||
        answer.questionVersionId !== getCanonicalQuestionVersionId(question) ||
        (answer.selectedOptionId !== null &&
          !reviewedQuestion.options.some(
            ({ id }) => id === answer.selectedOptionId
          )) ||
        answer.isCorrect !== isCorrect ||
        resultItem.selectedOptionId !== answer.selectedOptionId ||
        resultItem.isCorrect !== isCorrect
      ) {
        return throwCanonicalIntegrityError(
          '원본 결과가 고정된 session question과 다릅니다.'
        )
      }
      assertCanonicalProjectionEqual(
        resultItem.question,
        toCanonicalReviewedQuestion(question),
        '원본 결과의 문제 snapshot이 고정 version과 다릅니다.'
      )
      if (resultItem.isCorrect) {
        return []
      }
      const currentQuestion = this.questionById.get(question.id)
      return currentQuestion ? [clone(question)] : []
    })
    if (selectedQuestions.length === 0) {
      throw new MockDatabaseError(
        'NO_ELIGIBLE_QUESTIONS',
        404,
        '현재 다시 풀 수 있는 오답이 없습니다.'
      )
    }
    if (
      new Set(selectedQuestions.map(({ id }) => id)).size !==
      selectedQuestions.length
    ) {
      throw new MockDatabaseError(
        'PERSISTENCE_FAILED',
        500,
        '재시도 후보에 같은 문제가 중복되었습니다.'
      )
    }

    const sessionId = this.createStudySessionId()
    const session: StudySession = {
      id: sessionId,
      userId: owner.userId,
      level: source.session.level,
      subject: source.session.subject,
      mode: owner.userId ? 'WRONG_NOTE' : 'RANDOM',
      questionIds: selectedQuestions.map(({ id }) => id),
      status: 'IN_PROGRESS',
      startedAt: observedAt,
      submittedAt: null,
      durationSec: null
    }
    const metadata: SessionMetadata = {
      canonicalContractVersion: 2,
      ...(owner.principalKind === 'GUEST'
        ? { canonicalGuestPrincipalId: owner.principalId }
        : {}),
      creationOrder: this.sequence,
      retryOfStudySessionId: source.session.id,
      requestedCount: result.incorrectCount,
      usedFallback: false
    }
    const draft: StudyDraftSnapshot = {
      studySessionId: session.id,
      revision: 0,
      currentOrdinal: 1,
      savedAt: null,
      answers: selectedQuestions.map((_, index) => ({
        studySessionQuestionId: getCanonicalSessionQuestionId(
          session.id,
          index + 1
        ),
        selectedOptionId: null,
        elapsedSec: 0
      }))
    }
    const response = toVersionedContractStudySessionPayload(
      {
        practiceContractVersion: 2,
        session,
        requestedCount: result.incorrectCount,
        questions: selectedQuestions
      },
      new Date(observedAt)
    )
    const idempotencyRecord: MockCanonicalRetryIdempotencyRecord = {
      completedAt: observedAt,
      contractVersion: 2,
      expiresAt: getCanonicalIdempotencyExpiresAt(
        observedAt,
        'study.createResultRetrySession'
      ),
      idempotencyKey: input.idempotencyKey,
      operation: 'study.createResultRetrySession',
      principalId: owner.principalId,
      principalKind: owner.principalKind,
      requestMaterial,
      response: clone(response),
      responseStatus: 201,
      sessionId,
      sourceSessionId: source.session.id
    }

    this.sessionById.set(session.id, session)
    this.sessionMetadataById.set(session.id, metadata)
    this.sessionQuestionSnapshotsById.set(session.id, clone(selectedQuestions))
    this.canonicalDraftBySessionId.set(session.id, draft)
    this.canonicalIdempotencyRecordByKey.set(recordKey, idempotencyRecord)
    this.persist()

    return { replayed: false, response: clone(response) }
  }

  createCanonicalTargetedReview(
    input: CreateCanonicalTargetedReviewInput
  ): CreateCanonicalTargetedReviewResult {
    this.assertCanonicalReadOwner(input.userId)
    const observedAt = this.now()
    const requestMaterial = createTargetedReviewSessionCanonicalMaterial(
      input.questionId
    )
    const recordKey = makeCanonicalIdempotencyKey(
      'USER',
      input.userId,
      'wrongNote.createTargetedReviewSession',
      input.idempotencyKey
    )
    const storedRecord = this.canonicalIdempotencyRecordByKey.get(recordKey)
    let existingRecord: MockCanonicalTargetedReviewIdempotencyRecord | undefined
    if (storedRecord) {
      if (
        storedRecord.operation !== 'wrongNote.createTargetedReviewSession' ||
        storedRecord.principalKind !== 'USER' ||
        storedRecord.principalId !== input.userId ||
        storedRecord.idempotencyKey !== input.idempotencyKey ||
        storedRecord.responseStatus !== 201 ||
        storedRecord.expiresAt !==
          getCanonicalIdempotencyExpiresAt(
            storedRecord.completedAt,
            storedRecord.operation
          )
      ) {
        return throwCanonicalIntegrityError(
          'targeted 복습 IdempotencyRecord envelope가 손상되었습니다.'
        )
      }
      if (isCanonicalIdempotencyRecordActive(storedRecord, observedAt)) {
        existingRecord = storedRecord
      } else {
        this.canonicalIdempotencyRecordByKey.delete(recordKey)
      }
    }
    if (existingRecord) {
      if (
        existingRecord.contractVersion !== 2 ||
        existingRecord.requestMaterial !== requestMaterial
      ) {
        throw new MockDatabaseError(
          'IDEMPOTENCY_KEY_REUSED',
          409,
          '같은 멱등 키를 다른 targeted 복습 요청에 사용할 수 없습니다.'
        )
      }
      if (existingRecord.questionId !== input.questionId) {
        return throwCanonicalIntegrityError(
          'targeted 복습 IdempotencyRecord question provenance가 손상되었습니다.'
        )
      }
      const targetSession = this.sessionById.get(existingRecord.sessionId)
      const targetMetadata = this.sessionMetadataById.get(
        existingRecord.sessionId
      )
      const targetQuestions = this.sessionQuestionSnapshotsById.get(
        existingRecord.sessionId
      )
      const targetDraft = this.canonicalDraftBySessionId.get(
        existingRecord.sessionId
      )
      const targetQuestion = targetQuestions?.[0]
      if (
        !targetSession ||
        !targetMetadata ||
        !isCanonicalSessionMetadata(targetMetadata) ||
        !targetQuestions ||
        !targetQuestion ||
        targetMetadata.canonicalContractVersion !== 2 ||
        targetMetadata.canonicalGuestPrincipalId !== undefined ||
        targetMetadata.retryOfStudySessionId !== undefined ||
        targetMetadata.requestedCount !== 1 ||
        targetMetadata.usedFallback ||
        targetSession.userId !== input.userId ||
        targetSession.mode !== 'WRONG_NOTE' ||
        targetSession.questionIds.length !== 1 ||
        targetQuestions.length !== 1 ||
        targetSession.questionIds[0] !== targetQuestion.id ||
        getContractQuestionId(targetQuestion.id) !== input.questionId
      ) {
        return throwCanonicalIntegrityError(
          'targeted 복습 IdempotencyRecord의 target provenance가 손상되었습니다.'
        )
      }
      if (
        this.getEffectiveCanonicalStatus(targetSession, targetMetadata) ===
          'IN_PROGRESS' &&
        (!targetDraft ||
          this.canonicalAnswerBySessionId.has(existingRecord.sessionId) ||
          this.canonicalResultBySessionId.has(existingRecord.sessionId) ||
          [...this.canonicalReviewEventByStudyAnswerId.values()].some(
            (event) => event.studySessionId === existingRecord.sessionId
          ) ||
          targetDraft.revision !== 0 ||
          targetDraft.currentOrdinal !== 1 ||
          targetDraft.savedAt !== null ||
          targetDraft.answers.length !== 1 ||
          targetDraft.answers[0]?.studySessionQuestionId !==
            getCanonicalSessionQuestionId(targetSession.id, 1) ||
          targetDraft.answers[0]?.selectedOptionId !== null ||
          targetDraft.answers[0]?.elapsedSec !== 0)
      ) {
        return throwCanonicalIntegrityError(
          '진행 중인 targeted 복습 target의 revision draft가 손상되었습니다.'
        )
      }
      const expectedResponse =
        createTargetedReviewSessionResponseForQuestionSchema(
          input.questionId
        ).parse(
          toVersionedContractStudySessionPayload(
            {
              practiceContractVersion: 2,
              session: {
                ...targetSession,
                status: 'IN_PROGRESS',
                submittedAt: null,
                durationSec: null
              },
              requestedCount: 1,
              questions: targetQuestions
            },
            new Date(existingRecord.completedAt)
          )
        )
      assertCanonicalProjectionEqual(
        existingRecord.response,
        expectedResponse,
        'targeted 복습 IdempotencyRecord response가 target snapshot과 다릅니다.'
      )
      return { replayed: true, response: clone(existingRecord.response) }
    }
    const wrongNote = this.getCanonicalWrongNoteRecord(
      input.userId,
      input.questionId
    )
    const currentQuestion = this.questionById.get(wrongNote.sourceQuestionId)
    if (
      !currentQuestion ||
      currentQuestion.status !== 'PUBLISHED' ||
      getContractQuestionId(currentQuestion.id) !== input.questionId
    ) {
      throw new MockDatabaseError(
        'QUESTION_NOT_AVAILABLE',
        422,
        '현재 복습할 수 없는 문제입니다.'
      )
    }

    const sessionId = this.createStudySessionId()
    const session: StudySession = {
      id: sessionId,
      userId: input.userId,
      level: currentQuestion.level,
      subject: currentQuestion.subject,
      mode: 'WRONG_NOTE',
      questionIds: [currentQuestion.id],
      status: 'IN_PROGRESS',
      startedAt: observedAt,
      submittedAt: null,
      durationSec: null
    }
    const metadata: SessionMetadata = {
      canonicalContractVersion: 2,
      creationOrder: this.sequence,
      requestedCount: 1,
      usedFallback: false
    }
    const questions = [clone(currentQuestion)]
    const draft: StudyDraftSnapshot = {
      studySessionId: session.id,
      revision: 0,
      currentOrdinal: 1,
      savedAt: null,
      answers: [
        {
          studySessionQuestionId: getCanonicalSessionQuestionId(session.id, 1),
          selectedOptionId: null,
          elapsedSec: 0
        }
      ]
    }
    const response = createTargetedReviewSessionResponseForQuestionSchema(
      input.questionId
    ).parse(
      toVersionedContractStudySessionPayload(
        {
          practiceContractVersion: 2,
          session,
          requestedCount: 1,
          questions
        },
        new Date(observedAt)
      )
    )
    const idempotencyRecord: MockCanonicalTargetedReviewIdempotencyRecord = {
      completedAt: observedAt,
      contractVersion: 2,
      expiresAt: getCanonicalIdempotencyExpiresAt(
        observedAt,
        'wrongNote.createTargetedReviewSession'
      ),
      idempotencyKey: input.idempotencyKey,
      operation: 'wrongNote.createTargetedReviewSession',
      principalId: input.userId,
      principalKind: 'USER',
      questionId: input.questionId,
      requestMaterial,
      response: clone(response),
      responseStatus: 201,
      sessionId
    }

    this.sessionById.set(session.id, session)
    this.sessionMetadataById.set(session.id, metadata)
    this.sessionQuestionSnapshotsById.set(session.id, questions)
    this.canonicalDraftBySessionId.set(session.id, draft)
    this.canonicalIdempotencyRecordByKey.set(recordKey, idempotencyRecord)
    this.persist()

    return { replayed: false, response: clone(response) }
  }

  listCanonicalWrongNoteRecords(
    userId: string
  ): MockCanonicalWrongNoteRecord[] {
    this.assertCanonicalReadOwner(userId)
    return clone(this.reconstructCanonicalWrongNotes(userId))
  }

  getCanonicalWrongNoteRecord(
    userId: string,
    contractQuestionId: string
  ): MockCanonicalWrongNoteRecord {
    this.assertCanonicalReadOwner(userId)
    const matches = this.reconstructCanonicalWrongNotes(userId).filter(
      ({ sourceQuestionId }) =>
        getContractQuestionId(sourceQuestionId) === contractQuestionId
    )
    if (matches.length !== 1) {
      throw new MockDatabaseError(
        'NOT_FOUND',
        404,
        '오답 노트를 찾을 수 없습니다.'
      )
    }

    return clone(matches[0])
  }

  listCanonicalReviewQueue(
    userId: string,
    query: ParsedListReviewQueueQuery
  ): ListReviewQueueResponse {
    this.assertCanonicalReadOwner(userId)
    const observedAt = this.now()
    const observedAtMs = Date.parse(observedAt)
    const allCandidates = this.reconstructCanonicalWrongNotes(userId).flatMap(
      (note): ReviewQueueItem[] => {
        const question = this.questionById.get(note.sourceQuestionId)
        if (!question || question.status !== 'PUBLISHED') {
          return []
        }
        const tags = [...new Set(question.tags)].toSorted(
          compareWrongNoteTagLabels
        )
        const characters = [...question.questionText]
        const questionPreview =
          characters.length <= 160
            ? question.questionText
            : `${characters.slice(0, 157).join('')}...`
        return [
          {
            questionId: getContractQuestionId(question.id),
            currentQuestionVersionId: getCanonicalQuestionVersionId(question),
            level: question.level,
            subject: question.subject,
            questionType: question.questionType,
            questionPreview,
            tags,
            status: note.status,
            wrongCount: note.wrongCount,
            correctStreak: note.correctStreak,
            lastWrongAt: note.lastWrongAt,
            lastReviewedAt: note.lastReviewedAt,
            nextReviewAt: note.nextReviewAt,
            hasMemo: this.canonicalUserMemoByWrongNoteId.has(note.wrongNoteId)
          }
        ]
      }
    )
    const matchesBase = (item: ReviewQueueItem, includeTag: boolean): boolean =>
      (query.level === undefined || item.level === query.level) &&
      (query.subject === undefined || item.subject === query.subject) &&
      (query.questionType === undefined ||
        item.questionType === query.questionType) &&
      (!includeTag || query.tag === undefined || item.tags.includes(query.tag))
    const base = allCandidates.filter((item) => matchesBase(item, true))
    const isDue = (item: ReviewQueueItem): boolean =>
      Date.parse(item.nextReviewAt) <= observedAtMs
    const matchesView = (item: ReviewQueueItem): boolean => {
      switch (query.view) {
        case 'DUE':
          return isDue(item)
        case 'UNREVIEWED':
          return item.lastReviewedAt === null
        case 'REPEATED':
          return item.wrongCount >= 2
        case 'SOLVED':
          return item.status === 'SOLVED'
      }
    }
    const selected = base
      .filter(matchesView)
      .toSorted((left, right) =>
        compareReviewQueueItems(left, right, query.sort)
      )
    const offset = (BigInt(query.page) - 1n) * BigInt(query.pageSize)
    const items =
      offset >= BigInt(selected.length)
        ? []
        : selected.slice(Number(offset), Number(offset) + query.pageSize)
    const availableTags = [
      ...new Set(
        allCandidates
          .filter((item) => matchesBase(item, false))
          .flatMap(({ tags }) => tags)
      )
    ].toSorted(compareWrongNoteTagLabels)

    return clone({
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: selected.length,
      counts: {
        due: base.filter(isDue).length,
        unreviewed: base.filter(({ lastReviewedAt }) => lastReviewedAt === null)
          .length,
        repeated: base.filter(({ wrongCount }) => wrongCount >= 2).length,
        solved: base.filter(({ status }) => status === 'SOLVED').length
      },
      availableTags,
      observedAt
    })
  }

  getCanonicalUserMemo(
    userId: string,
    contractQuestionId: string
  ): UserMemo | null {
    const note = this.getCanonicalWrongNoteRecord(userId, contractQuestionId)
    const memo = this.canonicalUserMemoByWrongNoteId.get(note.wrongNoteId)
    return memo
      ? clone({
          questionId: contractQuestionId,
          text: memo.text,
          createdAt: memo.createdAt,
          updatedAt: memo.updatedAt
        })
      : null
  }

  updateCanonicalUserMemo(
    userId: string,
    contractQuestionId: string,
    text: string | null
  ): UserMemo | null {
    const note = this.getCanonicalWrongNoteRecord(userId, contractQuestionId)
    const existing = this.canonicalUserMemoByWrongNoteId.get(note.wrongNoteId)
    if (text === null) {
      if (existing) {
        this.canonicalUserMemoByWrongNoteId.delete(note.wrongNoteId)
        this.persist()
      }
      return null
    }
    if (existing?.text === text) {
      return this.getCanonicalUserMemo(userId, contractQuestionId)
    }
    const observedAt = this.now()
    const updatedAt = existing
      ? new Date(
          Math.max(Date.parse(existing.updatedAt), Date.parse(observedAt))
        ).toISOString()
      : observedAt
    this.canonicalUserMemoByWrongNoteId.set(note.wrongNoteId, {
      wrongNoteId: note.wrongNoteId,
      text,
      createdAt: existing?.createdAt ?? observedAt,
      updatedAt
    })
    this.persist()
    return this.getCanonicalUserMemo(userId, contractQuestionId)
  }

  listCanonicalReviewEvents(
    userId: string,
    contractQuestionId: string
  ): ReviewEventHistoryItem[] {
    const note = this.getCanonicalWrongNoteRecord(userId, contractQuestionId)
    const answerById = new Map(
      [...this.canonicalAnswerBySessionId.values()]
        .flat()
        .map((answer) => [answer.id, answer])
    )
    return clone(
      [...this.canonicalReviewEventByStudyAnswerId.values()]
        .filter(
          (event) =>
            event.userId === userId && event.wrongNoteId === note.wrongNoteId
        )
        .toSorted(
          (left, right) =>
            Date.parse(
              toCanonicalIsoInstant(right.occurredAt, 'ReviewEvent.occurredAt')
            ) -
              Date.parse(
                toCanonicalIsoInstant(left.occurredAt, 'ReviewEvent.occurredAt')
              ) || right.id.localeCompare(left.id)
        )
        .map((event) => {
          const occurredAt = toCanonicalIsoInstant(
            event.occurredAt,
            'ReviewEvent.occurredAt'
          )
          if (event.source === 'VERSION_REBASE') {
            if (
              event.studySessionId !== null ||
              event.studyAnswerId !== null ||
              event.selectedOptionId !== null ||
              event.isCorrect !== null
            ) {
              throwCanonicalIntegrityError(
                'VERSION_REBASE ReviewEvent evidence가 비어 있지 않습니다.'
              )
            }
            return {
              id: event.id,
              source: event.source,
              questionVersionId: event.questionVersionId,
              selectedOptionId: null,
              isCorrect: null,
              elapsedSec: null,
              previousStatus: event.previousStatus,
              nextStatus: event.nextStatus,
              previousCorrectStreak: event.previousCorrectStreak,
              nextCorrectStreak: event.nextCorrectStreak,
              previousWrongCount: event.previousWrongCount,
              wrongCountAfter: event.wrongCountAfter,
              algorithmVersion: event.algorithmVersion,
              occurredAt
            }
          }
          if (
            event.studyAnswerId === null ||
            event.studySessionId === null ||
            event.isCorrect === null
          ) {
            throwCanonicalIntegrityError(
              'answer-backed ReviewEvent evidence가 완전하지 않습니다.'
            )
          }
          const answer = answerById.get(event.studyAnswerId)
          if (!answer) {
            throwCanonicalIntegrityError(
              'canonical ReviewEvent의 StudyAnswer evidence가 없습니다.'
            )
          }
          return {
            id: event.id,
            source: event.source,
            questionVersionId: event.questionVersionId,
            selectedOptionId: event.selectedOptionId,
            isCorrect: event.isCorrect,
            elapsedSec: answer.elapsedSec,
            previousStatus: event.previousStatus,
            nextStatus: event.nextStatus,
            previousCorrectStreak: event.previousCorrectStreak,
            nextCorrectStreak: event.nextCorrectStreak,
            previousWrongCount: event.previousWrongCount,
            wrongCountAfter: event.wrongCountAfter,
            algorithmVersion: event.algorithmVersion,
            occurredAt
          }
        })
    )
  }

  getCanonicalDashboardRecord(userId: string): MockCanonicalDashboardRecord {
    this.assertCanonicalReadOwner(userId)
    const submissions = this.getCanonicalUserSubmissionEvidence(userId)
    const wrongNotes = this.reconstructCanonicalWrongNotes(userId, submissions)

    return clone({
      observedAt: this.now(),
      sessions: submissions.map(({ result, session }) => ({
        id: session.id,
        level: result.level,
        subject: result.subject,
        mode: result.mode,
        totalCount: result.totalCount,
        correctCount: result.correctCount,
        durationSec: result.durationSec,
        submittedAt: result.submittedAt
      })),
      wrongNotes
    })
  }

  getCanonicalStudyAnswerRecords(
    sessionId: string
  ): MockCanonicalStudyAnswerRecord[] {
    return clone(this.canonicalAnswerBySessionId.get(sessionId) ?? [])
  }

  getCanonicalReviewEventRecords(
    sessionId?: string
  ): MockCanonicalReviewEventRecord[] {
    return clone(
      [...this.canonicalReviewEventByStudyAnswerId.values()]
        .filter(
          (event) =>
            sessionId === undefined || event.studySessionId === sessionId
        )
        .toSorted(
          (left, right) =>
            Date.parse(
              toCanonicalIsoInstant(left.occurredAt, 'ReviewEvent.occurredAt')
            ) -
              Date.parse(
                toCanonicalIsoInstant(
                  right.occurredAt,
                  'ReviewEvent.occurredAt'
                )
              ) || left.id.localeCompare(right.id)
        )
    )
  }

  getCanonicalIdempotencyRecords(): MockCanonicalIdempotencyRecord[] {
    return clone([...this.canonicalIdempotencyRecordByKey.values()])
  }

  hasCanonicalStudyResultRecord(sessionId: string): boolean {
    return this.canonicalResultBySessionId.has(sessionId)
  }

  getPracticeQuestionsForSession(sessionId: string): PracticeQuestion[] {
    return this.getStudySessionPayload(sessionId).questions
  }

  submitStudySession(input: SubmitStudySessionInput): StudyResult {
    const session = this.sessionById.get(input.sessionId)

    if (!session) {
      throw new MockDatabaseError('NOT_FOUND', 404, '학습 세션이 없습니다.')
    }
    this.assertLegacyStudySession(session.id)
    this.assertCurrentSessionOwner(session)
    if (session.status === 'SUBMITTED') {
      throw new MockDatabaseError(
        'SESSION_SUBMITTED',
        409,
        '이미 제출한 학습 세션입니다.'
      )
    }

    const questions = this.getSessionQuestionSnapshot(session)
    const result = calculateStudyResult({
      sessionId: session.id,
      questions,
      answers: input.answers,
      durationSec: input.durationSec
    })
    const submittedAt = this.now()

    session.status = 'SUBMITTED'
    session.submittedAt = submittedAt
    session.durationSec = result.durationSec
    this.resultBySessionId.set(session.id, result)

    if (session.userId) {
      this.applyResultToWrongNotes(session.userId, result, submittedAt)
    }

    this.persist()
    return clone(result)
  }

  getStudyResult(sessionId: string): StudyResult {
    const session = this.sessionById.get(sessionId)
    if (!session) {
      throw new MockDatabaseError('NOT_FOUND', 404, '학습 세션이 없습니다.')
    }
    this.assertLegacyStudySession(session.id)
    this.assertCurrentSessionOwner(session)

    const result = this.resultBySessionId.get(sessionId)

    if (!result) {
      throw new MockDatabaseError('NOT_FOUND', 404, '학습 결과가 없습니다.')
    }

    return clone(result)
  }

  listWrongNotes(
    userId: string,
    filters: WrongNoteListFilters = {}
  ): WrongNoteListResult {
    this.assertUser(userId)
    const { page, pageSize } = normalizePagination(
      filters.page,
      filters.pageSize
    )
    const tagSet = new Set<string>()
    const items: WrongNoteListItem[] = []

    for (const wrongNote of this.wrongNoteByQuestionId.values()) {
      if (wrongNote.userId !== userId) {
        continue
      }

      const question = this.questionById.get(wrongNote.questionId)
      if (!question || question.status !== 'PUBLISHED') {
        continue
      }

      for (const tag of question.tags) {
        tagSet.add(tag)
      }

      if (filters.level && question.level !== filters.level) {
        continue
      }
      if (filters.subject && question.subject !== filters.subject) {
        continue
      }
      if (filters.status && wrongNote.status !== filters.status) {
        continue
      }
      if (filters.tag && !question.tags.includes(filters.tag)) {
        continue
      }

      items.push({
        wrongNote: clone(wrongNote),
        question: toWrongNoteSummary(question)
      })
    }

    const sortedItems = this.sortWrongNotes(items, filters.sort ?? 'RECENT')

    return {
      items: paginate(sortedItems, page, pageSize),
      total: sortedItems.length,
      page,
      pageSize,
      availableTags: [...tagSet].toSorted((left, right) =>
        left.localeCompare(right, 'ko')
      )
    }
  }

  getWrongNote(userId: string, questionId: string): WrongNoteDetail {
    this.assertUser(userId)
    const wrongNote = this.wrongNoteByQuestionId.get(
      makeUserQuestionKey(userId, questionId)
    )

    if (!wrongNote) {
      throw new MockDatabaseError('NOT_FOUND', 404, '오답을 찾을 수 없습니다.')
    }

    const question = this.getQuestion(questionId)
    if (question.status !== 'PUBLISHED') {
      throw new MockDatabaseError('NOT_FOUND', 404, '오답을 찾을 수 없습니다.')
    }

    return {
      wrongNote: clone(wrongNote),
      question
    }
  }

  updateWrongNoteMemo(
    userId: string,
    questionId: string,
    memo: string | null
  ): WrongNoteDetail {
    const detail = this.getWrongNote(userId, questionId)
    const normalizedMemo = memo?.trim() || null
    const updated: WrongNote = {
      ...detail.wrongNote,
      memo: normalizedMemo,
      updatedAt: this.now()
    }

    this.wrongNoteByQuestionId.set(
      makeUserQuestionKey(userId, questionId),
      updated
    )
    this.persist()

    return {
      wrongNote: clone(updated),
      question: detail.question
    }
  }

  reviewWrongNote(
    userId: string,
    questionId: string,
    isCorrect: boolean
  ): WrongNoteReviewResult {
    const { wrongNote } = this.getWrongNote(userId, questionId)
    const reviewedAt = this.now()
    const updated = isCorrect
      ? updateWrongNoteAfterCorrectReview(wrongNote, reviewedAt)
      : updateWrongNoteAfterIncorrectAnswer(wrongNote, reviewedAt)

    this.wrongNoteByQuestionId.set(
      makeUserQuestionKey(userId, questionId),
      updated
    )
    this.persist()

    return { wrongNote: clone(updated), isCorrect }
  }

  listBookmarks(userId: string): BookmarkListResult {
    this.assertUser(userId)
    const items: BookmarkListItem[] = []

    for (const bookmark of this.bookmarkByQuestionId.values()) {
      if (bookmark.userId !== userId) {
        continue
      }

      const question = this.questionById.get(bookmark.questionId)
      if (!question || question.status !== 'PUBLISHED') {
        continue
      }

      items.push({
        bookmark: clone(bookmark),
        question: toPracticeQuestion(question)
      })
    }

    const sortedItems = items.toSorted((left, right) =>
      right.bookmark.createdAt.localeCompare(left.bookmark.createdAt)
    )

    return { items: sortedItems, total: sortedItems.length }
  }

  resolveCanonicalQuestionId(contractQuestionId: string): string | null {
    for (const question of [
      ...this.questionById.values(),
      ...this.archivedQuestionById.values()
    ]) {
      if (getContractQuestionId(question.id) === contractQuestionId) {
        return question.id
      }
    }
    return null
  }

  listCanonicalBookmarkSources(
    userId: string
  ): CanonicalBookmarkSourceRecord[] {
    this.assertUser(userId)
    const sources: CanonicalBookmarkSourceRecord[] = []
    for (const bookmark of this.bookmarkByQuestionId.values()) {
      if (bookmark.userId !== userId) continue
      const active = this.questionById.get(bookmark.questionId)
      const archived = this.archivedQuestionById.get(bookmark.questionId)
      const question = active?.status === 'PUBLISHED' ? active : archived
      if (!question) {
        throw new MockDatabaseError(
          'PERSISTENCE_FAILED',
          500,
          '즐겨찾기 문제 snapshot을 찾을 수 없습니다.'
        )
      }
      sources.push({
        bookmark: clone(bookmark),
        question: clone(question),
        availability: active?.status === 'PUBLISHED' ? 'AVAILABLE' : 'ARCHIVED'
      })
    }
    return sources.toSorted(
      (left, right) =>
        right.bookmark.createdAt.localeCompare(left.bookmark.createdAt) ||
        left.bookmark.id.localeCompare(right.bookmark.id)
    )
  }

  createCanonicalBookmark(
    userId: string,
    questionId: string
  ): { created: boolean; source: CanonicalBookmarkSourceRecord } {
    this.assertUser(userId)
    const key = makeUserQuestionKey(userId, questionId)
    const existing = this.bookmarkByQuestionId.get(key)
    const active = this.questionById.get(questionId)
    const archived = this.archivedQuestionById.get(questionId)
    if (existing) {
      const question = active?.status === 'PUBLISHED' ? active : archived
      if (!question) {
        throw new MockDatabaseError(
          'PERSISTENCE_FAILED',
          500,
          '즐겨찾기 문제 snapshot을 찾을 수 없습니다.'
        )
      }
      return {
        created: false,
        source: {
          bookmark: clone(existing),
          question: clone(question),
          availability:
            active?.status === 'PUBLISHED' ? 'AVAILABLE' : 'ARCHIVED'
        }
      }
    }
    if (!active && !archived) {
      throw new MockDatabaseError('NOT_FOUND', 404, '문제를 찾을 수 없습니다.')
    }
    if (!active || active.status !== 'PUBLISHED') {
      throw new MockDatabaseError(
        'INVALID_INPUT',
        422,
        '현재 공개 중인 문제만 즐겨찾기에 추가할 수 있습니다.'
      )
    }
    const bookmark: Bookmark = {
      id: this.createId('bookmark'),
      userId,
      questionId,
      createdAt: this.now()
    }
    this.bookmarkByQuestionId.set(key, bookmark)
    this.persist()
    return {
      created: true,
      source: {
        bookmark: clone(bookmark),
        question: clone(active),
        availability: 'AVAILABLE'
      }
    }
  }

  createBookmark(userId: string, questionId: string): BookmarkListItem {
    this.assertUser(userId)
    const question = this.questionById.get(questionId)

    if (!question || question.status !== 'PUBLISHED') {
      throw new MockDatabaseError('NOT_FOUND', 404, '문제를 찾을 수 없습니다.')
    }

    const key = makeUserQuestionKey(userId, questionId)
    const existing = this.bookmarkByQuestionId.get(key)

    if (existing) {
      return {
        bookmark: clone(existing),
        question: toPracticeQuestion(question)
      }
    }

    const bookmark: Bookmark = {
      id: this.createId('bookmark'),
      userId,
      questionId,
      createdAt: this.now()
    }
    this.bookmarkByQuestionId.set(key, bookmark)
    this.persist()

    return {
      bookmark: clone(bookmark),
      question: toPracticeQuestion(question)
    }
  }

  deleteBookmark(userId: string, questionId: string): boolean {
    this.assertUser(userId)
    const deleted = this.bookmarkByQuestionId.delete(
      makeUserQuestionKey(userId, questionId)
    )

    if (deleted) {
      this.persist()
    }

    return deleted
  }

  getDashboardStats(userId: string): DashboardStats {
    this.assertUser(userId)
    const subjectAccumulator = new Map<
      QuestionSubject,
      { answeredCount: number; correctCount: number }
    >(
      SUBJECTS.map((subject) => [
        subject,
        { answeredCount: 0, correctCount: 0 }
      ])
    )
    const recentStudySessions: DashboardStats['recentStudySessions'] = []
    let totalAnsweredCount = 0
    let correctCount = 0

    for (const session of this.sessionById.values()) {
      if (session.userId !== userId || session.status !== 'SUBMITTED') {
        continue
      }

      const result = this.resultBySessionId.get(session.id)
      if (!result || !session.submittedAt) {
        continue
      }

      totalAnsweredCount += result.totalCount
      correctCount += result.correctCount
      const accumulator = subjectAccumulator.get(session.subject)
      if (accumulator) {
        accumulator.answeredCount += result.totalCount
        accumulator.correctCount += result.correctCount
      }

      recentStudySessions.push({
        id: session.id,
        level: session.level,
        subject: session.subject,
        mode: session.mode,
        totalCount: result.totalCount,
        correctCount: result.correctCount,
        correctRate: result.correctRate,
        durationSec: result.durationSec,
        submittedAt: session.submittedAt
      })
    }

    const subjectStats = SUBJECTS.map((subject) => {
      const value = subjectAccumulator.get(subject) ?? {
        answeredCount: 0,
        correctCount: 0
      }
      return {
        subject,
        answeredCount: value.answeredCount,
        correctCount: value.correctCount,
        correctRate:
          value.answeredCount === 0
            ? 0
            : Math.round((value.correctCount / value.answeredCount) * 100)
      }
    })
    let weakestSubject: QuestionSubject | null = null
    let weakestRate = Number.POSITIVE_INFINITY

    for (const stat of subjectStats) {
      if (
        stat.answeredCount >= MIN_WEAKNESS_ATTEMPTS &&
        stat.correctRate < weakestRate
      ) {
        weakestSubject = stat.subject
        weakestRate = stat.correctRate
      }
    }

    const userWrongNotes: WrongNote[] = []
    for (const wrongNote of this.wrongNoteByQuestionId.values()) {
      const question = this.questionById.get(wrongNote.questionId)
      if (wrongNote.userId === userId && question?.status === 'PUBLISHED') {
        userWrongNotes.push(wrongNote)
      }
    }

    return {
      totalAnsweredCount,
      correctCount,
      correctRate:
        totalAnsweredCount === 0
          ? 0
          : Math.round((correctCount / totalAnsweredCount) * 100),
      wrongNoteCount: userWrongNotes.length,
      solvedWrongNoteCount: userWrongNotes.reduce(
        (count, note) => count + (note.status === 'SOLVED' ? 1 : 0),
        0
      ),
      weakestSubject,
      subjectStats,
      recentStudySessions: recentStudySessions
        .toSorted((left, right) =>
          right.submittedAt.localeCompare(left.submittedAt)
        )
        .slice(0, RECENT_SESSION_LIMIT),
      dailyStudyCountLast7Days: this.getDailyStudyCounts(userId),
      repeatedWrongQuestions: userWrongNotes
        .toSorted((left, right) => right.wrongCount - left.wrongCount)
        .slice(0, REPEATED_WRONG_LIMIT)
        .flatMap((wrongNote) => {
          const question = this.questionById.get(wrongNote.questionId)
          return question
            ? [
                {
                  questionId: question.id,
                  questionText: question.questionText,
                  level: question.level,
                  subject: question.subject,
                  wrongCount: wrongNote.wrongCount
                }
              ]
            : []
        })
    }
  }

  listAdminQuestions(
    filters: AdminQuestionListFilters = {}
  ): AdminQuestionListResult {
    const { page, pageSize } = normalizePagination(
      filters.page,
      filters.pageSize
    )
    const search = filters.search?.trim().toLocaleLowerCase()
    const matches: QuestionRecord[] = []

    for (const question of this.questionById.values()) {
      if (filters.level && question.level !== filters.level) {
        continue
      }
      if (filters.subject && question.subject !== filters.subject) {
        continue
      }
      if (filters.status && question.status !== filters.status) {
        continue
      }
      if (filters.difficulty && question.difficulty !== filters.difficulty) {
        continue
      }
      if (
        search &&
        !`${question.id} ${question.questionText} ${question.tags.join(' ')}`
          .toLocaleLowerCase()
          .includes(search)
      ) {
        continue
      }

      matches.push(question)
    }

    const sorted = this.sortAdminQuestions(matches, filters.sort ?? 'RECENT')

    return {
      items: paginate(sorted, page, pageSize).map(toAdminSummary),
      total: sorted.length,
      page,
      pageSize
    }
  }

  getAdminQuestion(questionId: string): QuestionRecord {
    return this.getQuestion(questionId)
  }

  createQuestion(input: AdminQuestionInput): QuestionRecord {
    const questionId = this.createId('question')
    const timestamp = this.now()
    const question = this.buildQuestionRecord(
      questionId,
      input,
      timestamp,
      timestamp
    )
    this.questionById.set(questionId, question)
    this.persist()
    return clone(question)
  }

  updateQuestion(
    questionId: string,
    input: AdminQuestionInput
  ): QuestionRecord {
    const existing = this.questionById.get(questionId)

    if (!existing) {
      throw new MockDatabaseError('NOT_FOUND', 404, '문제를 찾을 수 없습니다.')
    }

    if (existing.status === 'PUBLISHED' && input.status !== 'PUBLISHED') {
      this.archivedQuestionById.set(questionId, clone(existing))
    }

    const question = this.buildQuestionRecord(
      questionId,
      input,
      existing.createdAt,
      this.now()
    )
    this.questionById.set(questionId, question)
    this.persist()
    return clone(question)
  }

  deleteQuestion(questionId: string): boolean {
    const existing = this.questionById.get(questionId)
    if (!existing || !this.questionById.delete(questionId)) {
      throw new MockDatabaseError('NOT_FOUND', 404, '문제를 찾을 수 없습니다.')
    }
    if (
      existing.status === 'PUBLISHED' ||
      !this.archivedQuestionById.has(questionId)
    ) {
      this.archivedQuestionById.set(questionId, clone(existing))
    }

    this.persist()
    return true
  }

  reset(): void {
    this.storage.removeItem(MOCK_DATABASE_STORAGE_KEY)
    this.currentUserId = null
    this.resetMemoryToSeed()
  }

  private resetMemoryToSeed(): void {
    this.questionById = new Map(
      mockSeedData.questions.map((question) => [question.id, clone(question)])
    )
    this.archivedQuestionById.clear()
    this.sessionById.clear()
    this.sessionMetadataById.clear()
    this.sessionQuestionSnapshotsById.clear()
    this.canonicalAnswerBySessionId.clear()
    this.canonicalResultBySessionId.clear()
    this.canonicalDraftBySessionId.clear()
    this.canonicalReviewEventByStudyAnswerId.clear()
    this.canonicalIdempotencyRecordByKey.clear()
    this.canonicalUserMemoByWrongNoteId.clear()
    this.activeCanonicalGuestPrincipalIds.clear()
    this.resultBySessionId.clear()
    this.wrongNoteByQuestionId.clear()
    this.bookmarkByQuestionId.clear()
  }

  private selectQuestions(
    input: CreateStudySessionInput,
    eligible: QuestionRecord[],
    userId: string | null
  ): { questions: QuestionRecord[]; usedFallback: boolean } {
    const count = Math.min(20, Math.max(1, Math.trunc(input.count)))

    if (input.questionIds && input.questionIds.length > 0) {
      if (new Set(input.questionIds).size !== input.questionIds.length) {
        throw new MockDatabaseError(
          'INVALID_INPUT',
          422,
          '같은 문제를 한 세션에 중복 출제할 수 없습니다.'
        )
      }

      const eligibleById = new Map(
        eligible.map((question) => [question.id, question])
      )
      const selected = input.questionIds.map((questionId) => {
        const question = eligibleById.get(questionId)
        if (!question) {
          throw new MockDatabaseError(
            'INVALID_INPUT',
            422,
            `출제 조건에 맞지 않는 문제입니다: ${questionId}`
          )
        }
        return question
      })
      return { questions: selected.slice(0, count), usedFallback: false }
    }

    const candidates = this.getModeCandidates(input, eligible, userId)
    const usedFallback = input.mode !== 'RANDOM' && candidates.length === 0
    const source = usedFallback ? eligible : candidates
    const seed =
      input.seed ?? `${this.randomSeed}:${this.now()}:${this.sequence}`

    return {
      questions: seededShuffle(source, seed).slice(0, count),
      usedFallback
    }
  }

  private selectCanonicalQuestions(
    input: CreateStudySessionInput,
    eligible: QuestionRecord[],
    userId: string | null,
    observedAt: string
  ): { questions: QuestionRecord[]; usedFallback: false } {
    const count = Math.min(20, Math.max(1, Math.trunc(input.count)))
    if (input.questionIds && input.questionIds.length > 0) {
      if (new Set(input.questionIds).size !== input.questionIds.length) {
        throw new MockDatabaseError(
          'INVALID_INPUT',
          422,
          '같은 문제를 한 세션에 중복 출제할 수 없습니다.'
        )
      }
      const eligibleById = new Map(
        eligible.map((question) => [question.id, question])
      )
      const questions = input.questionIds.map((questionId) => {
        const question = eligibleById.get(questionId)
        if (!question) {
          throw new MockDatabaseError(
            'INVALID_INPUT',
            422,
            `출제 조건에 맞지 않는 문제입니다: ${questionId}`
          )
        }
        return question
      })
      return { questions: questions.slice(0, count), usedFallback: false }
    }
    const eligibleById = new Map(
      eligible.map((question) => [question.id, question])
    )
    const toPin = (question: QuestionRecord) => ({
      questionId: question.id,
      questionVersionId: getCanonicalQuestionVersionId(question)
    })
    const belongsToActor = (session: StudySession): boolean => {
      const metadata = this.sessionMetadataById.get(session.id)
      if (metadata?.canonicalContractVersion === undefined) {
        return false
      }
      if (userId) {
        return session.userId === userId
      }
      const guestPrincipalId = input.canonicalGuestPrincipalId
      return (
        guestPrincipalId !== undefined &&
        session.userId === null &&
        metadata.canonicalGuestPrincipalId === guestPrincipalId
      )
    }
    const selectedQuestionIds = (() => {
      if (input.mode === 'RANDOM') {
        const observedAtMs = Date.parse(observedAt)
        const recentSinceMs = observedAtMs - 7 * 24 * 60 * 60 * 1_000
        const recentQuestionIds = new Set(
          [...this.sessionById.values()]
            .filter((session) => {
              const submittedAtMs = Date.parse(session.submittedAt ?? '')
              return (
                belongsToActor(session) &&
                session.status === 'SUBMITTED' &&
                Number.isFinite(submittedAtMs) &&
                submittedAtMs >= recentSinceMs &&
                submittedAtMs <= observedAtMs
              )
            })
            .toSorted(
              (left, right) =>
                (right.submittedAt ?? '').localeCompare(
                  left.submittedAt ?? ''
                ) || left.id.localeCompare(right.id)
            )
            .slice(0, 3)
            .flatMap((session) => session.questionIds)
        )
        const seed =
          input.seed ?? `${this.randomSeed}:${observedAt}:${this.sequence}`
        return selectRandomStudyCandidates(
          eligible.map((question) => ({
            ...toPin(question),
            isRecent: recentQuestionIds.has(question.id)
          })),
          count,
          createSeededRandom(seed)
        ).map(({ questionId }) => questionId)
      }

      if (input.mode === 'WEAKNESS') {
        const recentSessions = [...this.sessionById.values()]
          .filter(
            (session) =>
              belongsToActor(session) &&
              session.level === input.level &&
              session.subject === input.subject &&
              session.status === 'SUBMITTED' &&
              session.submittedAt !== null
          )
          .toSorted(
            (left, right) =>
              (right.submittedAt ?? '').localeCompare(left.submittedAt ?? '') ||
              left.id.localeCompare(right.id)
          )
          .slice(0, WEAKNESS_SESSION_LIMIT)
        const aggregates = new Map<
          string,
          {
            answeredCount: number
            incorrectCount: number
            lastAnsweredAt: Date
          }
        >()
        for (const session of recentSessions) {
          const canonicalAnswers = this.canonicalAnswerBySessionId.get(
            session.id
          )
          if (canonicalAnswers) {
            for (const answer of canonicalAnswers) {
              const question = eligibleById.get(answer.sourceQuestionId)
              if (!question) continue
              const previous = aggregates.get(question.id) ?? {
                answeredCount: 0,
                incorrectCount: 0,
                lastAnsweredAt: new Date(0)
              }
              previous.answeredCount += 1
              previous.incorrectCount += answer.isCorrect ? 0 : 1
              previous.lastAnsweredAt = new Date(
                Math.max(
                  previous.lastAnsweredAt.getTime(),
                  Date.parse(answer.answeredAt)
                )
              )
              aggregates.set(question.id, previous)
            }
            continue
          }
        }
        return selectWeaknessStudyCandidates(
          [...aggregates].flatMap(([questionId, aggregate]) => {
            const question = eligibleById.get(questionId)
            return question &&
              aggregate.answeredCount >= MIN_WEAKNESS_ATTEMPTS &&
              aggregate.incorrectCount >= 1
              ? [{ ...toPin(question), ...aggregate }]
              : []
          }),
          count
        ).map(({ questionId }) => questionId)
      }

      if (!userId) {
        return []
      }
      const canonicalNotes = new Map(
        this.reconstructCanonicalWrongNotes(userId).map((note) => [
          note.sourceQuestionId,
          note
        ])
      )
      if (input.mode === 'WRONG_NOTE') {
        const sourceByContractQuestionId = new Map<string, string>()
        const candidates = new Map<
          string,
          {
            questionId: string
            questionVersionId: string
            lastWrongAt: Date
            wrongCount: number
          }
        >()
        for (const note of canonicalNotes.values()) {
          const question = eligibleById.get(note.sourceQuestionId)
          if (note.status !== 'SOLVED' && question) {
            const contractQuestionId = getContractQuestionId(question.id)
            sourceByContractQuestionId.set(contractQuestionId, question.id)
            candidates.set(contractQuestionId, {
              questionId: contractQuestionId,
              questionVersionId: getCanonicalQuestionVersionId(question),
              lastWrongAt: new Date(note.lastWrongAt),
              wrongCount: note.wrongCount
            })
          }
        }
        return selectWrongNoteStudyCandidates(
          [...candidates.values()],
          count
        ).map(({ questionId }) => {
          const sourceQuestionId = sourceByContractQuestionId.get(questionId)
          if (!sourceQuestionId) {
            throw new MockDatabaseError(
              'PERSISTENCE_FAILED',
              500,
              'WRONG_NOTE 후보의 stable Question ID를 복원할 수 없습니다.'
            )
          }
          return sourceQuestionId
        })
      }

      if (input.mode === 'BOOKMARK') {
        const sourceByContractQuestionId = new Map<string, string>()
        const selected = selectBookmarkStudyCandidates(
          [...this.bookmarkByQuestionId.values()].flatMap((bookmark) => {
            const question = eligibleById.get(bookmark.questionId)
            if (bookmark.userId !== userId || !question) return []
            const contractQuestionId = getContractQuestionId(question.id)
            sourceByContractQuestionId.set(contractQuestionId, question.id)
            return [
              {
                ...toPin(question),
                questionId: contractQuestionId,
                createdAt: new Date(bookmark.createdAt)
              }
            ]
          }),
          count
        )
        return selected.map(({ questionId }) => {
          const sourceQuestionId = sourceByContractQuestionId.get(questionId)
          if (!sourceQuestionId) {
            throw new MockDatabaseError(
              'PERSISTENCE_FAILED',
              500,
              '즐겨찾기 후보의 stable Question ID를 복원할 수 없습니다.'
            )
          }
          return sourceQuestionId
        })
      }

      const observedAtMs = Date.parse(observedAt)
      const sourceByContractQuestionId = new Map<string, string>()
      const candidates = new Map<
        string,
        {
          questionId: string
          questionVersionId: string
          nextReviewAt: Date
          status: WrongNoteStatus
        }
      >()
      for (const note of canonicalNotes.values()) {
        const question = eligibleById.get(note.sourceQuestionId)
        const nextReviewAtMs = Date.parse(note.nextReviewAt)
        if (question && nextReviewAtMs <= observedAtMs) {
          const contractQuestionId = getContractQuestionId(question.id)
          sourceByContractQuestionId.set(contractQuestionId, question.id)
          candidates.set(contractQuestionId, {
            ...toPin(question),
            questionId: contractQuestionId,
            nextReviewAt: new Date(nextReviewAtMs),
            status: note.status
          })
        }
      }
      return selectDailyReviewStudyCandidates(
        [...candidates.values()],
        count
      ).map(({ questionId }) => {
        const sourceQuestionId = sourceByContractQuestionId.get(questionId)
        if (!sourceQuestionId) {
          throw new MockDatabaseError(
            'PERSISTENCE_FAILED',
            500,
            'DAILY_REVIEW 후보의 stable Question ID를 복원할 수 없습니다.'
          )
        }
        return sourceQuestionId
      })
    })()

    const questions = selectedQuestionIds.flatMap((questionId) => {
      const question = eligibleById.get(questionId)
      return question ? [question] : []
    })
    if (questions.length === 0) {
      throw new MockDatabaseError(
        'NOT_FOUND',
        404,
        '선택한 조건에 출제 가능한 문제가 없습니다.'
      )
    }
    return { questions, usedFallback: false }
  }

  private getModeCandidates(
    input: CreateStudySessionInput,
    eligible: QuestionRecord[],
    userId: string | null
  ): QuestionRecord[] {
    if (input.mode === 'RANDOM') {
      return eligible
    }
    if (!userId) {
      return []
    }

    const eligibleById = new Map(
      eligible.map((question) => [question.id, question])
    )

    if (input.mode === 'WRONG_NOTE') {
      const candidates: QuestionRecord[] = []
      for (const wrongNote of this.wrongNoteByQuestionId.values()) {
        if (wrongNote.userId !== userId || wrongNote.status === 'SOLVED') {
          continue
        }
        const question = eligibleById.get(wrongNote.questionId)
        if (question) {
          candidates.push(question)
        }
      }
      return candidates
    }

    if (input.mode === 'BOOKMARK') {
      const candidates: QuestionRecord[] = []
      for (const bookmark of this.bookmarkByQuestionId.values()) {
        if (bookmark.userId !== userId) {
          continue
        }
        const question = eligibleById.get(bookmark.questionId)
        if (question) {
          candidates.push(question)
        }
      }
      return candidates
    }

    const weakestType = this.getWeakestQuestionType(
      userId,
      input.level,
      input.subject
    )
    return weakestType
      ? eligible.filter(({ questionType }) => questionType === weakestType)
      : []
  }

  private getWeakestQuestionType(
    userId: string,
    level: JlptLevel,
    subject: QuestionSubject
  ): QuestionType | null {
    const accumulator = new Map<
      QuestionType,
      { attempts: number; correct: number }
    >()
    const matchingSessions: StudySession[] = []

    for (const session of this.sessionById.values()) {
      if (
        session.userId !== userId ||
        session.level !== level ||
        session.subject !== subject ||
        session.status !== 'SUBMITTED'
      ) {
        continue
      }

      matchingSessions.push(session)
    }

    const recentSessions = matchingSessions
      .toSorted((left, right) =>
        (right.submittedAt ?? '').localeCompare(left.submittedAt ?? '')
      )
      .slice(0, WEAKNESS_SESSION_LIMIT)

    for (const session of recentSessions) {
      const result = this.resultBySessionId.get(session.id)
      if (!result) {
        continue
      }

      for (const item of result.items) {
        const value = accumulator.get(item.question.questionType) ?? {
          attempts: 0,
          correct: 0
        }
        value.attempts += 1
        value.correct += item.isCorrect ? 1 : 0
        accumulator.set(item.question.questionType, value)
      }
    }

    let weakestType: QuestionType | null = null
    let weakestRate = Number.POSITIVE_INFINITY
    for (const [questionType, value] of accumulator) {
      if (value.attempts < MIN_WEAKNESS_ATTEMPTS) {
        continue
      }
      const rate = value.correct / value.attempts
      if (rate < weakestRate) {
        weakestType = questionType
        weakestRate = rate
      }
    }

    return weakestType
  }

  private getEligibleQuestions(
    level: JlptLevel,
    subject: QuestionSubject
  ): QuestionRecord[] {
    const eligible: QuestionRecord[] = []
    for (const question of this.questionById.values()) {
      if (
        question.status === 'PUBLISHED' &&
        question.level === level &&
        question.subject === subject
      ) {
        eligible.push(question)
      }
    }
    return eligible
  }

  private buildStudySessionPayload(
    session: StudySession,
    allowCanonical = false
  ): StudySessionPayload {
    if (!allowCanonical) {
      this.assertLegacyStudySession(session.id)
    }
    const metadata = this.sessionMetadataById.get(session.id) ?? {
      requestedCount: session.questionIds.length,
      usedFallback: false
    }
    const questions =
      this.getSessionQuestionSnapshot(session).map(toPracticeQuestion)

    return {
      session: clone(session),
      questions,
      requestedCount: metadata.requestedCount,
      actualCount: questions.length,
      usedFallback: metadata.usedFallback
    }
  }

  private getCanonicalUserSubmissionEvidence(
    userId: string
  ): MockCanonicalSubmissionEvidence[] {
    this.assertUniqueCanonicalFactKeys()
    const submissions: MockCanonicalSubmissionEvidence[] = []
    const seenAnswerIds = new Set<string>()

    for (const session of this.sessionById.values()) {
      if (session.userId !== userId) {
        continue
      }
      const metadata = this.sessionMetadataById.get(session.id)
      if (metadata?.canonicalContractVersion === undefined) {
        continue
      }
      if (metadata.canonicalGuestPrincipalId !== undefined) {
        throwCanonicalIntegrityError(
          'USER canonical 세션에 guest principal provenance가 섞여 있습니다.'
        )
      }
      const startedAt = toCanonicalIsoInstant(
        session.startedAt,
        'StudySession.startedAt'
      )

      const rawResult = this.canonicalResultBySessionId.get(session.id)
      const rawAnswers = this.canonicalAnswerBySessionId.get(session.id)
      if (session.status === 'IN_PROGRESS') {
        if (rawResult || rawAnswers) {
          throwCanonicalIntegrityError(
            '미제출 canonical 세션에 제출 evidence가 존재합니다.'
          )
        }
        continue
      }
      if (
        session.status !== 'SUBMITTED' ||
        session.submittedAt === null ||
        session.durationSec === null ||
        !Number.isInteger(session.durationSec) ||
        session.durationSec < 0 ||
        session.durationSec > 604_800
      ) {
        throwCanonicalIntegrityError(
          'canonical 제출 세션 상태가 완전하지 않습니다.'
        )
      }
      if (!rawResult || !rawAnswers) {
        throwCanonicalIntegrityError(
          'canonical 제출 세션의 Answer/Result evidence가 없습니다.'
        )
      }
      const questions = this.sessionQuestionSnapshotsById.get(session.id)
      if (
        !questions ||
        questions.length !== session.questionIds.length ||
        questions.length !== rawAnswers.length
      ) {
        throwCanonicalIntegrityError(
          'canonical session snapshot/Answer cardinality가 다릅니다.'
        )
      }
      if (
        new Set(questions.map(({ id }) => id)).size !== questions.length ||
        new Set(questions.map(getCanonicalQuestionVersionId)).size !==
          questions.length
      ) {
        throwCanonicalIntegrityError(
          'canonical session snapshot의 source question/version이 중복됩니다.'
        )
      }
      const parsedResult = canonicalStudyResultSchema.safeParse(rawResult)
      if (!parsedResult.success) {
        throwCanonicalIntegrityError(
          'canonical StudyResult contract evidence가 손상되었습니다.'
        )
      }
      const result = parsedResult.data
      const submittedAt = toCanonicalIsoInstant(
        session.submittedAt,
        'StudySession.submittedAt'
      )
      if (Date.parse(submittedAt) < Date.parse(startedAt)) {
        throwCanonicalIntegrityError(
          'canonical StudySession 제출 시각이 시작 시각보다 빠릅니다.'
        )
      }
      if (
        result.sessionId !== session.id ||
        result.level !== session.level ||
        result.subject !== session.subject ||
        result.mode !== session.mode ||
        toCanonicalIsoInstant(result.submittedAt, 'StudyResult.submittedAt') !==
          submittedAt ||
        result.durationSec !== session.durationSec
      ) {
        throwCanonicalIntegrityError(
          'canonical StudyResult가 고정된 StudySession과 일치하지 않습니다.'
        )
      }
      if (questions.length !== result.items.length) {
        throwCanonicalIntegrityError(
          'canonical session snapshot/Result cardinality가 다릅니다.'
        )
      }
      const answerBySessionQuestionId = new Map(
        rawAnswers.map((answer) => [answer.studySessionQuestionId, answer])
      )
      if (answerBySessionQuestionId.size !== rawAnswers.length) {
        throwCanonicalIntegrityError(
          'canonical StudyAnswer의 session-question provenance가 중복됩니다.'
        )
      }

      const answers = questions.map((question, index) => {
        const sessionQuestionId = getCanonicalSessionQuestionId(
          session.id,
          index + 1
        )
        const answer = answerBySessionQuestionId.get(sessionQuestionId)
        const resultItem = result.items[index]
        const questionVersionId = getCanonicalQuestionVersionId(question)
        if (
          session.questionIds[index] !== question.id ||
          question.status !== 'PUBLISHED' ||
          question.level !== session.level ||
          question.subject !== session.subject ||
          !answer ||
          !resultItem ||
          answer.id !== toStableMockUuid('study-answer', sessionQuestionId) ||
          answer.sessionId !== session.id ||
          answer.sourceQuestionId !== question.id ||
          answer.studySessionQuestionId !== sessionQuestionId ||
          answer.questionVersionId !== questionVersionId ||
          toCanonicalIsoInstant(answer.answeredAt, 'StudyAnswer.answeredAt') !==
            submittedAt ||
          !Number.isInteger(answer.elapsedSec) ||
          answer.elapsedSec < 0 ||
          answer.elapsedSec > 86_400
        ) {
          throwCanonicalIntegrityError(
            'canonical StudyAnswer가 pinned session question과 일치하지 않습니다.'
          )
        }
        if (seenAnswerIds.has(answer.id)) {
          throwCanonicalIntegrityError(
            'canonical StudyAnswer evidence ID가 중복됩니다.'
          )
        }
        seenAnswerIds.add(answer.id)

        const parsedReviewedQuestion =
          canonicalReviewedQuestionSchema.safeParse(
            toCanonicalReviewedQuestion(question)
          )
        if (!parsedReviewedQuestion.success) {
          throwCanonicalIntegrityError(
            'canonical pinned ReviewedQuestion contract가 손상되었습니다.'
          )
        }
        const reviewedQuestion = parsedReviewedQuestion.data
        const optionIds = new Set(reviewedQuestion.options.map(({ id }) => id))
        if (
          answer.selectedOptionId !== null &&
          !optionIds.has(answer.selectedOptionId)
        ) {
          throwCanonicalIntegrityError(
            'canonical StudyAnswer 선택지가 pinned version에 속하지 않습니다.'
          )
        }
        const isCorrect =
          answer.selectedOptionId !== null &&
          answer.selectedOptionId === reviewedQuestion.correctOptionId
        if (
          answer.isCorrect !== isCorrect ||
          resultItem.sessionQuestionId !== sessionQuestionId ||
          resultItem.selectedOptionId !== answer.selectedOptionId ||
          resultItem.isCorrect !== isCorrect
        ) {
          throwCanonicalIntegrityError(
            'canonical Answer/Result 채점 evidence가 서로 다릅니다.'
          )
        }
        assertCanonicalProjectionEqual(
          resultItem.question,
          reviewedQuestion,
          'canonical Result question이 pinned historical snapshot과 다릅니다.'
        )

        return {
          answer: clone({ ...answer, answeredAt: submittedAt }),
          question: clone(question),
          resultItem: clone(resultItem)
        }
      })

      submissions.push({
        answers,
        result: clone(result),
        session: clone({ ...session, submittedAt })
      })
    }

    this.assertCanonicalUserIdempotencyEvidence(userId, submissions)

    return submissions.toSorted(
      (left, right) =>
        (left.session.submittedAt ?? '').localeCompare(
          right.session.submittedAt ?? ''
        ) || left.session.id.localeCompare(right.session.id)
    )
  }

  private assertUniqueCanonicalFactKeys(): void {
    const answerSessionIds = new Set<string>()
    for (const sessionId of this.canonicalAnswerBySessionId.keys()) {
      const canonicalSessionId = fromDuplicatePreservingKey(sessionId)
      if (answerSessionIds.has(canonicalSessionId)) {
        throwCanonicalIntegrityError(
          'canonical StudyAnswer bundle session key가 중복됩니다.'
        )
      }
      answerSessionIds.add(canonicalSessionId)
    }

    const resultSessionIds = new Set<string>()
    for (const result of this.canonicalResultBySessionId.values()) {
      if (resultSessionIds.has(result.sessionId)) {
        throwCanonicalIntegrityError(
          'canonical StudyResult session key가 중복됩니다.'
        )
      }
      resultSessionIds.add(result.sessionId)
    }

    const reviewEventAnswerIds = new Set<string>()
    const reviewEventIds = new Set<string>()
    for (const event of this.canonicalReviewEventByStudyAnswerId.values()) {
      if (reviewEventIds.has(event.id)) {
        throwCanonicalIntegrityError('canonical ReviewEvent ID가 중복됩니다.')
      }
      reviewEventIds.add(event.id)
      if (event.studyAnswerId === null) {
        continue
      }
      if (reviewEventAnswerIds.has(event.studyAnswerId)) {
        throwCanonicalIntegrityError(
          'canonical ReviewEvent study-answer key가 중복됩니다.'
        )
      }
      reviewEventAnswerIds.add(event.studyAnswerId)
    }
  }

  private assertCanonicalUserIdempotencyEvidence(
    userId: string,
    submissions: readonly MockCanonicalSubmissionEvidence[]
  ): void {
    const records = [...this.canonicalIdempotencyRecordByKey.values()]
    const seenCompositeKeys = new Set<string>()
    for (const record of records) {
      if (
        record.expiresAt !==
        getCanonicalIdempotencyExpiresAt(record.completedAt, record.operation)
      ) {
        throwCanonicalIntegrityError(
          'canonical IdempotencyRecord TTL이 operation 정책과 다릅니다.'
        )
      }
      const compositeKey = makeCanonicalIdempotencyKey(
        record.principalKind,
        record.principalId,
        record.operation,
        record.idempotencyKey
      )
      if (seenCompositeKeys.has(compositeKey)) {
        throwCanonicalIntegrityError(
          'canonical IdempotencyRecord composite key가 중복됩니다.'
        )
      }
      seenCompositeKeys.add(compositeKey)
    }

    const submissionBySessionId = new Map(
      submissions.map((submission) => [submission.session.id, submission])
    )
    const consumedSessionIds = new Set<string>()
    const canonicalUuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    const targetedSessionIds = new Set<string>()

    for (const record of records) {
      if (
        record.operation !== 'wrongNote.createTargetedReviewSession' ||
        record.principalId !== userId
      ) {
        continue
      }
      const session = this.sessionById.get(record.sessionId)
      const metadata = this.sessionMetadataById.get(record.sessionId)
      const questions = this.sessionQuestionSnapshotsById.get(record.sessionId)
      const question = questions?.[0]
      const effectiveStatus =
        session && metadata
          ? this.getEffectiveCanonicalStatus(session, metadata)
          : null
      const draft = this.canonicalDraftBySessionId.get(record.sessionId)
      if (
        !session ||
        !metadata ||
        !isCanonicalSessionMetadata(metadata) ||
        !questions ||
        !question ||
        targetedSessionIds.has(record.sessionId) ||
        !canonicalUuidPattern.test(record.idempotencyKey) ||
        record.principalKind !== 'USER' ||
        record.contractVersion !== 2 ||
        record.responseStatus !== 201 ||
        record.requestMaterial !==
          createTargetedReviewSessionCanonicalMaterial(record.questionId) ||
        session.userId !== userId ||
        session.mode !== 'WRONG_NOTE' ||
        session.questionIds.length !== 1 ||
        questions.length !== 1 ||
        session.questionIds[0] !== question.id ||
        getContractQuestionId(question.id) !== record.questionId ||
        metadata.canonicalContractVersion !== 2 ||
        metadata.canonicalGuestPrincipalId !== undefined ||
        metadata.retryOfStudySessionId !== undefined ||
        metadata.requestedCount !== 1 ||
        metadata.usedFallback
      ) {
        throwCanonicalIntegrityError(
          'canonical targeted IdempotencyRecord aggregate가 target evidence와 다릅니다.'
        )
      }
      if (
        effectiveStatus === 'IN_PROGRESS' &&
        (!draft ||
          draft.revision !== 0 ||
          draft.currentOrdinal !== 1 ||
          draft.savedAt !== null ||
          draft.answers.length !== 1 ||
          this.canonicalAnswerBySessionId.has(record.sessionId) ||
          this.canonicalResultBySessionId.has(record.sessionId))
      ) {
        throwCanonicalIntegrityError(
          'canonical targeted target의 initial draft/fact shape가 손상되었습니다.'
        )
      }
      const expectedResponse =
        createTargetedReviewSessionResponseForQuestionSchema(
          record.questionId
        ).parse(
          toVersionedContractStudySessionPayload(
            {
              practiceContractVersion: 2,
              session: {
                ...session,
                status: 'IN_PROGRESS',
                submittedAt: null,
                durationSec: null
              },
              requestedCount: 1,
              questions
            },
            new Date(record.completedAt)
          )
        )
      assertCanonicalProjectionEqual(
        record.response,
        expectedResponse,
        'canonical targeted IdempotencyRecord response가 target과 다릅니다.'
      )
      targetedSessionIds.add(record.sessionId)
    }

    for (const record of records) {
      if (record.operation !== 'study.submitStudySession') {
        continue
      }
      const submission = submissionBySessionId.get(record.sessionId)
      const belongsToUser =
        record.principalKind === 'USER' && record.principalId === userId
      if (!submission && !belongsToUser) {
        continue
      }
      if (!submission || !belongsToUser) {
        throwCanonicalIntegrityError(
          'canonical IdempotencyRecord owner/session provenance가 다릅니다.'
        )
      }
      if (consumedSessionIds.has(record.sessionId)) {
        throwCanonicalIntegrityError(
          'canonical 제출 세션에 IdempotencyRecord가 중복됩니다.'
        )
      }

      const expectedPayload = {
        sessionId: submission.session.id,
        answers: submission.answers.map(({ answer }) => ({
          studySessionQuestionId: answer.studySessionQuestionId,
          selectedOptionId: answer.selectedOptionId,
          elapsedSec: answer.elapsedSec
        })),
        durationSec: submission.result.durationSec
      }
      const expectedRequestMaterial = `submit-v1:${JSON.stringify(expectedPayload)}`
      const hasValidV2RequestMaterial = (() => {
        if (!record.requestMaterial.startsWith('submit-v2:')) {
          return false
        }
        try {
          const parsed: unknown = JSON.parse(
            record.requestMaterial.slice('submit-v2:'.length)
          )
          return (
            isRecord(parsed) &&
            Number.isSafeInteger(parsed.expectedDraftRevision) &&
            parsed.expectedDraftRevision !== undefined &&
            JSON.stringify({
              sessionId: parsed.sessionId,
              answers: parsed.answers,
              durationSec: parsed.durationSec
            }) === JSON.stringify(expectedPayload)
          )
        } catch {
          return false
        }
      })()
      if (
        record.responseStatus !== 201 ||
        !canonicalUuidPattern.test(record.idempotencyKey) ||
        toCanonicalIsoInstant(
          record.completedAt,
          'IdempotencyRecord.completedAt'
        ) !== submission.session.submittedAt ||
        (record.contractVersion === 1
          ? record.requestMaterial !== expectedRequestMaterial
          : !hasValidV2RequestMaterial)
      ) {
        throwCanonicalIntegrityError(
          'canonical IdempotencyRecord aggregate가 제출 evidence와 다릅니다.'
        )
      }
      const parsedResponse = canonicalStudyResultSchema.safeParse(
        record.response
      )
      if (!parsedResponse.success) {
        throwCanonicalIntegrityError(
          'canonical IdempotencyRecord response contract가 손상되었습니다.'
        )
      }
      assertCanonicalProjectionEqual(
        parsedResponse.data,
        submission.result,
        'canonical IdempotencyRecord response가 StudyResult와 다릅니다.'
      )
      consumedSessionIds.add(record.sessionId)
    }
  }

  private getCanonicalReviewPointer(
    userId: string,
    sourceQuestionId: string
  ): string | null {
    const reviewSessions = [...this.sessionById.values()]
      .filter((session) => {
        const metadata = this.sessionMetadataById.get(session.id)
        return (
          session.userId === userId &&
          metadata?.canonicalContractVersion === 2 &&
          metadata.retryOfStudySessionId === undefined &&
          (session.mode === 'WRONG_NOTE' || session.mode === 'DAILY_REVIEW') &&
          this.sessionQuestionSnapshotsById
            .get(session.id)
            ?.some((question) => question.id === sourceQuestionId) === true
        )
      })
      .toSorted((left, right) => {
        const leftOrder =
          this.sessionMetadataById.get(left.id)?.creationOrder ?? 0
        const rightOrder =
          this.sessionMetadataById.get(right.id)?.creationOrder ?? 0
        return (
          rightOrder - leftOrder ||
          right.startedAt.localeCompare(left.startedAt)
        )
      })
    const latest = reviewSessions[0]
    const question = latest
      ? this.sessionQuestionSnapshotsById
          .get(latest.id)
          ?.find((candidate) => candidate.id === sourceQuestionId)
      : undefined
    return question ? getCanonicalQuestionVersionId(question) : null
  }

  private reconstructCanonicalWrongNotes(
    userId: string,
    submissions = this.getCanonicalUserSubmissionEvidence(userId)
  ): MockCanonicalWrongNoteRecord[] {
    const recordsByQuestionId = new Map<string, MockCanonicalWrongNoteRecord>()
    const consumedEventAnswerIds = new Set<string>()
    const evidence = submissions
      .flatMap(({ answers }) => answers)
      .toSorted(
        (left, right) =>
          left.answer.answeredAt.localeCompare(right.answer.answeredAt) ||
          left.answer.id.localeCompare(right.answer.id)
      )

    for (const { answer, question, resultItem } of evidence) {
      const previous = recordsByQuestionId.get(answer.sourceQuestionId) ?? null
      const event = this.canonicalReviewEventByStudyAnswerId.get(answer.id)
      if (previous === null && answer.isCorrect) {
        if (event || resultItem.wrongNoteStatus !== null) {
          throwCanonicalIntegrityError(
            '첫 정답 Answer에는 ReviewEvent나 오답 상태가 없어야 합니다.'
          )
        }
        continue
      }
      if (!event) {
        throwCanonicalIntegrityError(
          'canonical 오답 전이의 ReviewEvent evidence가 없습니다.'
        )
      }

      const occurredAt = toCanonicalIsoInstant(
        event.occurredAt,
        'ReviewEvent.occurredAt'
      )
      const answeredAt = toCanonicalIsoInstant(
        answer.answeredAt,
        'StudyAnswer.answeredAt'
      )
      const previousUpdatedAtMs = previous
        ? Date.parse(previous.updatedAt)
        : Number.NEGATIVE_INFINITY
      if (
        occurredAt !== answeredAt ||
        (previous && Date.parse(occurredAt) <= previousUpdatedAtMs)
      ) {
        throwCanonicalIntegrityError(
          'ReviewEvent 시각이 Answer 또는 이전 canonical 상태와 일치하지 않습니다.'
        )
      }

      const nextCorrectStreak = answer.isCorrect
        ? (previous?.correctStreak ?? 0) + 1
        : 0
      const wrongCountAfter = answer.isCorrect
        ? (previous?.wrongCount ?? 0)
        : (previous?.wrongCount ?? 0) + 1
      const nextStatus: WrongNoteStatus = answer.isCorrect
        ? nextCorrectStreak >= 2
          ? 'SOLVED'
          : 'REVIEWING'
        : previous
          ? 'AGAIN'
          : 'NEW'
      const wrongNoteId =
        previous?.wrongNoteId ??
        `wrong-note-${userId}-${answer.sourceQuestionId}`

      if (
        event.algorithmVersion !== 1 ||
        event.id !== toStableMockUuid('review-event', answer.id) ||
        event.source !==
          (this.sessionById.get(answer.sessionId)?.mode === 'WRONG_NOTE' ||
          this.sessionById.get(answer.sessionId)?.mode === 'DAILY_REVIEW'
            ? 'WRONG_NOTE_REVIEW'
            : 'STUDY_SUBMIT') ||
        event.studyAnswerId !== answer.id ||
        event.studySessionId !== answer.sessionId ||
        event.userId !== userId ||
        event.questionId !== answer.sourceQuestionId ||
        event.questionVersionId !== answer.questionVersionId ||
        event.selectedOptionId !== answer.selectedOptionId ||
        event.isCorrect !== answer.isCorrect ||
        event.previousStatus !== (previous?.status ?? null) ||
        event.previousCorrectStreak !== (previous?.correctStreak ?? null) ||
        event.previousWrongCount !== (previous?.wrongCount ?? null) ||
        event.nextStatus !== nextStatus ||
        event.nextCorrectStreak !== nextCorrectStreak ||
        event.wrongCountAfter !== wrongCountAfter ||
        event.wrongNoteId !== wrongNoteId ||
        resultItem.wrongNoteStatus !== nextStatus
      ) {
        throwCanonicalIntegrityError(
          'ReviewEvent chain projection이 Answer와 이전 상태를 정확히 잇지 않습니다.'
        )
      }
      consumedEventAnswerIds.add(answer.id)

      const intervalDays = answer.isCorrect
        ? getCanonicalReviewIntervalDays(nextCorrectStreak)
        : 1
      const nextReviewAt = addDaysToIso(occurredAt, intervalDays)
      const currentQuestion = this.questionById.get(answer.sourceQuestionId)
      recordsByQuestionId.set(answer.sourceQuestionId, {
        wrongNoteId,
        userId,
        sourceQuestionId: answer.sourceQuestionId,
        currentReviewQuestionVersionId: this.getCanonicalReviewPointer(
          userId,
          answer.sourceQuestionId
        ),
        wrongCount: wrongCountAfter,
        correctStreak: nextCorrectStreak,
        status: nextStatus,
        lastWrongAt: answer.isCorrect
          ? (previous?.lastWrongAt ?? occurredAt)
          : occurredAt,
        lastReviewedAt:
          previous === null && !answer.isCorrect ? null : occurredAt,
        nextReviewAt,
        updatedAt: occurredAt,
        lastWrongQuestion: answer.isCorrect
          ? clone(previous?.lastWrongQuestion ?? question)
          : clone(question),
        lastWrongQuestionVersionId: answer.isCorrect
          ? (previous?.lastWrongQuestionVersionId ?? answer.questionVersionId)
          : answer.questionVersionId,
        isCurrentPublished: currentQuestion?.status === 'PUBLISHED'
      })
    }

    for (const event of this.canonicalReviewEventByStudyAnswerId.values()) {
      if (event.source === 'VERSION_REBASE') {
        if (
          event.studySessionId !== null ||
          event.studyAnswerId !== null ||
          event.selectedOptionId !== null ||
          event.isCorrect !== null ||
          event.previousStatus === null ||
          event.previousCorrectStreak === null ||
          event.previousWrongCount === null ||
          event.nextStatus !== event.previousStatus ||
          event.nextCorrectStreak !== event.previousCorrectStreak ||
          event.wrongCountAfter !== event.previousWrongCount
        ) {
          throwCanonicalIntegrityError(
            'VERSION_REBASE ReviewEvent chain이 상태를 보존하지 않습니다.'
          )
        }
        continue
      }
      if (
        event.userId === userId &&
        (event.studyAnswerId === null ||
          !consumedEventAnswerIds.has(event.studyAnswerId))
      ) {
        throwCanonicalIntegrityError(
          '사용자 canonical chain에 연결되지 않은 ReviewEvent가 있습니다.'
        )
      }
    }

    return [...recordsByQuestionId.values()]
  }

  private planCanonicalWrongNoteUpdates(
    userId: string | null,
    sessionMode: StudyMode,
    items: readonly MockCanonicalGradedItem[],
    answerBySessionQuestionId: ReadonlyMap<
      string,
      MockCanonicalStudyAnswerRecord
    >,
    existingByQuestionId: ReadonlyMap<string, MockCanonicalWrongNoteRecord>,
    reviewedAt: string
  ): {
    statusBySessionQuestionId: Map<
      string,
      CanonicalStudyResult['items'][number]['wrongNoteStatus']
    >
    events: MockCanonicalReviewEventRecord[]
  } {
    const statusBySessionQuestionId = new Map<
      string,
      CanonicalStudyResult['items'][number]['wrongNoteStatus']
    >()
    const events: MockCanonicalReviewEventRecord[] = []

    if (!userId) {
      return { statusBySessionQuestionId, events }
    }

    const seenQuestionIds = new Set<string>()

    for (const item of items) {
      if (seenQuestionIds.has(item.sourceQuestionId)) {
        throw new MockDatabaseError(
          'PERSISTENCE_FAILED',
          500,
          'canonical 제출에는 같은 source question이 중복될 수 없습니다.'
        )
      }
      seenQuestionIds.add(item.sourceQuestionId)
      const existing = existingByQuestionId.get(item.sourceQuestionId) ?? null

      if (item.isCorrect && !existing) {
        continue
      }
      const answer = answerBySessionQuestionId.get(item.studySessionQuestionId)
      if (!answer) {
        throw new MockDatabaseError(
          'PERSISTENCE_FAILED',
          500,
          'ReviewEvent evidence 답안이 없습니다.'
        )
      }
      const nextCorrectStreak = item.isCorrect
        ? (existing?.correctStreak ?? 0) + 1
        : 0
      const nextStatus: WrongNoteStatus = item.isCorrect
        ? nextCorrectStreak >= 2
          ? 'SOLVED'
          : 'REVIEWING'
        : existing
          ? 'AGAIN'
          : 'NEW'
      const wrongCountAfter = item.isCorrect
        ? (existing?.wrongCount ?? 0)
        : (existing?.wrongCount ?? 0) + 1
      const wrongNoteId =
        existing?.wrongNoteId ?? `wrong-note-${userId}-${item.sourceQuestionId}`

      statusBySessionQuestionId.set(item.studySessionQuestionId, nextStatus)
      events.push({
        algorithmVersion: 1,
        id: toStableMockUuid('review-event', answer.id),
        isCorrect: item.isCorrect,
        nextCorrectStreak,
        nextStatus,
        occurredAt: reviewedAt,
        previousCorrectStreak: existing?.correctStreak ?? null,
        previousStatus: existing?.status ?? null,
        previousWrongCount: existing?.wrongCount ?? null,
        questionId: item.sourceQuestionId,
        questionVersionId: item.questionVersionId,
        selectedOptionId: answer.selectedOptionId,
        source:
          sessionMode === 'WRONG_NOTE' || sessionMode === 'DAILY_REVIEW'
            ? 'WRONG_NOTE_REVIEW'
            : 'STUDY_SUBMIT',
        studyAnswerId: answer.id,
        studySessionId: answer.sessionId,
        userId,
        wrongCountAfter,
        wrongNoteId
      })
    }

    return { statusBySessionQuestionId, events }
  }

  private applyResultToWrongNotes(
    userId: string,
    result: StudyResult,
    reviewedAt: string
  ): void {
    for (const item of result.items) {
      const key = makeUserQuestionKey(userId, item.question.id)
      const existing = this.wrongNoteByQuestionId.get(key)

      if (!item.isCorrect) {
        const wrongNote = existing
          ? updateWrongNoteAfterIncorrectAnswer(existing, reviewedAt)
          : createWrongNoteFromIncorrectAnswer(
              userId,
              item.question.id,
              reviewedAt
            )
        this.wrongNoteByQuestionId.set(key, wrongNote)
        continue
      }

      if (existing) {
        this.wrongNoteByQuestionId.set(
          key,
          updateWrongNoteAfterCorrectReview(existing, reviewedAt)
        )
      }
    }
  }

  private getDailyStudyCounts(
    userId: string
  ): DashboardStats['dailyStudyCountLast7Days'] {
    const now = new Date(this.now())
    const countByDate = new Map<string, number>()

    for (let daysAgo = 6; daysAgo >= 0; daysAgo -= 1) {
      const date = new Date(now)
      date.setUTCDate(now.getUTCDate() - daysAgo)
      countByDate.set(date.toISOString().slice(0, 10), 0)
    }

    for (const session of this.sessionById.values()) {
      if (session.userId !== userId || !session.submittedAt) {
        continue
      }
      const dateKey = toDateKey(session.submittedAt)
      const result = this.resultBySessionId.get(session.id)
      if (result && countByDate.has(dateKey)) {
        countByDate.set(
          dateKey,
          (countByDate.get(dateKey) ?? 0) + result.totalCount
        )
      }
    }

    return [...countByDate].map(([date, count]) => ({ date, count }))
  }

  private sortWrongNotes(
    items: WrongNoteListItem[],
    sort: WrongNoteSort
  ): WrongNoteListItem[] {
    if (sort === 'MOST_WRONG') {
      return items.toSorted(
        (left, right) =>
          right.wrongNote.wrongCount - left.wrongNote.wrongCount ||
          right.wrongNote.lastWrongAt.localeCompare(left.wrongNote.lastWrongAt)
      )
    }
    if (sort === 'OLDEST') {
      return items.toSorted((left, right) =>
        left.wrongNote.lastWrongAt.localeCompare(right.wrongNote.lastWrongAt)
      )
    }

    return items.toSorted((left, right) =>
      right.wrongNote.lastWrongAt.localeCompare(left.wrongNote.lastWrongAt)
    )
  }

  private sortAdminQuestions(
    questions: QuestionRecord[],
    sort: AdminQuestionSort
  ): QuestionRecord[] {
    if (sort === 'LEVEL') {
      return questions.toSorted(
        (left, right) =>
          LEVELS.indexOf(left.level) - LEVELS.indexOf(right.level) ||
          left.id.localeCompare(right.id)
      )
    }
    if (sort === 'STATUS') {
      return questions.toSorted(
        (left, right) =>
          left.status.localeCompare(right.status) ||
          right.updatedAt.localeCompare(left.updatedAt)
      )
    }

    return questions.toSorted((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )
  }

  private buildQuestionRecord(
    questionId: string,
    input: AdminQuestionInput,
    createdAt: string,
    updatedAt: string
  ): QuestionRecord {
    if (input.options.length !== 4) {
      throw new MockDatabaseError(
        'INVALID_INPUT',
        422,
        '보기는 정확히 4개여야 합니다.'
      )
    }
    if (new Set(input.options.map(({ label }) => label)).size !== 4) {
      throw new MockDatabaseError(
        'INVALID_INPUT',
        422,
        '보기 번호 1부터 4까지를 각각 한 번씩 입력해야 합니다.'
      )
    }
    if (input.subject === 'READING' && !input.passage?.trim()) {
      throw new MockDatabaseError(
        'INVALID_INPUT',
        422,
        '독해 문제에는 지문이 필요합니다.'
      )
    }

    const optionTexts = input.options.map(({ text }) => text.trim())
    if (new Set(optionTexts).size !== optionTexts.length) {
      throw new MockDatabaseError(
        'INVALID_INPUT',
        422,
        '동일한 보기를 중복할 수 없습니다.'
      )
    }
    if (
      !input.questionText.trim() ||
      !input.explanationKo.trim() ||
      input.tags.length === 0 ||
      input.tags.some((tag) => !tag.trim())
    ) {
      throw new MockDatabaseError(
        'INVALID_INPUT',
        422,
        '질문, 한국어 해설, 태그를 모두 입력해야 합니다.'
      )
    }

    const normalizedTags = input.tags.map(normalizeQuestionTagText)
    if (new Set(normalizedTags).size !== normalizedTags.length) {
      throw new MockDatabaseError(
        'INVALID_INPUT',
        422,
        '정규화했을 때 같은 태그를 중복할 수 없습니다.'
      )
    }

    const options = input.options.map((option) => {
      const id = option.id ?? `${questionId}-option-${option.label}`
      return {
        id,
        label: option.label,
        text: option.text.trim(),
        isCorrect:
          input.correctOptionId === id || input.correctOptionId === option.label
      }
    })
    const correctCount = options.reduce(
      (count, option) => count + (option.isCorrect ? 1 : 0),
      0
    )
    if (correctCount !== 1) {
      throw new MockDatabaseError(
        'INVALID_INPUT',
        422,
        '정답은 정확히 하나여야 합니다.'
      )
    }

    return {
      id: questionId,
      level: input.level,
      subject: input.subject,
      questionType: input.questionType,
      passage: input.passage?.trim() || null,
      questionText: input.questionText.trim(),
      options,
      explanationKo: input.explanationKo.trim(),
      explanationJa: input.explanationJa?.trim() || null,
      difficulty: input.difficulty,
      tags: input.tags.map((tag) => tag.trim()),
      status: input.status,
      sourceType: 'ORIGINAL',
      createdAt,
      updatedAt
    }
  }

  private assertUser(userId: string): void {
    if (!this.userById.has(userId)) {
      throw new MockDatabaseError('AUTH_REQUIRED', 401, '로그인이 필요합니다.')
    }
  }

  private getSessionQuestionSnapshot(session: StudySession): QuestionRecord[] {
    const snapshot = this.sessionQuestionSnapshotsById.get(session.id)
    if (!snapshot || snapshot.length !== session.questionIds.length) {
      throw new MockDatabaseError(
        'NOT_FOUND',
        404,
        '학습 세션의 문제 스냅샷이 없습니다.'
      )
    }

    return clone(snapshot)
  }

  private getEffectiveCanonicalStatus(
    session: StudySession,
    metadata: SessionMetadata
  ): 'CANCELLED' | 'EXPIRED' | 'IN_PROGRESS' | 'SUBMITTED' {
    if (metadata.canonicalTerminalStatus) {
      return metadata.canonicalTerminalStatus
    }
    if (session.status === 'SUBMITTED') {
      return 'SUBMITTED'
    }
    const observedAtMs = Date.parse(this.now())
    const startedAtMs = Date.parse(session.startedAt)
    if (
      Number.isFinite(observedAtMs) &&
      Number.isFinite(startedAtMs) &&
      observedAtMs >= startedAtMs + 24 * 60 * 60 * 1_000
    ) {
      return 'EXPIRED'
    }
    return 'IN_PROGRESS'
  }

  private observeCanonicalStatus(
    session: StudySession,
    metadata: SessionMetadata
  ): 'CANCELLED' | 'EXPIRED' | 'IN_PROGRESS' | 'SUBMITTED' {
    const status = this.getEffectiveCanonicalStatus(session, metadata)
    if (
      status === 'EXPIRED' &&
      metadata.canonicalTerminalStatus !== 'EXPIRED'
    ) {
      metadata.canonicalTerminalStatus = 'EXPIRED'
      this.canonicalDraftBySessionId.delete(session.id)
      this.persist()
    }
    return status
  }

  private hasMatchingDraftAnswers(
    draft: StudyDraftSnapshot,
    answers: readonly {
      studySessionQuestionId: string
      selectedOptionId: string | null
      elapsedSec: number
    }[]
  ): boolean {
    if (draft.answers.length !== answers.length) {
      return false
    }
    const answerById = new Map(
      answers.map((answer) => [answer.studySessionQuestionId, answer])
    )
    return (
      answerById.size === answers.length &&
      draft.answers.every((draftAnswer) => {
        const answer = answerById.get(draftAnswer.studySessionQuestionId)
        return (
          answer?.selectedOptionId === draftAnswer.selectedOptionId &&
          answer.elapsedSec === draftAnswer.elapsedSec
        )
      })
    )
  }

  private resolveCanonicalOwner(
    session: StudySession,
    metadata: SessionMetadata | undefined,
    guestPrincipalId: string | null
  ): MockCanonicalOwner {
    if (this.currentUserId !== null) {
      if (session.userId !== this.currentUserId) {
        throw new MockDatabaseError(
          'NOT_FOUND',
          404,
          '학습 세션을 찾을 수 없습니다.'
        )
      }
      return {
        principalId: this.currentUserId,
        principalKind: 'USER',
        userId: this.currentUserId
      }
    }

    if (!guestPrincipalId) {
      throw new MockDatabaseError(
        'AUTH_REQUIRED',
        401,
        '학습 세션을 조회하려면 guest proof가 필요합니다.'
      )
    }
    if (!this.activeCanonicalGuestPrincipalIds.has(guestPrincipalId)) {
      throw new MockDatabaseError(
        'AUTH_REQUIRED',
        401,
        '게스트 세션이 만료됐습니다.'
      )
    }
    if (
      session.userId !== null ||
      metadata?.canonicalGuestPrincipalId !== guestPrincipalId
    ) {
      throw new MockDatabaseError(
        'NOT_FOUND',
        404,
        '학습 세션을 찾을 수 없습니다.'
      )
    }

    return {
      principalId: guestPrincipalId,
      principalKind: 'GUEST',
      userId: null
    }
  }

  private assertCanonicalReadOwner(userId: string): void {
    if (!this.currentUserId) {
      throw new MockDatabaseError(
        'AUTH_REQUIRED',
        401,
        'canonical 학습 기록 조회에는 로그인이 필요합니다.'
      )
    }
    if (this.currentUserId !== userId) {
      throw new MockDatabaseError(
        'NOT_FOUND',
        404,
        'canonical 학습 기록을 찾을 수 없습니다.'
      )
    }
  }

  private assertLegacyStudySession(sessionId: string): void {
    if (isCanonicalSessionMetadata(this.sessionMetadataById.get(sessionId))) {
      throw new MockDatabaseError(
        'NOT_FOUND',
        404,
        'legacy 학습 경로에서는 canonical 세션을 찾을 수 없습니다.'
      )
    }
  }

  private assertCurrentSessionOwner(session: StudySession): void {
    if (session.userId === this.currentUserId) {
      return
    }

    if (!this.currentUserId && session.userId) {
      throw new MockDatabaseError(
        'AUTH_REQUIRED',
        401,
        '이 학습 세션을 보려면 로그인이 필요합니다.'
      )
    }

    throw new MockDatabaseError(
      'FORBIDDEN',
      403,
      '다른 사용자의 학습 세션에는 접근할 수 없습니다.'
    )
  }

  private createStudySessionId(): string {
    this.sequence += 1
    return crypto.randomUUID()
  }

  private createId(prefix: string): string {
    this.sequence += 1
    return `${prefix}-${Date.parse(this.now())}-${this.sequence}`
  }

  private persist(): void {
    const state: PersistedMockState = {
      version: 7,
      archivedQuestions: [...this.archivedQuestionById.values()],
      canonicalDrafts: [...this.canonicalDraftBySessionId.values()],
      canonicalIdempotencyRecords: [
        ...this.canonicalIdempotencyRecordByKey.values()
      ],
      canonicalReviewEvents: [
        ...this.canonicalReviewEventByStudyAnswerId.values()
      ],
      canonicalStudyAnswers: [...this.canonicalAnswerBySessionId].map(
        ([sessionId, answers]) => [
          fromDuplicatePreservingKey(sessionId),
          answers
        ]
      ),
      canonicalStudyResults: [...this.canonicalResultBySessionId.values()],
      canonicalUserMemos: [...this.canonicalUserMemoByWrongNoteId.values()],
      activeCanonicalGuestPrincipalIds: [
        ...this.activeCanonicalGuestPrincipalIds
      ].toSorted(),
      currentUserId: this.currentUserId,
      questions: [...this.questionById.values()],
      sessions: [...this.sessionById.values()],
      sessionMetadata: [...this.sessionMetadataById],
      sessionQuestionSnapshots: [...this.sessionQuestionSnapshotsById],
      results: [...this.resultBySessionId.values()],
      wrongNotes: [...this.wrongNoteByQuestionId.values()],
      bookmarks: [...this.bookmarkByQuestionId.values()]
    }
    const previousState = this.storage.getItem(MOCK_DATABASE_STORAGE_KEY)

    try {
      const didPersist = this.storage.setItem(
        MOCK_DATABASE_STORAGE_KEY,
        JSON.stringify(state)
      )
      if (didPersist === false) {
        throw new Error('Mock storage rejected the write.')
      }
    } catch {
      this.resetMemoryToSeed()
      this.currentUserId = null
      this.hydrateFromStorage(previousState)
      throw new MockDatabaseError(
        'PERSISTENCE_FAILED',
        500,
        '데모 데이터를 브라우저 저장소에 저장하지 못했습니다.'
      )
    }
  }

  private hydrateFromStorage(serialized: string | null): void {
    if (!serialized) {
      return
    }

    try {
      const parsed: unknown = JSON.parse(serialized)
      if (!isPersistedMockState(parsed)) {
        return
      }

      this.currentUserId = parsed.currentUserId
      this.questionById = new Map(
        parsed.questions.map((question) => [question.id, question])
      )
      this.archivedQuestionById = new Map(
        parsed.version === 5 || parsed.version === 6 || parsed.version === 7
          ? parsed.archivedQuestions.map((question) => [question.id, question])
          : []
      )
      this.sessionById = new Map(
        parsed.sessions.map((session) => [session.id, session])
      )
      this.sessionMetadataById = new Map(
        parsed.sessionMetadata.map(([sessionId, metadata], index) => [
          sessionId,
          {
            ...metadata,
            // v2 guest metadata is the only unambiguous canonical marker. An
            // unmarked v2 USER/ADMIN session remains legacy and canonical
            // paths fail closed; those old mock sessions must be recreated.
            ...(parsed.version === 2 && metadata.canonicalGuestPrincipalId
              ? { canonicalContractVersion: 1 as const }
              : {}),
            creationOrder: metadata.creationOrder ?? index + 1
          }
        ])
      )
      this.sequence = Math.max(
        this.sequence,
        ...[...this.sessionMetadataById.values()].map(
          ({ creationOrder }) => creationOrder ?? 0
        )
      )
      this.activeCanonicalGuestPrincipalIds = new Set(
        parsed.activeCanonicalGuestPrincipalIds ??
          parsed.sessionMetadata.flatMap(([, metadata]) =>
            metadata.canonicalGuestPrincipalId
              ? [metadata.canonicalGuestPrincipalId]
              : []
          )
      )
      this.sessionQuestionSnapshotsById = new Map(
        parsed.sessionQuestionSnapshots
      )
      if (
        parsed.version === 3 ||
        parsed.version === 4 ||
        parsed.version === 5 ||
        parsed.version === 6 ||
        parsed.version === 7
      ) {
        this.canonicalReviewEventByStudyAnswerId = new Map()
        parsed.canonicalReviewEvents.forEach((event, index) => {
          const storageKey = toDuplicatePreservingKey(
            this.canonicalReviewEventByStudyAnswerId,
            event.studyAnswerId ?? event.id,
            index
          )
          this.canonicalReviewEventByStudyAnswerId.set(storageKey, clone(event))
        })
        this.canonicalAnswerBySessionId = new Map()
        parsed.canonicalStudyAnswers.forEach(([sessionId, answers], index) => {
          const storageKey = toDuplicatePreservingKey(
            this.canonicalAnswerBySessionId,
            sessionId,
            index
          )
          this.canonicalAnswerBySessionId.set(storageKey, clone(answers))
        })
        this.canonicalResultBySessionId = new Map()
        parsed.canonicalStudyResults.forEach((result, index) => {
          const storageKey = toDuplicatePreservingKey(
            this.canonicalResultBySessionId,
            result.sessionId,
            index
          )
          this.canonicalResultBySessionId.set(storageKey, clone(result))
        })
        this.canonicalDraftBySessionId = new Map()
        if (
          parsed.version === 4 ||
          parsed.version === 5 ||
          parsed.version === 6 ||
          parsed.version === 7
        ) {
          parsed.canonicalDrafts.forEach((draft) => {
            this.canonicalDraftBySessionId.set(
              draft.studySessionId,
              clone(draft)
            )
          })
        }
        this.canonicalIdempotencyRecordByKey = new Map()
        parsed.canonicalIdempotencyRecords.forEach((record, index) => {
          const hydratedRecord: MockCanonicalIdempotencyRecord = {
            ...record,
            contractVersion:
              parsed.version === 3 ? (1 as const) : record.contractVersion,
            expiresAt:
              typeof record.expiresAt === 'string'
                ? record.expiresAt
                : getCanonicalIdempotencyExpiresAt(
                    record.completedAt,
                    record.operation
                  )
          }
          const compositeKey = makeCanonicalIdempotencyKey(
            hydratedRecord.principalKind,
            hydratedRecord.principalId,
            hydratedRecord.operation,
            hydratedRecord.idempotencyKey
          )
          const storageKey = this.canonicalIdempotencyRecordByKey.has(
            compositeKey
          )
            ? `${compositeKey}:duplicate:${index}`
            : compositeKey
          this.canonicalIdempotencyRecordByKey.set(
            storageKey,
            clone(hydratedRecord)
          )
        })
        this.canonicalUserMemoByWrongNoteId = new Map(
          parsed.version === 7
            ? parsed.canonicalUserMemos.map((memo) => [
                memo.wrongNoteId,
                clone(memo)
              ])
            : []
        )
      }
      this.resultBySessionId = new Map(
        parsed.results.map((result) => [result.sessionId, result])
      )
      this.wrongNoteByQuestionId = new Map(
        parsed.wrongNotes.map((wrongNote) => [
          makeUserQuestionKey(wrongNote.userId, wrongNote.questionId),
          wrongNote
        ])
      )
      const hydratedBookmarks =
        parsed.version >= 5
          ? parsed.bookmarks
          : parsed.bookmarks.filter(
              (bookmark) =>
                this.questionById.get(bookmark.questionId)?.status ===
                'PUBLISHED'
            )
      this.bookmarkByQuestionId = new Map(
        hydratedBookmarks.map((bookmark) => [
          makeUserQuestionKey(bookmark.userId, bookmark.questionId),
          bookmark
        ])
      )
    } catch {
      this.resetMemoryToSeed()
      this.currentUserId = null
    }
  }

  dispose(): void {
    this.unsubscribeStorage?.()
    this.unsubscribeStorage = undefined
  }

  private listenForExternalStorageChanges(): void {
    this.unsubscribeStorage = subscribeStorageChanges((event) => {
      if (event.key !== MOCK_DATABASE_STORAGE_KEY && event.key !== null) {
        return
      }

      this.resetMemoryToSeed()
      this.currentUserId = null
      const serialized =
        event.key === MOCK_DATABASE_STORAGE_KEY
          ? event.newValue
          : this.storage.getItem(MOCK_DATABASE_STORAGE_KEY)
      this.hydrateFromStorage(serialized)
    })
  }
}

export const mockDatabase = new MockDatabase()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    mockDatabase.dispose()
  })
}
