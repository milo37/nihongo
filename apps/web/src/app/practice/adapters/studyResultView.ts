import type { StudyResult } from '@nihongo/contracts/study/study-result'
import type { GetStudyResultResponse } from '@api/study/getStudyResult/schema'
import type {
  JlptLevel,
  PracticeQuestionOption,
  QuestionDifficulty,
  QuestionSubject,
  QuestionType,
  WrongNoteStatus
} from '@common/types/domain'

interface StudyResultQuestionView {
  id: string
  questionVersionId: string | null
  level: JlptLevel
  subject: QuestionSubject
  questionType: QuestionType
  passage: string | null
  questionText: string
  options: PracticeQuestionOption[]
  difficulty: QuestionDifficulty
  tags: string[]
}

export interface StudyResultItemView {
  sessionQuestionId: string | null
  question: StudyResultQuestionView
  selectedOptionId: string | null
  correctOptionId: string
  isCorrect: boolean
  explanationKo: string
  explanationJa: string | null
  tags: string[]
  wrongNoteStatus: WrongNoteStatus | null
}

export interface StudyResultView {
  sessionId: string
  totalCount: number
  correctCount: number
  incorrectCount: number
  correctRate: number
  durationSec: number
  submittedAt: string | null
  items: StudyResultItemView[]
}

export const toLegacyStudyResultView = (
  response: GetStudyResultResponse
): StudyResultView => ({
  ...response,
  submittedAt: null,
  items: response.items.map((item) => ({
    ...item,
    sessionQuestionId: null,
    wrongNoteStatus: null,
    question: {
      ...item.question,
      questionVersionId: null
    }
  }))
})

export const toCanonicalStudyResultView = (
  response: StudyResult
): StudyResultView => ({
  sessionId: response.sessionId,
  totalCount: response.totalCount,
  correctCount: response.correctCount,
  incorrectCount: response.incorrectCount,
  correctRate: response.correctRate,
  durationSec: response.durationSec,
  submittedAt: response.submittedAt,
  items: response.items.map((item) => {
    const tags = item.question.tags.map(({ label }) => label)

    return {
      sessionQuestionId: item.sessionQuestionId,
      question: {
        id: item.question.id,
        questionVersionId: item.question.questionVersionId,
        level: item.question.level,
        subject: item.question.subject,
        questionType: item.question.questionType,
        passage: item.question.passage,
        questionText: item.question.questionText,
        options: item.question.options,
        difficulty: item.question.difficulty,
        tags
      },
      selectedOptionId: item.selectedOptionId,
      correctOptionId: item.question.correctOptionId,
      isCorrect: item.isCorrect,
      explanationKo: item.question.explanationKo,
      explanationJa: item.question.explanationJa,
      tags,
      wrongNoteStatus: item.wrongNoteStatus
    }
  })
})
