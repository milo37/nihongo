import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SubmitStudySessionRequest } from '@api/study/submitStudySession/schema'
import type { StudyResultView } from '@app/practice/adapters/studyResultView'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { clearSubmissionAttempt } from '@app/practice/submissionAttemptStorage'
import {
  getStudySubmissionRetryDelay,
  isDefinitiveStudySubmissionError,
  isRetryableStudySubmissionError
} from '@app/practice/studySubmissionRetry'
import {
  assertCurrentAuthTransitionEpoch,
  captureAuthTransitionEpoch
} from '@libs/authTransitionFence'

const submissionActionEpochs = new WeakMap<SubmitStudySessionRequest, number>()

export const assertCurrentStudySubmissionAction = (
  input: SubmitStudySessionRequest
): void => {
  const actionEpoch = submissionActionEpochs.get(input)
  if (actionEpoch === undefined) {
    throw new Error('제출 action의 인증 경계를 확인하지 못했습니다.')
  }

  assertCurrentAuthTransitionEpoch(actionEpoch)
}

export const useSubmitStudySession = (sessionId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [
      ...serverStateQueryKeys.study.all(),
      'submit-session',
      sessionId
    ] as const,
    networkMode: 'always',
    onMutate: (input) => {
      submissionActionEpochs.set(input, captureAuthTransitionEpoch())
    },
    mutationFn: async (input: SubmitStudySessionRequest) => {
      assertCurrentStudySubmissionAction(input)

      const { submitStudySessionCommand } = await import(
        '@app/practice/commands/submitStudySessionCommand'
      )

      assertCurrentStudySubmissionAction(input)
      const result = await submitStudySessionCommand({
        sessionId,
        input,
        getCachedSession: () =>
          queryClient.getQueryData<StudySessionView>(
            serverStateQueryKeys.study.session(sessionId)
          )
      })
      assertCurrentStudySubmissionAction(input)
      return result
    },
    retry: (failureCount, error) =>
      failureCount < 1 && isRetryableStudySubmissionError(error),
    retryDelay: getStudySubmissionRetryDelay,
    onSuccess: async (result, input) => {
      assertCurrentStudySubmissionAction(input)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: serverStateQueryKeys.study.session(sessionId),
          refetchType: 'none'
        }),
        queryClient.invalidateQueries({
          queryKey: serverStateQueryKeys.wrongNote.all()
        }),
        queryClient.invalidateQueries({
          queryKey: serverStateQueryKeys.dashboard.all()
        })
      ])
      assertCurrentStudySubmissionAction(input)
      queryClient.setQueryData<StudyResultView>(
        serverStateQueryKeys.study.result(sessionId),
        result
      )
      clearSubmissionAttempt(sessionId)
    },
    onError: (error) => {
      if (isDefinitiveStudySubmissionError(error)) {
        clearSubmissionAttempt(sessionId)
      }
    }
  })
}
