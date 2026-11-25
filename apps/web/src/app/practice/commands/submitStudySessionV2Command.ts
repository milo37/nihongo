import { isApiError } from '@nihongo/browser/api/config'
import { getStudyResultV1 } from '@api/study/getStudyResultV1'
import { submitStudySessionV2 } from '@api/study/submitStudySessionV2'
import type { ParsedSubmitStudySessionV2Request } from '@api/study/submitStudySessionV2/schema'
import { toCanonicalStudyResultView } from '@app/practice/adapters/studyResultView'
import type { StudyResultView } from '@app/practice/adapters/studyResultView'
import { SubmissionOutcomeAmbiguousError } from '@app/practice/studySubmissionRetry'
import { isAuthTransitionSupersededError } from '@nihongo/browser/libs/authTransitionFence'

// #1262: every press sends the answers on screen with a new key; the
// mutation's own retry passes the same input, so it keeps that press's key.
// A press after an unknown outcome gets SESSION_ALREADY_SUBMITTED below.
const idempotencyKeys = new WeakMap<ParsedSubmitStudySessionV2Request, string>()

const getIdempotencyKey = (
  input: ParsedSubmitStudySessionV2Request
): string => {
  const known = idempotencyKeys.get(input)
  if (known) return known
  const created = crypto.randomUUID()
  idempotencyKeys.set(input, created)
  return created
}

interface SubmitStudySessionV2CommandOptions {
  input: ParsedSubmitStudySessionV2Request
  sessionId: string
}

export const submitStudySessionV2Command = async ({
  input,
  sessionId
}: SubmitStudySessionV2CommandOptions): Promise<StudyResultView> => {
  try {
    const response = await submitStudySessionV2(
      sessionId,
      input,
      getIdempotencyKey(input)
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
