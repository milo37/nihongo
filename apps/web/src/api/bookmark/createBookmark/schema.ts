import {
  createBookmarkBodySchema,
  createBookmarkParamsSchema,
  createBookmarkResponseSchema
} from '@nihongo/contracts/bookmark/create-bookmark'
import { z } from 'zod'

const bookmarkTransportHeadersSchema = z
  .object({
    'cache-control': z.literal('private, no-store'),
    'content-type': z
      .string()
      .refine(
        (value) => value.toLowerCase().startsWith('application/json'),
        'Bookmark 생성 응답에는 JSON Content-Type이 필요합니다.'
      ),
    'idempotency-replayed': z.null(),
    location: z.string(),
    'x-nihongo-practice-contract': z.null()
  })
  .strict()

export const createBookmarkRequestSchema = createBookmarkParamsSchema
export const createBookmarkRequestBodySchema = createBookmarkBodySchema
export const createBookmarkTransportResponseSchema = z
  .object({
    data: createBookmarkResponseSchema,
    headers: bookmarkTransportHeadersSchema,
    status: z.union([z.literal(200), z.literal(201)])
  })
  .strict()
  .superRefine(({ data, headers }, context) => {
    const prefix = '/api/v1/bookmarks/'
    const rawQuestionId = headers.location.startsWith(prefix)
      ? headers.location.slice(prefix.length)
      : null
    const parsedLocation = createBookmarkParamsSchema.safeParse({
      questionId: rawQuestionId
    })
    if (
      !parsedLocation.success ||
      parsedLocation.data.questionId !== data.questionId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'location'],
        message:
          'Bookmark Location은 응답 questionId의 canonical 경로여야 합니다.'
      })
    }
  })

export type CreateBookmarkRequest = z.input<typeof createBookmarkRequestSchema>
export type CreateBookmarkTransportResponse = z.output<
  typeof createBookmarkTransportResponseSchema
>
