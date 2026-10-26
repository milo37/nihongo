export const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
export type JlptLevel = (typeof LEVELS)[number]

export const SUBJECTS = ['VOCABULARY', 'GRAMMAR', 'READING'] as const
export type QuestionSubject = (typeof SUBJECTS)[number]

export const QUESTION_TYPES = [
  'KANJI_READING',
  'ORTHOGRAPHY',
  'CONTEXT_VOCABULARY',
  'PARAPHRASE',
  'WORD_USAGE',
  'GRAMMAR_SELECT',
  'SENTENCE_ORDER',
  'TEXT_GRAMMAR',
  'SHORT_READING',
  'MEDIUM_READING',
  'LONG_READING',
  'INFO_RETRIEVAL'
] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

export const QUESTION_DIFFICULTIES = ['EASY', 'NORMAL', 'HARD'] as const
export type QuestionDifficulty = (typeof QUESTION_DIFFICULTIES)[number]

export const QUESTION_STATUSES = ['DRAFT', 'PUBLISHED'] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

export const MODES = [
  'RANDOM',
  'WRONG_NOTE',
  'WEAKNESS',
  'BOOKMARK',
  'DAILY_REVIEW'
] as const
export type StudyMode = (typeof MODES)[number]

export const STUDY_SESSION_STATUSES = ['IN_PROGRESS', 'SUBMITTED'] as const
export type StudySessionStatus = (typeof STUDY_SESSION_STATUSES)[number]

export const WRONG_NOTE_STATUSES = [
  'NEW',
  'REVIEWING',
  'AGAIN',
  'SOLVED'
] as const
export type WrongNoteStatus = (typeof WRONG_NOTE_STATUSES)[number]

export const USER_ROLES = ['GUEST', 'USER', 'ADMIN'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const OPTION_LABELS = ['1', '2', '3', '4'] as const
export type QuestionOptionLabel = (typeof OPTION_LABELS)[number]

export interface User {
  id: string
  name: string
  role: Exclude<UserRole, 'GUEST'>
  targetLevel: JlptLevel
  createdAt: string
  updatedAt: string
}

export interface QuestionOptionRecord {
  id: string
  label: QuestionOptionLabel
  text: string
  isCorrect: boolean
}

export interface QuestionRecord {
  id: string
  level: JlptLevel
  subject: QuestionSubject
  questionType: QuestionType
  passage: string | null
  questionText: string
  options: QuestionOptionRecord[]
  explanationKo: string
  explanationJa: string | null
  difficulty: QuestionDifficulty
  tags: string[]
  status: QuestionStatus
  sourceType: 'ORIGINAL'
  createdAt: string
  updatedAt: string
}

export interface PracticeQuestionOption {
  id: string
  label: QuestionOptionLabel
  text: string
}

export interface PracticeQuestion {
  id: string
  level: JlptLevel
  subject: QuestionSubject
  questionType: QuestionType
  passage: string | null
  questionText: string
  options: PracticeQuestionOption[]
  difficulty: QuestionDifficulty
  tags: string[]
}

export interface StudySession {
  id: string
  userId: string | null
  level: JlptLevel
  subject: QuestionSubject
  mode: StudyMode
  questionIds: string[]
  status: StudySessionStatus
  startedAt: string
  submittedAt: string | null
  durationSec: number | null
}

export interface StudyAnswerInput {
  questionId: string
  selectedOptionId: string
  elapsedSec: number
}

export interface StudyResultItem {
  question: PracticeQuestion
  selectedOptionId: string | null
  correctOptionId: string
  isCorrect: boolean
  explanationKo: string
  explanationJa: string | null
  tags: string[]
}

export interface StudyResult {
  sessionId: string
  totalCount: number
  correctCount: number
  incorrectCount: number
  correctRate: number
  durationSec: number
  items: StudyResultItem[]
}

export interface WrongNote {
  id: string
  userId: string
  questionId: string
  wrongCount: number
  correctStreak: number
  status: WrongNoteStatus
  memo: string | null
  lastWrongAt: string
  lastReviewedAt: string | null
  nextReviewAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Bookmark {
  id: string
  userId: string
  questionId: string
  createdAt: string
}

export interface SubjectStat {
  subject: QuestionSubject
  answeredCount: number
  correctCount: number
  correctRate: number
}

export interface RecentStudySession {
  id: string
  level: JlptLevel
  subject: QuestionSubject
  mode: StudyMode
  totalCount: number
  correctCount: number
  correctRate: number
  durationSec: number
  submittedAt: string
}

export interface DailyStudyCount {
  date: string
  count: number
}

export interface RepeatedWrongQuestion {
  questionId: string
  questionText: string
  level: JlptLevel
  subject: QuestionSubject
  wrongCount: number
}

export interface DashboardStats {
  totalAnsweredCount: number
  correctCount: number
  correctRate: number
  wrongNoteCount: number
  solvedWrongNoteCount: number
  weakestSubject: QuestionSubject | null
  subjectStats: SubjectStat[]
  recentStudySessions: RecentStudySession[]
  dailyStudyCountLast7Days: DailyStudyCount[]
  repeatedWrongQuestions: RepeatedWrongQuestion[]
}
