import { listReviewQueueQuerySchema } from '@nihongo/contracts/wrong-note/list-review-queue'
import type { ParsedListReviewQueueQuery } from '@nihongo/contracts/wrong-note/list-review-queue'

const allowedKeys = [
  'view',
  'level',
  'subject',
  'questionType',
  'tag',
  'sort',
  'page'
] as const

type ReviewQueueSearchKey = (typeof allowedKeys)[number]

export interface ParsedReviewQueueSearch {
  canonicalSearch: string
  needsReplace: boolean
  query: ParsedListReviewQueueQuery
}

const serializeQuery = (query: ParsedListReviewQueueQuery): URLSearchParams => {
  const params = new URLSearchParams()
  if (query.view !== 'DUE') params.set('view', query.view)
  if (query.level) params.set('level', query.level)
  if (query.subject) params.set('subject', query.subject)
  if (query.questionType) params.set('questionType', query.questionType)
  if (query.tag) params.set('tag', query.tag)
  if (query.sort !== 'NEXT_REVIEW') params.set('sort', query.sort)
  if (query.page !== 1) params.set('page', String(query.page))
  return params
}

export const parseReviewQueueSearch = (
  searchParams: URLSearchParams
): ParsedReviewQueueSearch => {
  let query = listReviewQueueQuerySchema.parse({ pageSize: 20 })
  const incomingKeys = [...searchParams.keys()]
  let isStrict = incomingKeys.every((key) =>
    allowedKeys.includes(key as ReviewQueueSearchKey)
  )

  for (const key of allowedKeys) {
    const values = searchParams.getAll(key)
    if (values.length === 0) continue
    if (values.length !== 1) isStrict = false

    const candidate = listReviewQueueQuerySchema.safeParse({
      ...query,
      [key]: values[0]
    })
    if (candidate.success) {
      query = candidate.data
    } else {
      isStrict = false
    }
  }

  const canonicalSearch = serializeQuery(query).toString()
  return {
    canonicalSearch,
    needsReplace: !isStrict || canonicalSearch !== searchParams.toString(),
    query
  }
}

export const createReviewQueueSearch = (
  query: ParsedListReviewQueueQuery
): URLSearchParams => serializeQuery(listReviewQueueQuerySchema.parse(query))

export const getSafeWrongNoteReturnTo = (value: string | null): string => {
  if (!value) return '/wrong-notes'
  try {
    const url = new URL(value, 'https://nihongo.invalid')
    const allowedPath =
      url.origin === 'https://nihongo.invalid' &&
      (url.pathname === '/wrong-notes' ||
        url.pathname === '/wrong-notes/history' ||
        (url.pathname === '/dashboard' && url.search === ''))
    return allowedPath ? `${url.pathname}${url.search}` : '/wrong-notes'
  } catch {
    return '/wrong-notes'
  }
}
