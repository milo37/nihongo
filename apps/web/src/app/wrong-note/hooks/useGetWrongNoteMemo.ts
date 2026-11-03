import { useQuery } from '@tanstack/react-query'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

export const useGetWrongNoteMemo = (questionId: string) =>
  useQuery(wrongNoteQueries.memo(questionId))
