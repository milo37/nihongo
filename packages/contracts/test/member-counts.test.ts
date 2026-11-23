import { describe, expect, it } from 'vitest'
import { READING_SESSION_QUESTION_LIMIT } from '../src/study/create-study-session.js'
import {
  getDefaultMemberCount,
  getMemberCountChoices,
  getMemberCountLimit
} from '../src/study/member-counts.js'

describe('member set sizes (#1244)', () => {
  it('offers reading 5 or 10 and the other subjects 5, 10 or 20', () => {
    expect(getMemberCountChoices('READING')).toEqual([5, 10])
    expect(getDefaultMemberCount('READING')).toBe(5)
    for (const subject of ['VOCABULARY', 'GRAMMAR'] as const) {
      expect(getMemberCountChoices(subject)).toEqual([5, 10, 20])
      expect(getDefaultMemberCount(subject)).toBe(10)
    }
  })

  it('keeps each default among the choices and the server limit at the largest', () => {
    for (const subject of ['VOCABULARY', 'GRAMMAR', 'READING'] as const) {
      expect(getMemberCountChoices(subject)).toContain(
        getDefaultMemberCount(subject)
      )
    }
    expect(getMemberCountLimit('VOCABULARY')).toBe(20)
    expect(READING_SESSION_QUESTION_LIMIT).toBe(getMemberCountLimit('READING'))
  })
})
