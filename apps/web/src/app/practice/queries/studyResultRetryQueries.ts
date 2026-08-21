import { mutationOptions } from '@tanstack/react-query'
import { isApiError } from '@api/config'
import { createResultRetrySession } from '@api/study/createResultRetrySession'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import {
  clearResultRetryAttempt,
  getOrCreateResultRetryAttempt,
  type ResultRetryAttempt
} from '@app/practice/resultRetryAttemptStorage'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { createObjectAuthBoundActionFence } from '@libs/authTransitionFence'

export interface CreateResultRetryActionInput {
  readonly principalScope: string
  readonly sourceSessionId: string
}

export interface CreateResultRetryActionResult {
  readonly replayed: boolean
  readonly session: ReturnType<typeof toCanonicalStudySessionView>
}

const retryActionFence =
  createObjectAuthBoundActionFence<CreateResultRetryActionInput>()
const attemptByInput = new WeakMap<
  CreateResultRetryActionInput,
  ResultRetryAttempt
>()

export const assertCurrentResultRetryAction = (
  input: CreateResultRetryActionInput
): void => retryActionFence.assertCurrent(input)

export const clearCompletedResultRetryAction = (
  input: CreateResultRetryActionInput
): void => {
  assertCurrentResultRetryAction(input)
  clearResultRetryAttempt(input.principalScope, input.sourceSessionId)
  attemptByInput.delete(input)
}

export const handleResultRetryActionError = (
  error: unknown,
  input: CreateResultRetryActionInput
): void => {
  try {
    assertCurrentResultRetryAction(input)
  } catch {
    return
  }

  const isDefinitiveClientFailure =
    isApiError(error) &&
    !error.isResponseValidationError &&
    !error.isNetworkError &&
    !error.isOffline &&
    error.status !== undefined &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  if (isDefinitiveClientFailure) {
    clearResultRetryAttempt(input.principalScope, input.sourceSessionId)
  }
  attemptByInput.delete(input)
}

export const requestResultRetryAction = async (
  input: CreateResultRetryActionInput
): Promise<CreateResultRetryActionResult> => {
  assertCurrentResultRetryAction(input)
  const attempt = attemptByInput.get(input)
  if (!attempt) {
    throw new Error('오답 재출제 복구 attempt를 확인하지 못했습니다.')
  }
  const response = await createResultRetrySession(
    input.sourceSessionId,
    attempt.idempotencyKey
  )
  assertCurrentResultRetryAction(input)
  return {
    replayed: response.headers['idempotency-replayed'] === 'true',
    session: toCanonicalStudySessionView(response.data)
  }
}

export const studyResultRetryMutations = {
  create: () =>
    mutationOptions({
      mutationKey: [
        ...serverStateQueryKeys.study.sessions(),
        'result-retry'
      ] as const,
      networkMode: 'online',
      onMutate: (input: CreateResultRetryActionInput) => {
        retryActionFence.capture(input)
        const attempt = getOrCreateResultRetryAttempt(
          input.principalScope,
          input.sourceSessionId
        )
        attemptByInput.set(input, attempt)
      },
      mutationFn: requestResultRetryAction,
      onError: handleResultRetryActionError
    })
} as const
