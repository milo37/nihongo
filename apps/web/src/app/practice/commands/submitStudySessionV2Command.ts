import { isApiError } from '@api/config'
import { getStudyResultV1 } from '@api/study/getStudyResultV1'
import { submitStudySessionV2 } from '@api/study/submitStudySessionV2'
import type { ParsedSubmitStudySessionV2Request } from '@api/study/submitStudySessionV2/schema'
import { toCanonicalStudyResultView } from '@app/practice/adapters/studyResultView'
import type { StudyResultView } from '@app/practice/adapters/studyResultView'
import {
  StudySubmissionPreTransportError,
  SubmissionOutcomeAmbiguousError
} from '@app/practice/studySubmissionRetry'
import { getOrCreateStudyDraftSubmissionAttempt } from '@app/practice/studyDraftSubmissionAttempt'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'

interface SubmitStudySessionV2CommandOptions {
  input: ParsedSubmitStudySessionV2Request
  sessionId: string
}

export const submitStudySessionV2Command = async ({
  input,
  sessionId
}: SubmitStudySessionV2CommandOptions): Promise<StudyResultView> => {
  let attempt: ReturnType<typeof getOrCreateStudyDraftSubmissionAttempt>
  try {
    attempt = getOrCreateStudyDraftSubmissionAttempt(sessionId, input)
  } catch (error: unknown) {
    throw new StudySubmissionPreTransportError(error)
  }

  try {
    const response = await submitStudySessionV2(
      sessionId,
      attempt.canonicalBody,
      attempt.idempotencyKey
    )
    return toCanonicalStudyResultView(response.data)
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
