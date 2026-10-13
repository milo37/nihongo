import { useQuery } from '@tanstack/react-query'
import { studyDraftQueries } from '@app/practice/queries/studyDraftQueries'

export const useListResumableStudySessions = (
  page = 1,
  pageSize = 5,
  enabled = true
) =>
  useQuery(
    studyDraftQueries.resumable(
      { page, pageSize, status: 'IN_PROGRESS' },
      enabled
    )
  )
