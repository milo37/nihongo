import type { GetWrongNoteResponse } from '@nihongo/contracts/wrong-note/get-wrong-note'
import type {
  JlptLevel,
  PracticeQuestionOption,
  QuestionDifficulty,
  QuestionSubject,
  QuestionType,
  WrongNoteStatus
} from '@nihongo/browser/common/types/domain'

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
  lastWrongQuestionVersionId: string | null
  currentReviewQuestionVersionId: string | null
  canRetry: boolean
  canUpdateMemo: boolean
}

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
  lastWrongQuestionVersionId: response.lastWrongQuestionVersionId,
  currentReviewQuestionVersionId: response.currentReviewQuestionVersionId,
  canRetry: false,
  canUpdateMemo: false
})
