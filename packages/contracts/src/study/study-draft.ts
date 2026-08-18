import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import { opaqueIdSchema } from '../common/id.js'

export const studyDraftAnswerSchema = z
  .object({
    studySessionQuestionId: opaqueIdSchema,
    selectedOptionId: opaqueIdSchema.nullable(),
    elapsedSec: z.number().int().min(0).max(86_400)
  })
  .strict()

type DraftAnswersCandidate = {
  answers: z.output<typeof studyDraftAnswerSchema>[]
  currentOrdinal: number
}

export const refineStudyDraftAnswers = (
  { answers, currentOrdinal }: DraftAnswersCandidate,
  context: z.RefinementCtx
): void => {
  if (currentOrdinal > answers.length) {
    context.addIssue({
      code: 'custom',
      path: ['currentOrdinal'],
      message: 'currentOrdinal은 answer 배열 범위 안이어야 합니다.'
    })
  }

  const sessionQuestionIds = new Set<string>()

  answers.forEach((answer, index) => {
    if (sessionQuestionIds.has(answer.studySessionQuestionId)) {
      context.addIssue({
        code: 'custom',
        path: ['answers', index, 'studySessionQuestionId'],
        message: 'draft answer의 세션 문제 ID는 서로 달라야 합니다.'
      })
    }

    sessionQuestionIds.add(answer.studySessionQuestionId)
  })
}

export const studyDraftSnapshotSchema = z
  .object({
    studySessionId: opaqueIdSchema,
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currentOrdinal: z.number().int().min(1).max(20),
    savedAt: isoDateTimeSchema.nullable(),
    answers: z.array(studyDraftAnswerSchema).min(1).max(20)
  })
  .strict()
  .superRefine((snapshot, context) => {
    refineStudyDraftAnswers(snapshot, context)

    if (
      (snapshot.revision === 0 && snapshot.savedAt !== null) ||
      (snapshot.revision > 0 && snapshot.savedAt === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['savedAt'],
        message:
          'revision 0은 savedAt이 null이고 저장된 revision은 시각이 필요합니다.'
      })
    }
  })

export type StudyDraftAnswer = z.output<typeof studyDraftAnswerSchema>
export type StudyDraftSnapshot = z.output<typeof studyDraftSnapshotSchema>
