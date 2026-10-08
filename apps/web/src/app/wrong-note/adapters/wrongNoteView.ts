import type { GetWrongNoteResponse } from '@nihongo/contracts/wrong-note/get-wrong-note'
import type { ListWrongNotesResponse } from '@nihongo/contracts/wrong-note/list-wrong-notes'
import type { GetWrongNoteResponse as LegacyGetWrongNoteResponse } from '@api/wrong-note/getWrongNote/schema'
import type { ListWrongNoteResponse } from '@api/wrong-note/listWrongNote/schema'
import type {
  JlptLevel,
  PracticeQuestionOption,
  QuestionDifficulty,
  QuestionSubject,
  QuestionType,
  WrongNoteStatus
} from '@common/types/domain'

export interface WrongNoteListItemView {
  questionId: string
  level: JlptLevel
  subject: QuestionSubject
  questionType: QuestionType
  questionPreview: string
  difficulty: QuestionDifficulty | null
  tags: string[]
  wrongCount: number
  correctStreak: number
  status: WrongNoteStatus
  lastWrongAt: string
  lastReviewedAt: string | null
  nextReviewAt: string | null
  hasMemo: boolean
  reviewAvailability: 'ARCHIVED' | 'AVAILABLE'
}

export interface WrongNoteListView {
  items: WrongNoteListItemView[]
  total: number
  page: number
  pageSize: number
  availableTags: string[]
}

export interface WrongNoteDetailView {
  wrongNote: {
    questionId: string
    wrongCount: number
    correctStreak: number
    status: WrongNoteStatus
    lastWrongAt: string
    lastReviewedAt: string | null
    nextReviewAt: string | null
    reviewAvailability: 'ARCHIVED' | 'AVAILABLE'
  }
  question: {
    id: string
    questionVersionId: string | null
    level: JlptLevel
    subject: QuestionSubject
    questionType: QuestionType
    passage: string | null
    questionText: string
    options: Array<PracticeQuestionOption & { isCorrect: boolean }>
    explanationKo: string
    explanationJa: string | null
    difficulty: QuestionDifficulty
    tags: string[]
  }
  memo: string | null
  currentReviewQuestionVersionId: string | null
  canRetry: boolean
  canUpdateMemo: boolean
}

export const toLegacyWrongNoteListView = (
  response: ListWrongNoteResponse
): WrongNoteListView => ({
  items: response.items.map(({ question, wrongNote }) => ({
    questionId: question.id,
    level: question.level,
    subject: question.subject,
    questionType: question.questionType,
    questionPreview: question.questionText,
    difficulty: question.difficulty,
    tags: question.tags,
    wrongCount: wrongNote.wrongCount,
    correctStreak: wrongNote.correctStreak,
    status: wrongNote.status,
    lastWrongAt: wrongNote.lastWrongAt,
    lastReviewedAt: wrongNote.lastReviewedAt,
    nextReviewAt: wrongNote.nextReviewAt,
    hasMemo: wrongNote.memo !== null,
    reviewAvailability: 'AVAILABLE'
  })),
  total: response.total,
  page: response.page,
  pageSize: response.pageSize,
  availableTags: response.availableTags
})

export const toCanonicalWrongNoteListView = (
  response: ListWrongNotesResponse
): WrongNoteListView => ({
  ...response,
  items: response.items.map((item) => ({
    ...item,
    difficulty: null
  }))
})

export const toLegacyWrongNoteDetailView = (
  response: LegacyGetWrongNoteResponse
): WrongNoteDetailView => ({
  wrongNote: {
    questionId: response.wrongNote.questionId,
    wrongCount: response.wrongNote.wrongCount,
    correctStreak: response.wrongNote.correctStreak,
    status: response.wrongNote.status,
    lastWrongAt: response.wrongNote.lastWrongAt,
    lastReviewedAt: response.wrongNote.lastReviewedAt,
    nextReviewAt: response.wrongNote.nextReviewAt,
    reviewAvailability: 'AVAILABLE'
  },
  question: {
    id: response.question.id,
    questionVersionId: null,
    level: response.question.level,
    subject: response.question.subject,
    questionType: response.question.questionType,
    passage: response.question.passage,
    questionText: response.question.questionText,
    options: response.question.options,
    explanationKo: response.question.explanationKo,
    explanationJa: response.question.explanationJa,
    difficulty: response.question.difficulty,
    tags: response.question.tags
  },
  memo: response.wrongNote.memo,
  currentReviewQuestionVersionId: null,
  canRetry: true,
  canUpdateMemo: true
})

export const toCanonicalWrongNoteDetailView = (
  response: GetWrongNoteResponse
): WrongNoteDetailView => ({
  wrongNote: {
    questionId: response.wrongNote.questionId,
    wrongCount: response.wrongNote.wrongCount,
    correctStreak: response.wrongNote.correctStreak,
    status: response.wrongNote.status,
    lastWrongAt: response.wrongNote.lastWrongAt,
    lastReviewedAt: response.wrongNote.lastReviewedAt,
    nextReviewAt: response.wrongNote.nextReviewAt,
    reviewAvailability: response.wrongNote.reviewAvailability
  },
  question: {
    id: response.question.id,
    questionVersionId: response.question.questionVersionId,
    level: response.question.level,
    subject: response.question.subject,
    questionType: response.question.questionType,
    passage: response.question.passage,
    questionText: response.question.questionText,
    options: response.question.options.map((option) => ({
      ...option,
      isCorrect: option.id === response.question.correctOptionId
    })),
    explanationKo: response.question.explanationKo,
    explanationJa: response.question.explanationJa,
    difficulty: response.question.difficulty,
    tags: response.question.tags.map(({ label }) => label)
  },
  memo: response.memo,
  currentReviewQuestionVersionId: response.currentReviewQuestionVersionId,
  canRetry: false,
  canUpdateMemo: false
})
