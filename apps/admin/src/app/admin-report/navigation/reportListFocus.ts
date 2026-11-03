import { adminReportParamsSchema } from '@nihongo/contracts/admin/reports'
import { cachedSessionStorage } from '@nihongo/browser/libs/storage'
import {
  reportListPath,
  safeReportListHref
} from '@app/admin-report/navigation/reportListContext'

const validId = (id: string): boolean =>
  adminReportParamsSchema.safeParse({ reportId: id }).success
const key = (actorId: string, reportId: string): string =>
  `nihongo:admin-report:v1:${actorId}:${reportId}`
const read = (name: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(
      cachedSessionStorage.getItem(name) ?? 'null'
    )
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
export const saveReportContext = (
  actorId: string,
  reportId: string,
  returnTo: string
): boolean => {
  if (!validId(actorId) || !validId(reportId)) return false
  const context = {
    version: 1,
    actorId,
    reportId,
    returnTo: safeReportListHref(returnTo)
  }
  return (
    cachedSessionStorage.setItem(
      key(actorId, reportId) + ':context',
      JSON.stringify(context)
    ) &&
    cachedSessionStorage.setItem(
      key(actorId, 'list-focus'),
      JSON.stringify(context)
    )
  )
}
export const readReportReturn = (actorId: string, reportId: string): string => {
  const value = read(key(actorId, reportId) + ':context')
  return value?.version === 1 &&
    value.actorId === actorId &&
    value.reportId === reportId
    ? safeReportListHref(value.returnTo)
    : reportListPath
}
export const consumeReportListFocus = (
  actorId: string,
  href: string
): string | null => {
  const name = key(actorId, 'list-focus')
  const value = read(name)
  cachedSessionStorage.removeItem(name)
  return value?.version === 1 &&
    value.actorId === actorId &&
    typeof value.reportId === 'string' &&
    validId(value.reportId) &&
    safeReportListHref(value.returnTo) === safeReportListHref(href)
    ? value.reportId
    : null
}
