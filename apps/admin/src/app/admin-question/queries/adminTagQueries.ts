import { queryOptions } from '@tanstack/react-query'
import type { QuestionSubject } from '@nihongo/browser/common/types/domain'
import { listAdminTags } from '@api/admin-tag/listAdminTags/index'

/** The most tags one list request returns; the fixed tag list fits in one page. */
export const ADMIN_TAG_PAGE_SIZE = 50

export interface AdminTagSearch {
  subject: QuestionSubject
  /** Normalized tag key prefix; omitted for the whole subject. */
  q?: string
}

export const adminTagQueries = {
  allKey: () => ['admin-tag'] as const,
  list: (search: AdminTagSearch) =>
    queryOptions({
      queryKey: [
        ...adminTagQueries.allKey(),
        'list-admin-tags',
        search
      ] as const,
      queryFn: () => listAdminTags({ ...search, limit: ADMIN_TAG_PAGE_SIZE }),
      staleTime: 60_000
    })
} as const
