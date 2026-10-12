import { useQuery } from '@tanstack/react-query'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

export const useGetWrongNote = (questionId: string, requireFresh = false) => {
  return useQuery({
    ...wrongNoteQueries.detail(questionId),
    refetchOnMount: requireFresh ? 'always' : undefined
  })
}
