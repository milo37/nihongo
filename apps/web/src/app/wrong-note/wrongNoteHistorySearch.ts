import { listWrongNotesQuerySchema } from '@nihongo/contracts/wrong-note/list-wrong-notes'
import type { ParsedListWrongNotesQuery } from '@nihongo/contracts/wrong-note/list-wrong-notes'

const allowedKeys = [
  'level',
  'subject',
  'status',
  'tag',
  'sort',
  'page'
] as const

export type WrongNoteHistorySearchKey = (typeof allowedKeys)[number]

export interface ParsedWrongNoteHistorySearch {
  canonicalSearch: string
  needsReplace: boolean
  query: ParsedListWrongNotesQuery
}

const serializeQuery = (query: ParsedListWrongNotesQuery): URLSearchParams => {
  const params = new URLSearchParams()
  if (query.level) params.set('level', query.level)
  if (query.subject) params.set('subject', query.subject)
  if (query.status) params.set('status', query.status)
  if (query.tag) params.set('tag', query.tag)
  if (query.sort !== 'RECENT') params.set('sort', query.sort)
  if (query.page !== 1) params.set('page', String(query.page))
  return params
}

export const parseWrongNoteHistorySearch = (
  searchParams: URLSearchParams
): ParsedWrongNoteHistorySearch => {
  let query = listWrongNotesQuerySchema.parse({ pageSize: 12 })
  const incomingKeys = [...searchParams.keys()]
  let isStrict = incomingKeys.every((key) =>
    allowedKeys.includes(key as WrongNoteHistorySearchKey)
  )

  for (const key of allowedKeys) {
    const values = searchParams.getAll(key)
    if (values.length === 0) continue
    if (values.length !== 1) isStrict = false

    const candidate = listWrongNotesQuerySchema.safeParse({
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

export const createWrongNoteHistorySearch = (
  query: ParsedListWrongNotesQuery
): URLSearchParams => serializeQuery(listWrongNotesQuerySchema.parse(query))
