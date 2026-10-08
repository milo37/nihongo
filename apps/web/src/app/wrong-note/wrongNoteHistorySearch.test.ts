import { describe, expect, it } from 'vitest'
import {
  createWrongNoteHistorySearch,
  parseWrongNoteHistorySearch
} from '@app/wrong-note/wrongNoteHistorySearch'

describe('wrong-note history URL state', () => {
  it('normalizes invalid, duplicate, and unknown values without losing valid filters', () => {
    const parsed = parseWrongNoteHistorySearch(
      new URLSearchParams(
        'level=N5&level=N4&status=NOPE&sort=MOST_WRONG&page=1.5&owner=x'
      )
    )

    expect(parsed.needsReplace).toBe(true)
    expect(parsed.query).toMatchObject({
      level: 'N5',
      page: 1,
      pageSize: 12,
      sort: 'MOST_WRONG'
    })
    expect(parsed.canonicalSearch).toBe('level=N5&sort=MOST_WRONG')
  })

  it('round-trips canonical history filters and omits defaults', () => {
    const search = createWrongNoteHistorySearch({
      level: 'N3',
      page: 2,
      pageSize: 12,
      sort: 'OLDEST',
      status: 'SOLVED',
      subject: 'READING',
      tag: '장문 독해'
    })
    const parsed = parseWrongNoteHistorySearch(search)

    expect(parsed.needsReplace).toBe(false)
    expect(parsed.canonicalSearch).toBe(
      'level=N3&subject=READING&status=SOLVED&tag=%EC%9E%A5%EB%AC%B8+%EB%8F%85%ED%95%B4&sort=OLDEST&page=2'
    )
  })
})
