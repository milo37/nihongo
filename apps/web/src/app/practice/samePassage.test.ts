import { isSamePassage, samePassageStart } from '@app/practice/samePassage'

const q = (passage: string | null, passageId?: string | null) => ({
  passage,
  passageId
})

describe('same passage (#986)', () => {
  it('matches by id when both have one, else by text', () => {
    expect(isSamePassage(q('a', 'p1'), q('b', 'p1'))).toBe(true)
    expect(isSamePassage(q('a', 'p1'), q('a', 'p2'))).toBe(false)
    expect(isSamePassage(q('a', 'p1'), q('a'))).toBe(true)
    expect(isSamePassage(q('a'), q('b'))).toBe(false)
    expect(isSamePassage(q(null), q(null))).toBe(false)
  })

  it('finds where a run of the same passage starts', () => {
    const items = [q('a'), q('a'), q('a'), q('b'), q(null), q('b')]
    expect(items.map((_, index) => samePassageStart(items, index))).toEqual([
      null,
      0,
      0,
      null,
      null,
      null
    ])
  })
})
