import { describe, expect, it } from 'vitest'
import { seededShuffle } from '@util/shuffle'

describe('seededShuffle', () => {
  it('원본 배열을 변경하지 않고 모든 항목을 유지한다', () => {
    const source = [1, 2, 3, 4, 5]
    const snapshot = [...source]
    const result = seededShuffle(source, 'seed-a')

    expect(source).toEqual(snapshot)
    expect(result).toHaveLength(source.length)
    expect(result.toSorted()).toEqual(source)
  })

  it('같은 seed에서는 같은 순서를 만든다', () => {
    const source = ['a', 'b', 'c', 'd', 'e', 'f']

    expect(seededShuffle(source, 2026)).toEqual(seededShuffle(source, 2026))
  })
})
