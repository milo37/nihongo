import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ListAdminQuestionReportsQuery } from '@nihongo/contracts/admin/phase7'
import { phase7AdminQueries } from '@app/admin-question/queries/phase7AdminQueries'
const subscribeConnectivity = (listener: () => void): (() => void) => {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}
const readOffline = (): boolean => navigator.onLine === false
const readServerOffline = (): boolean => false
const useReportOffline = (): boolean =>
  useSyncExternalStore(subscribeConnectivity, readOffline, readServerOffline)
export const useAdminReportList = (
  query: ListAdminQuestionReportsQuery,
  enabled = true
) => {
  const result = useQuery({ ...phase7AdminQueries.reportList(query), enabled })
  const isOffline = useReportOffline()
  return { ...result, isOffline }
}
export const useAdminReportDetail = (reportId: string) => {
  const result = useQuery(phase7AdminQueries.reportDetail(reportId))
  const isOffline = useReportOffline()
  return { ...result, isOffline }
}
