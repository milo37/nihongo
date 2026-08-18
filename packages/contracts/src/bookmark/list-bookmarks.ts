import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  createPageResponseSchema,
  pageRequestSchema
} from '../common/pagination.js'
import { bookmarkSummarySchema } from './bookmark.js'

export const listBookmarksOperationId = 'bookmark.listBookmarks' as const

export const listBookmarksQuerySchema = pageRequestSchema
  .extend({
    questionIds: z
      .array(opaqueIdSchema)
      .min(1)
      .max(20)
      .refine(
        (questionIds) => new Set(questionIds).size === questionIds.length,
        'questionIds는 중복될 수 없습니다.'
      )
      .optional()
  })
  .strict()

export const listBookmarksResponseSchema = createPageResponseSchema(
  bookmarkSummarySchema
).superRefine((page, context) => {
  const offset = (page.page - 1) * page.pageSize
  const remainingItems = Math.max(page.total - offset, 0)
  const maximumItemsOnPage = Math.min(page.pageSize, remainingItems)

  if (page.items.length !== maximumItemsOnPage) {
    context.addIssue({
      code: 'custom',
      path: ['items'],
      message: 'Bookmark page count가 pagination metadata와 일치해야 합니다.'
    })
  }

  const questionIds = new Set<string>()
  page.items.forEach((item, index) => {
    if (questionIds.has(item.questionId)) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'questionId'],
        message: 'Bookmark question ID는 page 안에서 서로 달라야 합니다.'
      })
    }
    questionIds.add(item.questionId)
  })
})

export const listBookmarksErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const listBookmarksErrorSchema = createApiFailureSchema(
  listBookmarksErrorCodeSchema
)

export type ListBookmarksQuery = z.input<typeof listBookmarksQuerySchema>
export type ParsedListBookmarksQuery = z.output<typeof listBookmarksQuerySchema>
export type ListBookmarksResponse = z.output<typeof listBookmarksResponseSchema>
export type ListBookmarksError = z.output<typeof listBookmarksErrorSchema>
