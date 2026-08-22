import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isApiError } from '@api/config'
import { studyDraftQueries } from '@app/practice/queries/studyDraftQueries'
import { studySessionQueries } from '@app/practice/queries/studySessionQueries'
import {
  assertCurrentTargetedReviewAction,
  handleTargetedReviewActionError,
  requestTargetedReviewAction,
  wrongNoteMutations,
  type CreateTargetedReviewActionInput
} from '@app/wrong-note/queries/wrongNoteMutations'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'

class TargetedReviewReconciliationError extends Error {
  constructor(options: ErrorOptions) {
    super('단일 복습 세션의 현재 상태를 확인하지 못했습니다.', options)
    this.name = 'TargetedReviewReconciliationError'
  }
}

export const useCreateTargetedReviewSession = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...wrongNoteMutations.createTargetedReview(),
    mutationFn: async (input: CreateTargetedReviewActionInput) => {
      const created = await requestTargetedReviewAction(input)
      assertCurrentTargetedReviewAction(input)

      let session = created.session
      const sessionId = session.session.id
      if (created.replayed) {
        const sessionQuery = studySessionQueries.session(sessionId)
        await queryClient.cancelQueries({
          queryKey: sessionQuery.queryKey,
          exact: true
        })
        assertCurrentTargetedReviewAction(input)
        queryClient.removeQueries({
          queryKey: sessionQuery.queryKey,
          exact: true
        })
        session = await queryClient
          .fetchQuery({ ...sessionQuery, staleTime: 0 })
          .catch((error: unknown) => {
            assertCurrentTargetedReviewAction(input)
            if (
              isAuthTransitionSupersededError(error) ||
              (isApiError(error) &&
                (error.isAuthError || error.isForbiddenError))
            ) {
              throw error
            }
            throw new TargetedReviewReconciliationError({ cause: error })
          })
      } else {
        queryClient.setQueryData(
          studySessionQueries.session(sessionId).queryKey,
          session
        )
      }

      assertCurrentTargetedReviewAction(input)
      if (session.session.status === 'IN_PROGRESS') {
        await queryClient
          .fetchQuery({
            ...studyDraftQueries.draft(sessionId),
            staleTime: 0
          })
          .catch((error: unknown) => {
            assertCurrentTargetedReviewAction(input)
            if (
              isAuthTransitionSupersededError(error) ||
              (isApiError(error) &&
                (error.isAuthError || error.isForbiddenError))
            ) {
              throw error
            }
            throw new TargetedReviewReconciliationError({ cause: error })
          })
      } else {
        queryClient.removeQueries({
          queryKey: serverStateQueryKeys.study.draft(sessionId),
          exact: true
        })
      }
      assertCurrentTargetedReviewAction(input)
      return { ...created, session }
    },
    onError: (error, input) => {
      handleTargetedReviewActionError(error, input)
    },
    onSuccess: async (created, input) => {
      assertCurrentTargetedReviewAction(input)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: serverStateQueryKeys.study.resumableSessions(),
          refetchType: 'none'
        }),
        queryClient.invalidateQueries({
          queryKey: wrongNoteQueries.detail(input.questionId).queryKey,
          exact: true,
          refetchType: 'none'
        })
      ])
      assertCurrentTargetedReviewAction(input)
      queryClient.setQueryData(
        studySessionQueries.session(created.session.session.id).queryKey,
        created.session
      )
    }
  })
}
