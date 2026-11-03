import {
  adminReportParamsSchema,
  listAdminReportsQuerySchema,
  type ListAdminReportsQuery
} from '@nihongo/contracts/admin/reports'

export const reportListPath = '/admin/reports'
export const reportPageSizes = [25, 50, 100] as const
export const reportFilterKeys = ['status', 'kind', 'page', 'pageSize'] as const

type ReportListQuery = ListAdminReportsQuery & {
  page: number
  pageSize: number
}
const defaultQuery: ReportListQuery = { page: 1, pageSize: 25 }

export const parseReportListSearch = (
  search: URLSearchParams
): { query: ReportListQuery; valid: boolean } => {
  const candidate: Record<string, string> = {}
  let valid = true
  for (const [key, value] of search) {
    if (Object.hasOwn(candidate, key) || !value.trim()) valid = false
    candidate[key] = value.trim()
  }
  const parsed = listAdminReportsQuerySchema.safeParse(candidate)
  return valid &&
    parsed.success &&
    (reportPageSizes as readonly number[]).includes(parsed.data.pageSize)
    ? { query: parsed.data, valid: true }
    : { query: defaultQuery, valid: false }
}

export const reportListHref = (query: ListAdminReportsQuery): string => {
  const normalized = listAdminReportsQuerySchema.parse(query)
  const search = new URLSearchParams()
  for (const key of reportFilterKeys) {
    const value = normalized[key]
    if (value === undefined) continue
    if (key === 'pageSize' && value === defaultQuery.pageSize) continue
    search.set(key, String(value))
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
  adminReportParamsSchema.parse({ reportId })
  return `/reports/${reportId}`
}
