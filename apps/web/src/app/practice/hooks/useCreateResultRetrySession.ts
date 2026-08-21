import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isApiError } from '@api/config'
import {
  assertCurrentResultRetryAction,
  clearCompletedResultRetryAction,
  handleResultRetryActionError,
  requestResultRetryAction,
  studyResultRetryMutations,
  type CreateResultRetryActionInput
} from '@app/practice/queries/studyResultRetryQueries'
import { studySessionQueries } from '@app/practice/queries/studySessionQueries'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'

class ResultRetryReconciliationError extends Error {
  constructor(options: ErrorOptions) {
    super('오답 재출제 세션의 현재 상태를 확인하지 못했습니다.', options)
    this.name = 'ResultRetryReconciliationError'
  }
}

export const useCreateResultRetrySession = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...studyResultRetryMutations.create(),
    mutationFn: async (input: CreateResultRetryActionInput) => {
      const created = await requestResultRetryAction(input)
      assertCurrentResultRetryAction(input)
      if (!created.replayed) {
        return created
      }

      const targetSessionId = created.session.session.id
      const query = studySessionQueries.session(targetSessionId)
      await queryClient.cancelQueries({ queryKey: query.queryKey, exact: true })
      queryClient.removeQueries({ queryKey: query.queryKey, exact: true })
      const canonical = await queryClient
        .fetchQuery({
          ...query,
          staleTime: 0
        })
        .catch((error: unknown) => {
          assertCurrentResultRetryAction(input)
          if (
            isAuthTransitionSupersededError(error) ||
            (isApiError(error) && (error.isAuthError || error.isForbiddenError))
          ) {
            throw error
          }
          throw new ResultRetryReconciliationError({ cause: error })
        })
      assertCurrentResultRetryAction(input)
      return { ...created, session: canonical }
    },
    onError: (error, input) => {
      handleResultRetryActionError(error, input)
    },
    onSuccess: async (created, input) => {
      assertCurrentResultRetryAction(input)
      if (!created.replayed) {
        const targetQuery = studySessionQueries.session(
          created.session.session.id
        )
        queryClient.setQueryData(targetQuery.queryKey, created.session)
      }
      await queryClient.invalidateQueries({
        queryKey: serverStateQueryKeys.study.resumableSessions()
      })
      assertCurrentResultRetryAction(input)
      clearCompletedResultRetryAction(input)
    }
  })
}
