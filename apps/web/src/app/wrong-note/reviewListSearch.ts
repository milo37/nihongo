import { listReviewListQuerySchema } from '@nihongo/contracts/wrong-note/list-review-list'
import type { ParsedListReviewListQuery } from '@nihongo/contracts/wrong-note/list-review-list'

const allowedKeys = ['state', 'level', 'page'] as const

type ReviewListSearchKey = (typeof allowedKeys)[number]

export interface ParsedReviewListSearch {
  canonicalSearch: string
  needsReplace: boolean
  query: ParsedListReviewListQuery
}

const serializeQuery = (query: ParsedListReviewListQuery): URLSearchParams => {
  const params = new URLSearchParams()
  if (query.state !== 'TO_REVIEW') params.set('state', query.state)
  if (query.level) params.set('level', query.level)
  if (query.page !== 1) params.set('page', String(query.page))
  return params
}

export const parseReviewListSearch = (
  searchParams: URLSearchParams
): ParsedReviewListSearch => {
  let query = listReviewListQuerySchema.parse({ pageSize: 20 })
  let isStrict = [...searchParams.keys()].every((key) =>
    allowedKeys.includes(key as ReviewListSearchKey)
  )

  for (const key of allowedKeys) {
    const values = searchParams.getAll(key)
    if (values.length === 0) continue
    if (values.length !== 1) isStrict = false

    const candidate = listReviewListQuerySchema.safeParse({
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

export const createReviewListSearch = (
  query: ParsedListReviewListQuery
): URLSearchParams => serializeQuery(listReviewListQuerySchema.parse(query))
