import { isApiError } from '@api/config'
import { submitStudySession } from '@api/study/submitStudySession'
import type { SubmitStudySessionRequest } from '@api/study/submitStudySession/schema'
import { submitStudySessionV1 } from '@api/study/submitStudySessionV1'
import { getStudyResultV1 } from '@api/study/getStudyResultV1'
import {
  toCanonicalStudyResultView,
  toLegacyStudyResultView
} from '@app/practice/adapters/studyResultView'
import type { StudyResultView } from '@app/practice/adapters/studyResultView'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import {
  StudySubmissionPreTransportError,
  SubmissionOutcomeAmbiguousError
} from '@app/practice/studySubmissionRetry'
import { getOrCreateCanonicalSubmissionAttempt } from '@app/practice/submissionAttempt'
import { isMockApiMode } from '@libs/apiMode'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'

interface SubmitStudySessionCommandOptions {
  getCachedSession: () => StudySessionView | undefined
  input: SubmitStudySessionRequest
  sessionId: string
}

export const submitStudySessionCommand = async ({
  getCachedSession,
  input,
  sessionId
}: SubmitStudySessionCommandOptions): Promise<StudyResultView> => {
  if (isMockApiMode) {
    return toLegacyStudyResultView(await submitStudySession(sessionId, input))
  }

  const session = getCachedSession()
  if (!session) {
    throw new StudySubmissionPreTransportError(
      new Error(
        '제출에 필요한 canonical sessionQuestionId 매핑이 없습니다. 세션을 다시 불러와 주세요.'
      )
    )
  }

  let attempt: ReturnType<typeof getOrCreateCanonicalSubmissionAttempt>
  try {
    attempt = getOrCreateCanonicalSubmissionAttempt(sessionId, input, session)
  } catch (error: unknown) {
    throw new StudySubmissionPreTransportError(error)
  }
  try {
    return toCanonicalStudyResultView(
      await submitStudySessionV1(
        sessionId,
        attempt.canonicalBody,
        attempt.idempotencyKey
      )
    )
  } catch (error: unknown) {
    if (
      isApiError(error) &&
      (error.code === 'SESSION_ALREADY_SUBMITTED' ||
        error.isResponseValidationError)
    ) {
      try {
        return toCanonicalStudyResultView(await getStudyResultV1(sessionId))
      } catch (reconciliationError: unknown) {
        if (
          isAuthTransitionSupersededError(reconciliationError) ||
          (isApiError(reconciliationError) &&
            (reconciliationError.isAuthError ||
              reconciliationError.isForbiddenError))
        ) {
          throw reconciliationError
        }
        throw new SubmissionOutcomeAmbiguousError(reconciliationError)
      }
    }

    throw error
  }
}
