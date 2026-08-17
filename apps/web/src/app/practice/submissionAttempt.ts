import { z } from 'zod'
import { submitStudySessionRequestSchema } from '@api/study/submitStudySession/schema'
import type { SubmitStudySessionRequest } from '@api/study/submitStudySession/schema'
import { submitStudySessionV1RequestSchema } from '@api/study/submitStudySessionV1/requestSchema'
import type { ParsedSubmitStudySessionV1Request } from '@api/study/submitStudySessionV1/requestSchema'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import {
  clearSubmissionAttempt,
  readStoredSubmissionAttempt,
  writeStoredSubmissionAttempt
} from '@app/practice/submissionAttemptStorage'

const submissionAttemptSchema = z
  .object({
    logicalRequest: submitStudySessionRequestSchema,
    canonicalBody: submitStudySessionV1RequestSchema,
    idempotencyKey: z.uuid(),
    selectionFingerprint: z.string().min(1)
  })
  .strict()

export interface CanonicalSubmissionAttempt {
  logicalRequest: SubmitStudySessionRequest
  canonicalBody: ParsedSubmitStudySessionV1Request
  idempotencyKey: string
  selectionFingerprint: string
}

const readAttempt = (sessionId: string): CanonicalSubmissionAttempt | null => {
  try {
    const attempt = submissionAttemptSchema.parse(
      readStoredSubmissionAttempt(sessionId)
    )
    return attempt
  } catch {
    clearSubmissionAttempt(sessionId)
    return null
  }
}

const writeAttempt = (
  sessionId: string,
  attempt: CanonicalSubmissionAttempt
): CanonicalSubmissionAttempt => {
  writeStoredSubmissionAttempt(sessionId, attempt)
  return attempt
}

const buildCanonicalBody = (
  logicalRequest: SubmitStudySessionRequest,
  session: StudySessionView
): ParsedSubmitStudySessionV1Request => {
  const answersByQuestionId = new Map(
    logicalRequest.answers.map((answer) => [answer.questionId, answer])
  )

  if (answersByQuestionId.size !== logicalRequest.answers.length) {
    throw new Error('같은 문제의 답안을 중복 제출할 수 없습니다.')
  }

  const sessionQuestionIds = new Set(
    session.questions.map((question) => question.id)
  )
  const hasUnknownQuestion = logicalRequest.answers.some(
    (answer) => !sessionQuestionIds.has(answer.questionId)
  )
  if (hasUnknownQuestion) {
    throw new Error('현재 세션에 없는 문제의 답안은 제출할 수 없습니다.')
  }

  const answers = session.questions
    .toSorted((left, right) => left.ordinal - right.ordinal)
    .map((question) => {
      if (question.sessionQuestionId === null) {
        throw new Error('canonical sessionQuestionId 매핑을 찾지 못했습니다.')
      }

      const answer = answersByQuestionId.get(question.id)
      return {
        studySessionQuestionId: question.sessionQuestionId,
        selectedOptionId: answer?.selectedOptionId ?? null,
        elapsedSec: answer?.elapsedSec ?? 0
      }
    })

  return submitStudySessionV1RequestSchema.parse({
    answers,
    durationSec: logicalRequest.durationSec
  })
}

const validateLogicalAnswers = (
  logicalRequest: SubmitStudySessionRequest,
  session: StudySessionView
): void => {
  const answeredQuestionIds = new Set(
    logicalRequest.answers.map((answer) => answer.questionId)
  )

  if (answeredQuestionIds.size !== logicalRequest.answers.length) {
    throw new Error('같은 문제의 답안을 중복 제출할 수 없습니다.')
  }

  const sessionQuestionIds = new Set(
    session.questions.map((question) => question.id)
  )
  if (
    logicalRequest.answers.some(
      (answer) => !sessionQuestionIds.has(answer.questionId)
    )
  ) {
    throw new Error('현재 세션에 없는 문제의 답안은 제출할 수 없습니다.')
  }
}

const createSelectionFingerprint = (
  logicalRequest: SubmitStudySessionRequest,
  session: StudySessionView
): string => {
  const selectedOptions = new Map(
    logicalRequest.answers.map((answer) => [
      answer.questionId,
      answer.selectedOptionId
    ])
  )

  return JSON.stringify(
    session.questions
      .toSorted((left, right) => left.ordinal - right.ordinal)
      .map((question) => ({
        questionId: question.id,
        selectedOptionId: selectedOptions.get(question.id) ?? null
      }))
  )
}

export const getOrCreateCanonicalSubmissionAttempt = (
  sessionId: string,
  input: SubmitStudySessionRequest,
  session: StudySessionView
): CanonicalSubmissionAttempt => {
  const currentAttempt = readAttempt(sessionId)
  if (currentAttempt) {
    return currentAttempt
  }

  const logicalRequest = submitStudySessionRequestSchema.parse(input)
  validateLogicalAnswers(logicalRequest, session)
  const selectionFingerprint = createSelectionFingerprint(
    logicalRequest,
    session
  )
  const canonicalBody = buildCanonicalBody(logicalRequest, session)

  return writeAttempt(sessionId, {
    logicalRequest,
    canonicalBody,
    idempotencyKey: crypto.randomUUID(),
    selectionFingerprint
  })
}

export {
  clearAllSubmissionAttempts,
  clearSubmissionAttempt,
  clearSubmissionAttemptMemoryCache,
  getSubmissionAttemptStorageKey
} from '@app/practice/submissionAttemptStorage'
