import {
  getAdminQuestionReportParamsSchema,
  listAdminQuestionReportsQuerySchema,
  type ListAdminQuestionReportsQuery
} from '@nihongo/contracts/admin/phase7'

export const reportListPath = '/admin/reports'
export const reportFilterKeys = [
  'status',
  'reason',
  'questionId',
  'assigneeActorId',
  'createdFrom',
  'createdTo',
  'updatedFrom',
  'updatedTo',
  'sort',
  'page',
  'pageSize'
] as const
export const parseReportListSearch = (
  search: URLSearchParams
): {
  query: ListAdminQuestionReportsQuery
  valid: boolean
} => {
  const candidate: Record<string, string> = {}
  let valid = true
  for (const [key, value] of search) {
    if (Object.hasOwn(candidate, key) || !value.trim()) valid = false
    candidate[key] = value.trim()
  }
  const parsed = listAdminQuestionReportsQuerySchema.safeParse(candidate)
  return valid && parsed.success && parsed.data.pageSize === 20
    ? { query: parsed.data, valid: true }
    : { query: { page: 1, pageSize: 20, sort: 'UPDATED_DESC' }, valid: false }
}
export const reportListHref = (
  query: ListAdminQuestionReportsQuery
): string => {
  const normalized = listAdminQuestionReportsQuerySchema.parse({
    ...query,
    pageSize: 20
  })
  const search = new URLSearchParams()
  for (const key of reportFilterKeys) {
    if (key === 'pageSize') continue
    const value = normalized[key]
    if (value !== undefined) search.set(key, String(value))
  }
  return `${reportListPath}?${search}`
}
export const safeReportListHref = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !/^\/admin\/reports(?:\?[^#]*)?$/u.test(value) ||
    /\p{Cc}/u.test(value)
  )
    return reportListPath
  const parsed = parseReportListSearch(new URLSearchParams(value.split('?')[1]))
  return parsed.valid ? reportListHref(parsed.query) : reportListPath
}
export const reportDetailHref = (reportId: string): string => {
  getAdminQuestionReportParamsSchema.parse({ reportId })
  return `/reports/${reportId}`
}
