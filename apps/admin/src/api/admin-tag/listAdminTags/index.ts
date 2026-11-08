import { requestContentOperation } from '@nihongo/browser/api/content-operations/requestContentOperation'
import type { ListAdminTagsRequest } from '@api/admin-tag/listAdminTags/schema'
export const listAdminTags = (query: ListAdminTagsRequest) =>
  requestContentOperation({
    operation: 'listAdminTags',
    params: {},
    query,
    body: undefined
  })
