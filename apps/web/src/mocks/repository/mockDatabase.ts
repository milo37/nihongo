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
import {
  cachedStorage,
  MOCK_DATABASE_STORAGE_KEY,
  subscribeStorageChanges
} from '@libs/storage'
import type { ParsedSubmitStudySessionBody } from '@nihongo/contracts/study/submit-study-session'
import type { StudyResult as CanonicalStudyResult } from '@nihongo/contracts/study/study-result'
import { toStableMockUuid } from '@mocks/adapters/questionContractAdapter'
import type {
  MockCanonicalGradedItem,
  MockCanonicalGrading
} from '@mocks/adapters/studySubmissionContractAdapter'
import { mockSeedData } from '@mocks/data'
import { DEMO_ADMIN_ID, DEMO_USER_ID } from '@mocks/data/users'
import { addDaysToIso, toDateKey } from '@util/date'
import { toPracticeQuestion } from '@util/question'
import { seededShuffle, type ShuffleSeed } from '@util/shuffle'
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
  | 'AUTH_REQUIRED'
  | 'DUPLICATE_RESOURCE'
  | 'FORBIDDEN'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'PERSISTENCE_FAILED'
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
  canonicalContractVersion?: 1
  userId?: string | null
  level: JlptLevel
  subject: QuestionSubject
  mode: StudyMode
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
  readonly isCorrect: boolean
  readonly nextCorrectStreak: number
  readonly nextStatus: WrongNoteStatus
  readonly occurredAt: string
  readonly previousCorrectStreak: number | null
  readonly previousStatus: WrongNoteStatus | null
  readonly previousWrongCount: number | null
  readonly questionId: string
  readonly questionVersionId: string
  readonly selectedOptionId: string | null
  readonly source: 'STUDY_SUBMIT'
  readonly studyAnswerId: string
  readonly studySessionId: string
  readonly userId: string
  readonly wrongCountAfter: number
  readonly wrongNoteId: string
}

export interface MockCanonicalIdempotencyRecord {
  readonly completedAt: string
  readonly idempotencyKey: string
  readonly operation: 'study.submitStudySession'
  readonly principalId: string
  readonly principalKind: 'GUEST' | 'USER'
  readonly requestMaterial: string
  readonly response: CanonicalStudyResult
  readonly responseStatus: 201
  readonly sessionId: string
}

export interface SubmitCanonicalStudySessionInput {
  readonly body: ParsedSubmitStudySessionBody
  readonly guestPrincipalId: string | null
  readonly idempotencyKey: string
  readonly sessionId: string
}

export interface MockCanonicalSubmissionOperations {
  readonly canonicalize: (
    record: MockStudySessionSnapshotRecord,
    body: ParsedSubmitStudySessionBody
  ) => string
  readonly grade: (
    record: MockStudySessionSnapshotRecord,
    body: ParsedSubmitStudySessionBody,
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

interface MockCanonicalOwner {
  readonly principalId: string
  readonly principalKind: 'GUEST' | 'USER'
  readonly userId: string | null
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
  canonicalContractVersion?: 1
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

interface PersistedMockState extends PersistedMockStateBase {
  version: 3
  canonicalIdempotencyRecords: MockCanonicalIdempotencyRecord[]
  canonicalReviewEvents: MockCanonicalReviewEventRecord[]
  canonicalStudyAnswers: Array<[string, MockCanonicalStudyAnswerRecord[]]>
  canonicalStudyResults: CanonicalStudyResult[]
}

type HydratablePersistedMockState = PersistedMockState | PersistedMockStateV2

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

const isPersistedMockState = (
  value: unknown
): value is HydratablePersistedMockState => {
  if (!isRecord(value) || (value.version !== 2 && value.version !== 3)) {
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
        Array.isArray(value.canonicalStudyResults)))
  )
}

const makeUserQuestionKey = (userId: string, questionId: string): string => {
  return `${userId}:${questionId}`
}

const makeCanonicalIdempotencyKey = (
  principalKind: MockCanonicalIdempotencyRecord['principalKind'],
  principalId: string,
  idempotencyKey: string
): string =>
  `${principalKind}:${principalId}:study.submitStudySession:${idempotencyKey}`

const isCanonicalSessionMetadata = (
  metadata: SessionMetadata | undefined
): boolean =>
  metadata?.canonicalContractVersion === 1 ||
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
  private sessionById = new Map<string, StudySession>()
  private sessionMetadataById = new Map<string, SessionMetadata>()
  private sessionQuestionSnapshotsById = new Map<string, QuestionRecord[]>()
  private canonicalAnswerBySessionId = new Map<
    string,
    MockCanonicalStudyAnswerRecord[]
  >()
  private canonicalResultBySessionId = new Map<string, CanonicalStudyResult>()
  private canonicalReviewEventByStudyAnswerId = new Map<
    string,
    MockCanonicalReviewEventRecord
  >()
  private canonicalIdempotencyRecordByKey = new Map<
    string,
    MockCanonicalIdempotencyRecord
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
    const eligible = this.getEligibleQuestions(input.level, input.subject)

    if (!userId && (input.mode === 'WRONG_NOTE' || input.mode === 'BOOKMARK')) {
      throw new MockDatabaseError(
        'AUTH_REQUIRED',
        401,
        '오답 및 즐겨찾기 모드는 로그인이 필요합니다.'
      )
    }

    if (eligible.length === 0) {
      throw new MockDatabaseError(
        'NOT_FOUND',
        404,
        '선택한 조건에 출제 가능한 문제가 없습니다.'
      )
    }

    const selection = this.selectQuestions(input, eligible, userId)
    const sessionId = this.createStudySessionId()
    const startedAt = this.now()
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
      requestedCount,
      usedFallback: selection.usedFallback
    })
    if (!userId && input.canonicalGuestPrincipalId) {
      this.activeCanonicalGuestPrincipalIds.add(input.canonicalGuestPrincipalId)
    }
    this.sessionQuestionSnapshotsById.set(sessionId, clone(selection.questions))
    this.persist()

    return this.buildStudySessionPayload(
      session,
      input.canonicalContractVersion === 1
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
    if (!isCanonicalSessionMetadata(metadata)) {
      throw new MockDatabaseError(
        'NOT_FOUND',
        404,
        'canonical 학습 세션이 아닙니다.'
      )
    }
    this.resolveCanonicalOwner(session, metadata, guestPrincipalId)

    return {
      session: clone(session),
      requestedCount: metadata?.requestedCount ?? session.questionIds.length,
      questions: this.getSessionQuestionSnapshot(session)
    }
  }

  submitCanonicalStudySession(
    input: SubmitCanonicalStudySessionInput,
    operations: MockCanonicalSubmissionOperations
  ): SubmitCanonicalStudySessionResult {
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
      input.idempotencyKey
    )
    const existingRecord = this.canonicalIdempotencyRecordByKey.get(recordKey)

    if (existingRecord) {
      if (existingRecord.requestMaterial !== requestMaterial) {
        throw new MockDatabaseError(
          'IDEMPOTENCY_KEY_REUSED',
          409,
          '같은 멱등 키를 다른 제출 요청에 사용할 수 없습니다.'
        )
      }
      return { replayed: true, response: clone(existingRecord.response) }
    }

    const observedAtMs = Date.parse(this.now())
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
      session.mode !== 'RANDOM' ||
      observedAtMs >= startedAtMs + 24 * 60 * 60 * 1_000
    ) {
      throw new MockDatabaseError(
        'STUDY_SESSION_NOT_EDITABLE',
        409,
        '현재 상태에서는 학습 세션을 제출할 수 없습니다.'
      )
    }

    let submittedAtMs = Math.max(observedAtMs, startedAtMs)
    if (owner.userId) {
      for (const question of snapshot.questions) {
        const previous = this.wrongNoteByQuestionId.get(
          makeUserQuestionKey(owner.userId, question.id)
        )
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
      grading.items,
      answerRecordBySessionQuestionId,
      submittedAt
    )
    const response = operations.toResult(
      grading,
      wrongNotePlan.statusBySessionQuestionId
    )
    const idempotencyRecord: MockCanonicalIdempotencyRecord = {
      completedAt: submittedAt,
      idempotencyKey: input.idempotencyKey,
      operation: 'study.submitStudySession',
      principalId: owner.principalId,
      principalKind: owner.principalKind,
      requestMaterial,
      response,
      responseStatus: 201,
      sessionId: session.id
    }

    for (const [key, wrongNote] of wrongNotePlan.updates) {
      this.wrongNoteByQuestionId.set(key, wrongNote)
    }
    for (const event of wrongNotePlan.events) {
      this.canonicalReviewEventByStudyAnswerId.set(event.studyAnswerId, event)
    }
    session.status = 'SUBMITTED'
    session.submittedAt = submittedAt
    session.durationSec = response.durationSec
    this.canonicalAnswerBySessionId.set(session.id, answers)
    this.canonicalResultBySessionId.set(session.id, response)
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
            left.occurredAt.localeCompare(right.occurredAt) ||
            left.id.localeCompare(right.id)
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
    if (!this.questionById.delete(questionId)) {
      throw new MockDatabaseError('NOT_FOUND', 404, '문제를 찾을 수 없습니다.')
    }

    for (const [key, bookmark] of this.bookmarkByQuestionId) {
      if (bookmark.questionId === questionId) {
        this.bookmarkByQuestionId.delete(key)
      }
    }
    for (const [key, wrongNote] of this.wrongNoteByQuestionId) {
      if (wrongNote.questionId === questionId) {
        this.wrongNoteByQuestionId.delete(key)
      }
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
    this.sessionById.clear()
    this.sessionMetadataById.clear()
    this.sessionQuestionSnapshotsById.clear()
    this.canonicalAnswerBySessionId.clear()
    this.canonicalResultBySessionId.clear()
    this.canonicalReviewEventByStudyAnswerId.clear()
    this.canonicalIdempotencyRecordByKey.clear()
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

  private planCanonicalWrongNoteUpdates(
    userId: string | null,
    items: readonly MockCanonicalGradedItem[],
    answerBySessionQuestionId: ReadonlyMap<
      string,
      MockCanonicalStudyAnswerRecord
    >,
    reviewedAt: string
  ): {
    statusBySessionQuestionId: Map<
      string,
      CanonicalStudyResult['items'][number]['wrongNoteStatus']
    >
    updates: Map<string, WrongNote>
    events: MockCanonicalReviewEventRecord[]
  } {
    const statusBySessionQuestionId = new Map<
      string,
      CanonicalStudyResult['items'][number]['wrongNoteStatus']
    >()
    const updates = new Map<string, WrongNote>()
    const events: MockCanonicalReviewEventRecord[] = []

    if (!userId) {
      return { statusBySessionQuestionId, updates, events }
    }

    for (const item of items) {
      const key = makeUserQuestionKey(userId, item.sourceQuestionId)
      const existing =
        updates.get(key) ?? this.wrongNoteByQuestionId.get(key) ?? null
      let next: WrongNote | null = null

      if (!item.isCorrect) {
        next = existing
          ? updateWrongNoteAfterIncorrectAnswer(existing, reviewedAt)
          : createWrongNoteFromIncorrectAnswer(
              userId,
              item.sourceQuestionId,
              reviewedAt
            )
      } else if (existing) {
        const correctStreak = existing.correctStreak + 1
        const status = correctStreak >= 2 ? 'SOLVED' : 'REVIEWING'
        const reviewIntervalDays =
          correctStreak === 1
            ? 3
            : correctStreak === 2
              ? 7
              : correctStreak === 3
                ? 14
                : 30
        next = {
          ...existing,
          correctStreak,
          status,
          lastReviewedAt: reviewedAt,
          nextReviewAt: addDaysToIso(reviewedAt, reviewIntervalDays),
          updatedAt: reviewedAt
        }
      }

      if (!next) {
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
      updates.set(key, next)
      statusBySessionQuestionId.set(item.studySessionQuestionId, next.status)
      events.push({
        algorithmVersion: 1,
        id: toStableMockUuid('review-event', answer.id),
        isCorrect: item.isCorrect,
        nextCorrectStreak: next.correctStreak,
        nextStatus: next.status,
        occurredAt: reviewedAt,
        previousCorrectStreak: existing?.correctStreak ?? null,
        previousStatus: existing?.status ?? null,
        previousWrongCount: existing?.wrongCount ?? null,
        questionId: item.sourceQuestionId,
        questionVersionId: item.questionVersionId,
        selectedOptionId: answer.selectedOptionId,
        source: 'STUDY_SUBMIT',
        studyAnswerId: answer.id,
        studySessionId: answer.sessionId,
        userId,
        wrongCountAfter: next.wrongCount,
        wrongNoteId: next.id
      })
    }

    return { statusBySessionQuestionId, updates, events }
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
      version: 3,
      canonicalIdempotencyRecords: [
        ...this.canonicalIdempotencyRecordByKey.values()
      ],
      canonicalReviewEvents: [
        ...this.canonicalReviewEventByStudyAnswerId.values()
      ],
      canonicalStudyAnswers: [...this.canonicalAnswerBySessionId],
      canonicalStudyResults: [...this.canonicalResultBySessionId.values()],
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
      this.sessionById = new Map(
        parsed.sessions.map((session) => [session.id, session])
      )
      this.sessionMetadataById = new Map(
        parsed.sessionMetadata.map(([sessionId, metadata]) => [
          sessionId,
          // v2 guest metadata is the only unambiguous canonical marker. An
          // unmarked v2 USER/ADMIN session remains legacy and canonical paths
          // fail closed; those old mock sessions must be recreated.
          parsed.version === 2 && metadata.canonicalGuestPrincipalId
            ? {
                ...metadata,
                canonicalContractVersion: 1 as const
              }
            : metadata
        ])
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
      if (parsed.version === 3) {
        this.canonicalReviewEventByStudyAnswerId = new Map(
          parsed.canonicalReviewEvents.map((event) => [
            event.studyAnswerId,
            clone(event)
          ])
        )
        this.canonicalAnswerBySessionId = new Map(
          parsed.canonicalStudyAnswers.map(([sessionId, answers]) => [
            sessionId,
            clone(answers)
          ])
        )
        this.canonicalResultBySessionId = new Map(
          parsed.canonicalStudyResults.map((result) => [
            result.sessionId,
            clone(result)
          ])
        )
        this.canonicalIdempotencyRecordByKey = new Map(
          parsed.canonicalIdempotencyRecords.map((record) => {
            return [
              makeCanonicalIdempotencyKey(
                record.principalKind,
                record.principalId,
                record.idempotencyKey
              ),
              clone(record)
            ]
          })
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
      this.bookmarkByQuestionId = new Map(
        parsed.bookmarks.map((bookmark) => [
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
