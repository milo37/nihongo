import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ParsedSubmitStudySessionV2Request } from '@api/study/submitStudySessionV2/schema'
import type { StudyResultView } from '@app/practice/adapters/studyResultView'
import { clearStudyDraftWorkingCopy } from '@app/practice/draft/studyDraftWorkingCopyStorage'
import { clearSubmissionAttempt } from '@app/practice/submissionAttemptStorage'
import {
  getStudySubmissionRetryDelay,
  isDefinitiveStudySubmissionError,
  isRetryableStudySubmissionError
} from '@app/practice/studySubmissionRetry'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import {
  assertCurrentAuthTransitionEpoch,
  captureAuthTransitionEpoch
} from '@libs/authTransitionFence'

const submissionActionEpochs = new WeakMap<
  ParsedSubmitStudySessionV2Request,
  number
>()

export const assertCurrentStudySubmissionV2Action = (
  input: ParsedSubmitStudySessionV2Request
): void => {
  const actionEpoch = submissionActionEpochs.get(input)
  if (actionEpoch === undefined) {
    throw new Error('v2 제출 action의 인증 경계를 확인하지 못했습니다.')
  }
  assertCurrentAuthTransitionEpoch(actionEpoch)
}

export const useSubmitStudySessionV2 = (
  sessionId: string,
  principalScope: string
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [
      ...serverStateQueryKeys.study.all(),
      'submit-session-v2',
      sessionId
    ] as const,
    networkMode: 'always',
    onMutate: (input) => {
      submissionActionEpochs.set(input, captureAuthTransitionEpoch())
    },
    mutationFn: async (input: ParsedSubmitStudySessionV2Request) => {
      assertCurrentStudySubmissionV2Action(input)
      const { submitStudySessionV2Command } = await import(
        '@app/practice/commands/submitStudySessionV2Command'
      )
      assertCurrentStudySubmissionV2Action(input)
      const result = await submitStudySessionV2Command({ input, sessionId })
      assertCurrentStudySubmissionV2Action(input)
      return result
    },
    retry: (failureCount, error) =>
      failureCount < 1 && isRetryableStudySubmissionError(error),
    retryDelay: getStudySubmissionRetryDelay,
    onSuccess: async (result, input) => {
      assertCurrentStudySubmissionV2Action(input)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: serverStateQueryKeys.study.session(sessionId),
          refetchType: 'none'
        }),
        queryClient.invalidateQueries({
          queryKey: serverStateQueryKeys.study.sessions(),
          refetchType: 'none'
        }),
        queryClient.invalidateQueries({
          queryKey: serverStateQueryKeys.wrongNote.all()
        }),
        queryClient.invalidateQueries({
          queryKey: serverStateQueryKeys.dashboard.all()
        })
      ])
      assertCurrentStudySubmissionV2Action(input)
      queryClient.removeQueries({
        queryKey: serverStateQueryKeys.study.draft(sessionId),
        exact: true
      })
      queryClient.setQueryData<StudyResultView>(
        serverStateQueryKeys.study.result(sessionId),
        result
      )
      clearStudyDraftWorkingCopy(principalScope, sessionId)
      clearSubmissionAttempt(sessionId)
    },
    onError: (error) => {
      if (isDefinitiveStudySubmissionError(error)) {
        clearSubmissionAttempt(sessionId)
      }
    }
  })
}
