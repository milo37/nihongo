import type {
  StudySessionPayload,
  VersionedStudySessionPayload
} from '@nihongo/contracts/study/study-session'
import {
  getQuestionVersionFingerprint,
  toContractPracticeQuestion,
  toStableMockUuid
} from '@mocks/adapters/questionContractAdapter'
import type { MockStudySessionSnapshotRecord } from '@mocks/repository/mockDatabase'
import { toPracticeQuestion } from '@util/question'

const STUDY_SESSION_TTL_MS = 24 * 60 * 60 * 1_000

export const toContractStudySessionPayload = (
  record: MockStudySessionSnapshotRecord,
  now = new Date()
): StudySessionPayload => {
  const startedAtMs = Date.parse(record.session.startedAt)
  const expiresAt = new Date(startedAtMs + STUDY_SESSION_TTL_MS)
  const status =
    record.canonicalStatus ??
    (record.session.status === 'IN_PROGRESS' &&
    now.getTime() >= expiresAt.getTime()
      ? 'EXPIRED'
      : record.session.status)

  return {
    session: {
      id: record.session.id,
      level: record.session.level,
      subject: record.session.subject,
      mode: record.session.mode,
      status,
      requestedCount: record.requestedCount,
      actualCount: record.questions.length,
      usedFallback: false,
      fallbackReason: null,
      startedAt: record.session.startedAt,
      expiresAt: expiresAt.toISOString(),
      submittedAt: record.session.submittedAt,
      durationSec: record.session.durationSec
    },
    questions: record.questions.map((question, index) => {
      const ordinal = index + 1
      const versionFingerprint = getQuestionVersionFingerprint(question)

      return {
        sessionQuestionId: toStableMockUuid(
          'study-session-question',
          `${record.session.id}:${ordinal}`
        ),
        ordinal,
        question: toContractPracticeQuestion(
          toPracticeQuestion(question),
          versionFingerprint
        )
      }
    })
  }
}

export const toVersionedContractStudySessionPayload = (
  record: MockStudySessionSnapshotRecord,
  now = new Date()
): VersionedStudySessionPayload => {
  const payload = toContractStudySessionPayload(record, now)
  const practiceContractVersion = record.practiceContractVersion
  if (!practiceContractVersion) {
    throw new Error('canonical session contract version이 없습니다.')
  }

  return {
    ...payload,
    session: {
      ...payload.session,
      practiceContractVersion
    }
  }
}
