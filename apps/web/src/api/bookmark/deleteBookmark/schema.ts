import { deleteBookmarkParamsSchema } from '@nihongo/contracts/bookmark/delete-bookmark'
import { z } from 'zod'

export const deleteBookmarkRequestSchema = deleteBookmarkParamsSchema
export const deleteBookmarkTransportResponseSchema = z
  .object({
    data: z.undefined(),
    headers: z
      .object({
        'cache-control': z.literal('private, no-store'),
        'content-type': z.null(),
        'idempotency-replayed': z.null(),
        location: z.null(),
        'x-nihongo-practice-contract': z.null()
      })
      .strict(),
    status: z.literal(204)
  })
  .strict()

export type DeleteBookmarkRequest = z.input<typeof deleteBookmarkRequestSchema>
export type DeleteBookmarkTransportResponse = z.output<
  typeof deleteBookmarkTransportResponseSchema
>
