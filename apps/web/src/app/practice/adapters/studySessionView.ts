import type { FuriganaSegment } from '@nihongo/contracts/question/get-question'
import { passageAudioKey } from '@app/practice/session/passageAudio/passageAudioSource'
import type {
  StudySessionPayload,
  VersionedStudySessionPayload
} from '@nihongo/contracts/study/study-session'
import type {
  JlptLevel,
  PracticeQuestionOption,
  QuestionDifficulty,
  QuestionSubject,
  QuestionType
} from '@nihongo/browser/common/types/domain'

export interface StudyQuestionView {
  id: string
  sessionQuestionId: string | null
  questionVersionId: string | null
  ordinal: number
  level: JlptLevel
  subject: QuestionSubject
  questionType: QuestionType
  passage: string | null
  /** #1182: reviewed passage furigana; null or absent when there is none. */
  passageFurigana?: readonly FuriganaSegment[] | null
  /** #1183: read-aloud file key; null or absent when there is none. */
  passageAudioKey?: string | null
  questionText: string
  options: PracticeQuestionOption[]
  difficulty: QuestionDifficulty
  tags: string[]
  tagSummaries?: Array<{
    id: string
    label: string
    labelJa?: string | null
  }> | null
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
    practiceContractVersion: 1 | 2
  }
  questions: StudyQuestionView[]
  requestedCount: number
  actualCount: number
  usedFallback: boolean
  fallbackReason: 'INSUFFICIENT_MODE_CANDIDATES' | null
}

export const toCanonicalStudySessionView = (
  response: StudySessionPayload | VersionedStudySessionPayload
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
    durationSec: response.session.durationSec,
    practiceContractVersion:
      'practiceContractVersion' in response.session
        ? response.session.practiceContractVersion
        : 1
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
      passageFurigana: question.passageFurigana ?? null,
      passageAudioKey: passageAudioKey(question.passage),
      questionText: question.questionText,
      options: question.options,
      difficulty: question.difficulty,
      tags: question.tags.map(({ label }) => label),
      tagSummaries: question.tags
    })
  ),
  requestedCount: response.session.requestedCount,
  actualCount: response.session.actualCount,
  usedFallback: response.session.usedFallback,
  fallbackReason: response.session.fallbackReason
})
