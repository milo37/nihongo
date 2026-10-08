import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import {
  jlptLevelSchema,
  practiceContractVersionSchema,
  questionSubjectSchema,
  studyModeSchema,
  studySessionFallbackReasonSchema,
  studySessionStatusSchema
} from '../common/enum.js'
import { opaqueIdSchema } from '../common/id.js'
import { publicPracticeQuestionSchema } from '../question/get-question.js'

export const studySessionSummarySchema = z
  .object({
    id: opaqueIdSchema,
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    mode: studyModeSchema,
    status: studySessionStatusSchema,
    requestedCount: z.number().int().min(1).max(20),
    actualCount: z.number().int().min(1).max(20),
    usedFallback: z.boolean(),
    fallbackReason: studySessionFallbackReasonSchema.nullable(),
    startedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    submittedAt: isoDateTimeSchema.nullable(),
    durationSec: z.number().int().nonnegative().nullable()
  })
  .strict()

export const studySessionQuestionSchema = z
  .object({
    sessionQuestionId: opaqueIdSchema,
    ordinal: z.number().int().positive(),
    question: publicPracticeQuestionSchema
  })
  .strict()

export const versionedStudySessionSummarySchema =
  studySessionSummarySchema.extend({
    practiceContractVersion: practiceContractVersionSchema
  })

type StudySessionPayloadCandidate = {
  session: z.output<typeof studySessionSummarySchema>
  questions: z.output<typeof studySessionQuestionSchema>[]
}

const refineStudySessionPayload = (
  { questions, session }: StudySessionPayloadCandidate,
  context: z.RefinementCtx
): void => {
  if (session.actualCount > session.requestedCount) {
    context.addIssue({
      code: 'custom',
      path: ['session', 'actualCount'],
      message: 'actualCount는 requestedCount를 초과할 수 없습니다.'
    })
  }

  if (questions.length !== session.actualCount) {
    context.addIssue({
      code: 'custom',
      path: ['questions'],
      message: 'questions 수는 actualCount와 같아야 합니다.'
    })
  }

  if (session.usedFallback !== (session.fallbackReason !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['session', 'fallbackReason'],
      message: 'fallback 사용 여부와 사유가 일치해야 합니다.'
    })
  }

  if (session.mode === 'RANDOM' && session.usedFallback) {
    context.addIssue({
      code: 'custom',
      path: ['session', 'fallbackReason'],
      message: 'RANDOM 모드는 다른 모드로 fallback하지 않습니다.'
    })
  }

  if (Date.parse(session.expiresAt) <= Date.parse(session.startedAt)) {
    context.addIssue({
      code: 'custom',
      path: ['session', 'expiresAt'],
      message: 'expiresAt은 startedAt보다 이후여야 합니다.'
    })
  }

  const sessionQuestionIds = new Set<string>()
  const questionIds = new Set<string>()
  const versionIds = new Set<string>()

  questions.forEach((item, index) => {
    if (item.ordinal !== index + 1) {
      context.addIssue({
        code: 'custom',
        path: ['questions', index, 'ordinal'],
        message: 'ordinal은 1부터 연속되어야 합니다.'
      })
    }
    if (
      sessionQuestionIds.has(item.sessionQuestionId) ||
      questionIds.has(item.question.id) ||
      versionIds.has(item.question.questionVersionId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['questions', index],
        message: '세션 문제와 고정 version은 서로 달라야 합니다.'
      })
    }
    if (
      item.question.level !== session.level ||
      item.question.subject !== session.subject
    ) {
      context.addIssue({
        code: 'custom',
        path: ['questions', index, 'question'],
        message: '세션 조건과 문제 조건이 일치해야 합니다.'
      })
    }

    sessionQuestionIds.add(item.sessionQuestionId)
    questionIds.add(item.question.id)
    versionIds.add(item.question.questionVersionId)
  })

  const hasSubmittedAt = session.submittedAt !== null
  const hasDuration = session.durationSec !== null
  const hasCompleteSubmissionMetadata = hasSubmittedAt && hasDuration
  const hasAnySubmissionMetadata = hasSubmittedAt || hasDuration
  if (
    (session.status === 'SUBMITTED' && !hasCompleteSubmissionMetadata) ||
    (session.status !== 'SUBMITTED' && hasAnySubmissionMetadata)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['session', 'submittedAt'],
      message: '제출 상태와 제출 metadata가 일치해야 합니다.'
    })
  }
}

export const studySessionPayloadSchema = z
  .object({
    session: studySessionSummarySchema,
    questions: z.array(studySessionQuestionSchema).min(1).max(20)
  })
  .strict()
  .superRefine(refineStudySessionPayload)

export const versionedStudySessionPayloadSchema = z
  .object({
    session: versionedStudySessionSummarySchema,
    questions: z.array(studySessionQuestionSchema).min(1).max(20)
  })
  .strict()
  .superRefine(refineStudySessionPayload)
  .superRefine(({ session }, context) => {
    if (
      session.practiceContractVersion === 2 &&
      (session.usedFallback || session.fallbackReason !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['session', 'fallbackReason'],
        message: 'v2 세션은 다른 mode나 RANDOM으로 fallback하지 않습니다.'
      })
    }
  })

export type StudySessionPayload = z.output<typeof studySessionPayloadSchema>
export type VersionedStudySessionPayload = z.output<
  typeof versionedStudySessionPayloadSchema
>
