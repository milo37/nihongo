import { z } from 'zod'
import type { ParsedSubmitStudySessionV2Request } from '@api/study/submitStudySessionV2/schema'
import {
  clearSubmissionAttempt,
  readStoredSubmissionAttempt,
  writeStoredSubmissionAttempt
} from '@app/practice/submissionAttemptStorage'

const storedStudyDraftSubmissionBodySchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            elapsedSec: z.number().int().min(0).max(86_400),
            selectedOptionId: z.uuid().nullable(),
            studySessionQuestionId: z.uuid()
          })
          .strict()
      )
      .min(1)
      .max(20),
    durationSec: z.number().int().min(0).max(604_800),
    expectedDraftRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
  })
  .strict()
  .superRefine(({ answers }, context) => {
    const seenQuestionIds = new Set<string>()
    answers.forEach(({ studySessionQuestionId }, index) => {
      if (seenQuestionIds.has(studySessionQuestionId)) {
        context.addIssue({
          code: 'custom',
          path: ['answers', index, 'studySessionQuestionId'],
          message: '저장된 제출 답안의 세션 문제 ID는 서로 달라야 합니다.'
        })
      }
      seenQuestionIds.add(studySessionQuestionId)
    })
  })

const studyDraftSubmissionAttemptSchema = z
  .object({
    canonicalBody: storedStudyDraftSubmissionBodySchema,
    contractVersion: z.literal(2),
    idempotencyKey: z.uuid()
  })
  .strict()

export interface StudyDraftSubmissionAttempt {
  canonicalBody: ParsedSubmitStudySessionV2Request
  contractVersion: 2
  idempotencyKey: string
}

export const readStudyDraftSubmissionAttempt = (
  sessionId: string
): StudyDraftSubmissionAttempt | null => {
  const result = studyDraftSubmissionAttemptSchema.safeParse(
    readStoredSubmissionAttempt(sessionId)
  )
  return result.success ? result.data : null
}

export const getOrCreateStudyDraftSubmissionAttempt = (
  sessionId: string,
  body: ParsedSubmitStudySessionV2Request
): StudyDraftSubmissionAttempt => {
  const stored = readStudyDraftSubmissionAttempt(sessionId)
  if (stored) {
    return stored
  }

  const attempt = studyDraftSubmissionAttemptSchema.parse({
    canonicalBody: body,
    contractVersion: 2,
    idempotencyKey: crypto.randomUUID()
  })
  writeStoredSubmissionAttempt(sessionId, attempt)
  return attempt
}

export const clearInvalidStudyDraftSubmissionAttempt = (
  sessionId: string
): void => {
  if (
    readStoredSubmissionAttempt(sessionId) !== null &&
    readStudyDraftSubmissionAttempt(sessionId) === null
  ) {
    clearSubmissionAttempt(sessionId)
  }
}
