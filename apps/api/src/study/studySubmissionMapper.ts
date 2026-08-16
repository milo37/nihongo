import type { StudyResult } from '@nihongo/contracts/study/study-result'
import { toPublicPracticeQuestion } from '../question/questionMapper.js'
import type { PublishedQuestionDetailRecord } from '../question/questionRepository.js'

export interface ReviewedQuestionRecord extends PublishedQuestionDetailRecord {
  correctOptionId: string
  explanationJa: string | null
  explanationKo: string
}

export interface StudyResultQuestionRecord {
  readonly answer: {
    readonly isCorrect: boolean
    readonly reviewEvent: {
      readonly nextStatus: StudyResult['items'][number]['wrongNoteStatus']
    } | null
    readonly selectedOptionId: string | null
  }
  readonly ordinal: number
  readonly question: ReviewedQuestionRecord
  readonly sessionQuestionId: string
}

export interface StudyResultRecord {
  readonly correctCount: number
  readonly correctRateBasisPoints: number
  readonly durationSec: number
  readonly id: string
  readonly incorrectCount: number
  readonly level: StudyResult['level']
  readonly mode: StudyResult['mode']
  readonly questions: readonly StudyResultQuestionRecord[]
  readonly subject: StudyResult['subject']
  readonly submittedAt: Date
  readonly totalCount: number
}

export const toStudyResult = (record: StudyResultRecord): StudyResult => ({
  sessionId: record.id,
  level: record.level,
  subject: record.subject,
  mode: record.mode,
  totalCount: record.totalCount,
  correctCount: record.correctCount,
  incorrectCount: record.incorrectCount,
  correctRate: record.correctRateBasisPoints / 100,
  durationSec: record.durationSec,
  submittedAt: record.submittedAt.toISOString(),
  items: record.questions.map(({ answer, question, sessionQuestionId }) => ({
    sessionQuestionId,
    question: {
      ...toPublicPracticeQuestion(question),
      correctOptionId: question.correctOptionId,
      explanationKo: question.explanationKo,
      explanationJa: question.explanationJa
    },
    selectedOptionId: answer.selectedOptionId,
    isCorrect: answer.isCorrect,
    wrongNoteStatus: answer.reviewEvent?.nextStatus ?? null
  }))
})
