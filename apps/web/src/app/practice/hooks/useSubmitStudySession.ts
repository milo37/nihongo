import { useMutation, useQueryClient } from '@tanstack/react-query'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'
import {
  studyMutations,
  studyQueries
} from '@app/practice/queries/studyQueries'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

export const useSubmitStudySession = (sessionId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...studyMutations.submitSession(sessionId),
    onSuccess: (result) => {
      queryClient.setQueryData(studyQueries.result(sessionId).queryKey, result)
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: studyQueries.session(sessionId).queryKey,
          refetchType: 'none'
        }),
        queryClient.invalidateQueries({
          queryKey: wrongNoteQueries.allKey()
        }),
        queryClient.invalidateQueries({
          queryKey: dashboardQueries.allKey()
        })
      ])
    }
  })
}
