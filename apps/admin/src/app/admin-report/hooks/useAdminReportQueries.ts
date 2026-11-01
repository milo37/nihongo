import { useSyncExternalStore } from 'react'
import { onlineManager, useQuery } from '@tanstack/react-query'
import type { ListAdminQuestionReportsQuery } from '@nihongo/contracts/admin/content-operations'
import { getAdminQuestionReportParamsSchema } from '@nihongo/contracts/admin/content-operations'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { captureAuthTransitionEpoch } from '@nihongo/browser/libs/authTransitionFence'
import { adminReportQueries } from '@app/admin-report/queries/adminReportQueries'

export const useAdminReportsList = (query: ListAdminQuestionReportsQuery) => {
  const { user, role, isReady } = useAuth()
  const epoch = captureAuthTransitionEpoch()
  const online = useSyncExternalStore(
    (notify) => onlineManager.subscribe(notify),
    () => onlineManager.isOnline()
  )
  const result = useQuery({
    ...adminReportQueries.list(user?.id ?? null, epoch, query),
    enabled: isReady && role === 'ADMIN' && Boolean(user?.id),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[3] === user?.id &&
      previousQuery?.queryKey[4] === epoch
        ? previous
        : undefined
  })
  return {
    data: result.data,
    error: result.error,
    isSuccess: result.isSuccess,
    isPending: result.isPending,
    isError: result.isError,
    isFetching: result.isFetching,
    isPlaceholderData: result.isPlaceholderData,
    fetchStatus: result.fetchStatus,
    refetch: result.refetch,
    isOffline: !online
  }
}
export const useAdminReportDetail = (reportId: string) => {
  const { user, role, isReady } = useAuth()
  const online = useSyncExternalStore(
    (notify) => onlineManager.subscribe(notify),
    () => onlineManager.isOnline()
  )
  const result = useQuery({
    ...adminReportQueries.detail(
      user?.id ?? null,
      captureAuthTransitionEpoch(),
      reportId
    ),
    enabled:
      isReady &&
      role === 'ADMIN' &&
      Boolean(user?.id) &&
      getAdminQuestionReportParamsSchema.safeParse({ reportId }).success
  })
  return {
    data: result.data,
    error: result.error,
    isSuccess: result.isSuccess,
    isPending: result.isPending,
    isError: result.isError,
    isFetching: result.isFetching,
    isPlaceholderData: result.isPlaceholderData,
    fetchStatus: result.fetchStatus,
    refetch: result.refetch,
    isOffline: !online
  }
}
