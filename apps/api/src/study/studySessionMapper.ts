import type {
  StudySessionPayload,
  VersionedStudySessionPayload
} from '@nihongo/contracts/study/study-session'
import { toPublicPracticeQuestion } from '../question/questionMapper.js'
import type { StudySessionRecord } from './studySessionRepository.js'

export const toStudySessionPayload = (
  record: StudySessionRecord
): StudySessionPayload => ({
  session: {
    id: record.id,
    level: record.level,
    subject: record.subject,
    mode: record.mode,
    status: record.status,
    requestedCount: record.requestedCount,
    actualCount: record.actualCount,
    usedFallback: record.usedFallback,
    fallbackReason: record.fallbackReason,
    startedAt: record.startedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    submittedAt: record.submittedAt?.toISOString() ?? null,
    durationSec: record.durationSec
  },
  questions: record.questions.map((item) => ({
    sessionQuestionId: item.sessionQuestionId,
    ordinal: item.ordinal,
    question: toPublicPracticeQuestion(item.question)
  }))
})

export const toVersionedStudySessionPayload = (
  record: StudySessionRecord
): VersionedStudySessionPayload => {
  const payload = toStudySessionPayload(record)

  return {
    ...payload,
    session: {
      ...payload.session,
      practiceContractVersion: record.practiceContractVersion ?? 1
    }
  }
}
