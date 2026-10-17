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
  'page'
] as const
export const parseReportListSearch = (
  search: URLSearchParams
): { query: ListAdminQuestionReportsQuery; valid: boolean } => {
  const candidate: Record<string, unknown> = { pageSize: 20 }
  for (const key of reportFilterKeys) {
    const value = search.get(key)?.trim()
    if (value) candidate[key] = value
  }
  const parsed = listAdminQuestionReportsQuerySchema.safeParse(candidate)
  const duplicates = reportFilterKeys.some(
    (key) => search.getAll(key).length > 1
  )
  const emptyPage = search.has('page') && !search.get('page')?.trim()
  return parsed.success && !duplicates && !emptyPage
    ? { query: parsed.data, valid: true }
    : { query: { page: 1, pageSize: 20, sort: 'UPDATED_DESC' }, valid: false }
}
export const reportListHref = (
  query: ListAdminQuestionReportsQuery,
  focusReport?: string
): string => {
  const normalized = listAdminQuestionReportsQuerySchema.parse({
    ...query,
    pageSize: 20
  })
  const search = new URLSearchParams()
  for (const key of reportFilterKeys) {
    const value = normalized[key]
    if (value !== undefined) search.set(key, String(value))
  }
  if (
    focusReport &&
    getAdminQuestionReportParamsSchema.safeParse({ reportId: focusReport })
      .success
  )
    search.set('focusReport', focusReport)
  return `${reportListPath}?${search}`
}
export const reportDetailHref = (
  reportId: string,
  query: ListAdminQuestionReportsQuery
): string => {
  getAdminQuestionReportParamsSchema.parse({ reportId })
  const search = new URLSearchParams({
    returnTo: reportListHref(query, reportId)
  })
  return `${reportListPath}/${encodeURIComponent(reportId)}?${search}`
}
export const reportReturnHref = (search: URLSearchParams): string => {
  const value = search.get('returnTo')
  if (!value || !value.startsWith('/admin/reports?')) return reportListPath
  try {
    const url = new URL(value, 'https://report-navigation.invalid')
    if (
      url.origin !== 'https://report-navigation.invalid' ||
      url.pathname !== reportListPath ||
      url.hash
    )
      return reportListPath
    const parsed = parseReportListSearch(url.searchParams)
    if (!parsed.valid) return reportListPath
    return reportListHref(
      parsed.query,
      url.searchParams.get('focusReport') ?? undefined
    )
  } catch {
    return reportListPath
  }
}
