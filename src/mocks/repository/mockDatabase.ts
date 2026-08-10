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
import { cachedStorage } from '@libs/storage'
import { mockSeedData } from '@mocks/data'
import { toDateKey } from '@util/date'
import { toPracticeQuestion } from '@util/question'
import { seededShuffle, type ShuffleSeed } from '@util/shuffle'
import { calculateStudyResult } from '@util/study'
import {
  createWrongNoteFromIncorrectAnswer,
  updateWrongNoteAfterCorrectReview,
  updateWrongNoteAfterIncorrectAnswer
} from '@util/wrongNote'

const STORAGE_KEY = 'jlpt-drill-note:mock-database:v2'
const RECENT_SESSION_LIMIT = 5
const REPEATED_WRONG_LIMIT = 5
const MIN_WEAKNESS_ATTEMPTS = 3
const WEAKNESS_SESSION_LIMIT = 10

export type MockDatabaseErrorCode =
  | 'AUTH_REQUIRED'
  | 'DUPLICATE_RESOURCE'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'SESSION_SUBMITTED'

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
  requestedCount: number
  usedFallback: boolean
}

interface PersistedMockState {
  version: 2
  currentUserId: string | null
  questions: QuestionRecord[]
  sessions: StudySession[]
  sessionMetadata: Array<[string, SessionMetadata]>
  sessionQuestionSnapshots: Array<[string, QuestionRecord[]]>
  results: StudyResult[]
  wrongNotes: WrongNote[]
  bookmarks: Bookmark[]
}

export interface MockStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
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
  setItem: (key, value): void => {
    void cachedStorage.setItem(key, value)
  },
  removeItem: (key): void => {
    void cachedStorage.removeItem(key)
  }
}

const clone = <Value>(value: Value): Value => structuredClone(value)

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isPersistedMockState = (value: unknown): value is PersistedMockState => {
  if (!isRecord(value) || value.version !== 2) {
    return false
  }

  return (
    (typeof value.currentUserId === 'string' || value.currentUserId === null) &&
    Array.isArray(value.questions) &&
    Array.isArray(value.sessions) &&
    Array.isArray(value.sessionMetadata) &&
    Array.isArray(value.sessionQuestionSnapshots) &&
    Array.isArray(value.results) &&
    Array.isArray(value.wrongNotes) &&
    Array.isArray(value.bookmarks)
  )
}

const makeUserQuestionKey = (userId: string, questionId: string): string => {
  return `${userId}:${questionId}`
}

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
  private readonly userById = new Map<string, User>()
  private questionById = new Map<string, QuestionRecord>()
  private sessionById = new Map<string, StudySession>()
  private sessionMetadataById = new Map<string, SessionMetadata>()
  private sessionQuestionSnapshotsById = new Map<string, QuestionRecord[]>()
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
    this.hydrateFromStorage(this.storage.getItem(STORAGE_KEY))

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
    const userId = role === 'ADMIN' ? 'demo-admin' : 'demo-user'
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

  listQuestions(filters: QuestionListFilters = {}): QuestionListResult {
    const { page, pageSize } = normalizePagination(
      filters.page,
      filters.pageSize
    )
    const normalizedSearch = filters.search?.trim().toLocaleLowerCase()
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
        normalizedSearch &&
        !`${question.questionText} ${question.tags.join(' ')}`
          .toLocaleLowerCase()
          .includes(normalizedSearch)
      ) {
        continue
      }

      matches.push(question)
    }

    return {
      items: paginate(matches, page, pageSize).map(toPracticeQuestion),
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
    const sessionId = this.createId('session')
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
      requestedCount,
      usedFallback: selection.usedFallback
    })
    this.sessionQuestionSnapshotsById.set(sessionId, clone(selection.questions))
    this.persist()

    return this.buildStudySessionPayload(session)
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
    return this.buildStudySessionPayload(this.getStudySession(sessionId))
  }

  getPracticeQuestionsForSession(sessionId: string): PracticeQuestion[] {
    return this.getStudySessionPayload(sessionId).questions
  }

  submitStudySession(input: SubmitStudySessionInput): StudyResult {
    const session = this.sessionById.get(input.sessionId)

    if (!session) {
      throw new MockDatabaseError('NOT_FOUND', 404, '학습 세션이 없습니다.')
    }
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
    this.storage.removeItem(STORAGE_KEY)
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

  private buildStudySessionPayload(session: StudySession): StudySessionPayload {
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

  private createId(prefix: string): string {
    this.sequence += 1
    return `${prefix}-${Date.parse(this.now())}-${this.sequence}`
  }

  private persist(): void {
    const state: PersistedMockState = {
      version: 2,
      currentUserId: this.currentUserId,
      questions: [...this.questionById.values()],
      sessions: [...this.sessionById.values()],
      sessionMetadata: [...this.sessionMetadataById],
      sessionQuestionSnapshots: [...this.sessionQuestionSnapshotsById],
      results: [...this.resultBySessionId.values()],
      wrongNotes: [...this.wrongNoteByQuestionId.values()],
      bookmarks: [...this.bookmarkByQuestionId.values()]
    }
    this.storage.setItem(STORAGE_KEY, JSON.stringify(state))
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
      this.sessionMetadataById = new Map(parsed.sessionMetadata)
      this.sessionQuestionSnapshotsById = new Map(
        parsed.sessionQuestionSnapshots
      )
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

  private listenForExternalStorageChanges(): void {
    if (typeof window === 'undefined') {
      return
    }

    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY) {
        this.resetMemoryToSeed()
        this.currentUserId = null
        this.hydrateFromStorage(event.newValue)
      }
    })
  }
}

export const mockDatabase = new MockDatabase()
