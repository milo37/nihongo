import {
  getAdminQuestionReportParamsSchema,
  resolveAdminQuestionReportRequestSchema
} from '@nihongo/contracts/admin/content-operations'
import { cachedSessionStorage } from '@nihongo/browser/libs/storage'
import {
  reportListPath,
  safeReportListHref
} from '@app/admin-report/navigation/reportListContext'
import type { ReportResolutionDraft } from '@app/admin-report/components/ReportResolutionForm'

const validId = (id: string): boolean =>
  getAdminQuestionReportParamsSchema.safeParse({ reportId: id }).success
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
export const saveReportDraft = (
  actorId: string,
  reportId: string,
  rowVersion: number,
  draft: ReportResolutionDraft
): boolean => {
  if (!validId(actorId) || !validId(reportId)) return false
  const parsed = resolveAdminQuestionReportRequestSchema.safeParse({
    expectedRowVersion: rowVersion,
    outcome: draft.outcome,
    reason: draft.reason,
    remediationVersionId:
      draft.outcome === 'DISMISSED'
        ? null
        : draft.remediationVersionId.trim() || null
  })
  if (!parsed.success) return false
  return cachedSessionStorage.setItem(
    key(actorId, reportId) + ':draft',
    JSON.stringify({
      version: 1,
      actorId,
      reportId,
      rowVersion,
      draft: {
        outcome: parsed.data.outcome,
        reason: parsed.data.reason,
        remediationVersionId: parsed.data.remediationVersionId ?? ''
      }
    })
  )
}
export const restoreReportDraft = (
  actorId: string,
  reportId: string,
  rowVersion: number
): ReportResolutionDraft | null => {
  const value = read(key(actorId, reportId) + ':draft')
  if (
    !value ||
    value.version !== 1 ||
    value.actorId !== actorId ||
    value.reportId !== reportId ||
    value.rowVersion !== rowVersion ||
    !value.draft ||
    typeof value.draft !== 'object' ||
    !('outcome' in value.draft) ||
    !('reason' in value.draft) ||
    !('remediationVersionId' in value.draft)
  )
    return null
  const parsed = resolveAdminQuestionReportRequestSchema.safeParse({
    expectedRowVersion: rowVersion,
    outcome: value.draft.outcome,
    reason: value.draft.reason,
    remediationVersionId:
      value.draft.remediationVersionId === ''
        ? null
        : value.draft.remediationVersionId
  })
  return parsed.success
    ? {
        outcome: parsed.data.outcome,
        reason: parsed.data.reason,
        remediationVersionId: parsed.data.remediationVersionId ?? ''
      }
    : null
}
export const discardReportDraft = (actorId: string, reportId: string): void => {
  cachedSessionStorage.removeItem(key(actorId, reportId) + ':draft')
}
