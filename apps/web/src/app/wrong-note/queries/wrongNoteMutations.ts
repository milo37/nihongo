import { mutationOptions } from '@tanstack/react-query'
import { isApiError } from '@nihongo/browser/api/config'
import { createTargetedReviewSession } from '@api/wrong-note/createTargetedReviewSession'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import {
  clearTargetedReviewAttempt,
  getOrCreateTargetedReviewAttempt,
  type TargetedReviewAttempt
} from '@nihongo/browser/app/wrong-note/targetedReviewAttemptStorage'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'
import { createObjectAuthBoundActionFence } from '@nihongo/browser/libs/authTransitionFence'

export interface CreateTargetedReviewActionInput {
  readonly principalScope: string
  readonly questionId: string
}

export interface CreateTargetedReviewActionResult {
  readonly replayed: boolean
  readonly session: ReturnType<typeof toCanonicalStudySessionView>
}

const targetedActionFence =
  createObjectAuthBoundActionFence<CreateTargetedReviewActionInput>()
const targetedAttemptByInput = new WeakMap<
  CreateTargetedReviewActionInput,
  TargetedReviewAttempt
>()

export const assertCurrentTargetedReviewAction = (
  input: CreateTargetedReviewActionInput
): void => targetedActionFence.assertCurrent(input)

export const completeTargetedReviewAction = (
  input: CreateTargetedReviewActionInput
): void => {
  assertCurrentTargetedReviewAction(input)
  clearTargetedReviewAttempt(input.principalScope, input.questionId)
  targetedAttemptByInput.delete(input)
}

export const handleTargetedReviewActionError = (
  error: unknown,
  input: CreateTargetedReviewActionInput
): void => {
  try {
    assertCurrentTargetedReviewAction(input)
  } catch {
    return
  }

  const definitiveClientFailure =
    isApiError(error) &&
    !error.isResponseValidationError &&
    !error.isNetworkError &&
    !error.isOffline &&
    error.status !== undefined &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  if (definitiveClientFailure) {
    clearTargetedReviewAttempt(input.principalScope, input.questionId)
  }
  targetedAttemptByInput.delete(input)
}

export const requestTargetedReviewAction = async (
  input: CreateTargetedReviewActionInput
): Promise<CreateTargetedReviewActionResult> => {
  assertCurrentTargetedReviewAction(input)
  const attempt = targetedAttemptByInput.get(input)
  if (!attempt) {
    throw new Error('단일 복습 복구 attempt를 확인하지 못했습니다.')
  }
  const response = await createTargetedReviewSession(
    input.questionId,
    attempt.idempotencyKey
  )
  assertCurrentTargetedReviewAction(input)
  return {
    replayed: response.headers['idempotency-replayed'] === 'true',
    session: toCanonicalStudySessionView(response.data)
  }
}

export const wrongNoteMutations = {
  createTargetedReview: () =>
    mutationOptions({
      mutationKey: [
        ...serverStateQueryKeys.study.sessions(),
        'targeted-review'
      ] as const,
      networkMode: 'online',
      onMutate: (input: CreateTargetedReviewActionInput) => {
        targetedActionFence.capture(input)
        const attempt = getOrCreateTargetedReviewAttempt(
          input.principalScope,
          input.questionId
        )
        targetedAttemptByInput.set(input, attempt)
      },
      mutationFn: requestTargetedReviewAction,
      onError: handleTargetedReviewActionError
    })
} as const
