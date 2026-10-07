import { mutationOptions } from '@tanstack/react-query'
import { isApiError } from '@api/config'
import { createTargetedReviewSession } from '@api/wrong-note/createTargetedReviewSession'
import { updateWrongNoteMemoV1 } from '@api/wrong-note/updateWrongNoteMemoV1'
import type { ParsedUpdateWrongNoteMemoBody } from '@api/wrong-note/updateWrongNoteMemoV1/schema'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import {
  clearTargetedReviewAttempt,
  getOrCreateTargetedReviewAttempt,
  type TargetedReviewAttempt
} from '@app/wrong-note/targetedReviewAttemptStorage'
import { serverStateQueryKeys } from '@libs/serverStateQueryKeys'
import { createObjectAuthBoundActionFence } from '@libs/authTransitionFence'

export type UpdateMemoActionInput = ParsedUpdateWrongNoteMemoBody

export interface CreateTargetedReviewActionInput {
  readonly principalScope: string
  readonly questionId: string
}

export interface CreateTargetedReviewActionResult {
  readonly replayed: boolean
  readonly session: ReturnType<typeof toCanonicalStudySessionView>
}

const memoActionFence =
  createObjectAuthBoundActionFence<UpdateMemoActionInput>()
const targetedActionFence =
  createObjectAuthBoundActionFence<CreateTargetedReviewActionInput>()
const targetedAttemptByInput = new WeakMap<
  CreateTargetedReviewActionInput,
  TargetedReviewAttempt
>()

export const assertCurrentMemoAction = (input: UpdateMemoActionInput): void =>
  memoActionFence.assertCurrent(input)

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
  updateMemo: (questionId: string) =>
    mutationOptions({
      mutationKey: [
        ...serverStateQueryKeys.wrongNote.memo(questionId),
        'update'
      ] as const,
      networkMode: 'always',
      onMutate: (input: UpdateMemoActionInput) =>
        memoActionFence.capture(input),
      mutationFn: async (input: UpdateMemoActionInput) => {
        assertCurrentMemoAction(input)
        const memo = await updateWrongNoteMemoV1(questionId, input)
        assertCurrentMemoAction(input)
        return memo
      }
    }),
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
