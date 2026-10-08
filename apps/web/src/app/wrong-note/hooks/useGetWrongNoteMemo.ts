import { useQuery } from '@tanstack/react-query'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

export const useGetWrongNoteMemo = (questionId: string) => {
  return useQuery(wrongNoteQueries.memo(questionId))
}
