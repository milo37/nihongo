import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { GetAdminQuestionResponse } from '@api/admin-question/getAdminQuestion/schema'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'
const selectedVersion = (detail: GetAdminQuestionResponse | undefined) => {
  const id =
    detail?.question.openCandidateVersionId ??
    detail?.question.currentPublishedVersionId
  return id
    ? detail?.versions.items.find((version) => version.questionVersionId === id)
    : detail?.versions.items[0]
}
export const useGetAdminQuestion = (questionId: string) => {
  const client = useQueryClient()
  const detail = useQuery({
    ...adminQuestionQueries.detail(questionId),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  })
  const version = selectedVersion(detail.data)
  const preview = useQuery({
    ...adminQuestionQueries.preview(
      questionId,
      version?.questionVersionId ?? '',
      version?.rowVersion ?? 0
    ),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  })
  return {
    data: detail.data,
    version,
    preview: preview.data,
    isPending: detail.isPending || Boolean(version && preview.isPending),
    isError: detail.isError || Boolean(version && preview.isError),
    error: detail.error ?? preview.error,
    isSuccess: detail.isSuccess && Boolean(!version || preview.isSuccess),
    refetch: async () => {
      const fresh = await client.fetchQuery({
        ...adminQuestionQueries.detail(questionId),
        staleTime: 0
      })
      const selected = selectedVersion(fresh)
      if (!selected) throw new Error('현재 버전 정보를 확인할 수 없습니다.')
      const freshPreview = await client.fetchQuery({
        ...adminQuestionQueries.preview(
          questionId,
          selected.questionVersionId,
          selected.rowVersion
        ),
        staleTime: 0
      })
      return { data: fresh, version: selected, preview: freshPreview }
    }
  }
}
