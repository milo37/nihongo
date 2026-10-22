import { useQuery } from '@tanstack/react-query'
import { studyDraftQueries } from '@app/practice/queries/studyDraftQueries'

export const useGetStudyDraft = (sessionId: string, enabled: boolean) =>
  useQuery(studyDraftQueries.draft(sessionId, enabled))
