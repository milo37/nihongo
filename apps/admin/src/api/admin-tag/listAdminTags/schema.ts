import {
  listAdminTagsQuerySchema as listAdminTagsRequestSchema,
  listAdminTagsResponseSchema
} from '@nihongo/contracts/admin/content-operations'
import type { z } from 'zod'
export { listAdminTagsRequestSchema, listAdminTagsResponseSchema }
export type ListAdminTagsRequest = z.input<typeof listAdminTagsRequestSchema>
export type ListAdminTagsResponse = z.output<typeof listAdminTagsResponseSchema>
export type AdminTagListItem = ListAdminTagsResponse['items'][number]
