import type { StudySessionPayload } from '@nihongo/contracts/study/study-session'
import type { GetStudySessionResponse } from '@api/study/getStudySession/schema'
import type {
  JlptLevel,
  PracticeQuestionOption,
  QuestionDifficulty,
  QuestionSubject,
  QuestionType
} from '@common/types/domain'

export interface StudyQuestionView {
  id: string
  sessionQuestionId: string | null
  questionVersionId: string | null
  ordinal: number
  level: JlptLevel
  subject: QuestionSubject
  questionType: QuestionType
  passage: string | null
  questionText: string
  options: PracticeQuestionOption[]
  difficulty: QuestionDifficulty
  tags: string[]
}

export interface StudySessionView {
  session: {
    id: string
    level: JlptLevel
    subject: QuestionSubject
    mode: 'BOOKMARK' | 'DAILY_REVIEW' | 'RANDOM' | 'WEAKNESS' | 'WRONG_NOTE'
    status: 'CANCELLED' | 'EXPIRED' | 'IN_PROGRESS' | 'SUBMITTED'
    startedAt: string
    expiresAt: string | null
    submittedAt: string | null
    durationSec: number | null
  }
  questions: StudyQuestionView[]
  requestedCount: number
  actualCount: number
  usedFallback: boolean
  fallbackReason: 'INSUFFICIENT_MODE_CANDIDATES' | null
}

export const toLegacyStudySessionView = (
  response: GetStudySessionResponse
): StudySessionView => ({
  session: {
    id: response.session.id,
    level: response.session.level,
    subject: response.session.subject,
    mode: response.session.mode,
    status: response.session.status,
    startedAt: response.session.startedAt,
    expiresAt: null,
    submittedAt: response.session.submittedAt,
    durationSec: response.session.durationSec
  },
  questions: response.questions.map((question, index) => ({
    ...question,
    sessionQuestionId: null,
    questionVersionId: null,
    ordinal: index + 1
  })),
  requestedCount: response.requestedCount,
  actualCount: response.actualCount,
  usedFallback: response.usedFallback,
  fallbackReason: response.usedFallback ? 'INSUFFICIENT_MODE_CANDIDATES' : null
})

export const toCanonicalStudySessionView = (
  response: StudySessionPayload
): StudySessionView => ({
  session: {
    id: response.session.id,
    level: response.session.level,
    subject: response.session.subject,
    mode: response.session.mode,
    status: response.session.status,
    startedAt: response.session.startedAt,
    expiresAt: response.session.expiresAt,
    submittedAt: response.session.submittedAt,
    durationSec: response.session.durationSec
  },
  questions: response.questions.map(
    ({ ordinal, question, sessionQuestionId }) => ({
      id: question.id,
      sessionQuestionId,
      questionVersionId: question.questionVersionId,
      ordinal,
      level: question.level,
      subject: question.subject,
      questionType: question.questionType,
      passage: question.passage,
      questionText: question.questionText,
      options: question.options,
      difficulty: question.difficulty,
      tags: question.tags.map(({ label }) => label)
    })
  ),
  requestedCount: response.session.requestedCount,
  actualCount: response.session.actualCount,
  usedFallback: response.session.usedFallback,
  fallbackReason: response.session.fallbackReason
})
