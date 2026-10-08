import { describe, expect, it } from 'vitest'
import { isFocusedElementUnobscured } from '@/test/focusGeometry'

const visibleGeometry = {
  bottom: 144,
  headerBottom: 64,
  height: 44,
  insideHeader: false,
  isNamedScrollHost: false,
  left: 20,
  right: 120,
  top: 100,
  viewportHeight: 800,
  viewportWidth: 1280,
  width: 100
} as const

describe('isFocusedElementUnobscured', () => {
  it('requires ordinary focused targets to remain fully inside the viewport', () => {
    expect(isFocusedElementUnobscured(visibleGeometry)).toBe(true)
    expect(
      isFocusedElementUnobscured({
        ...visibleGeometry,
        bottom: 1_100,
        height: 1_000
      })
    ).toBe(false)
  })

  it('allows partial bounds only for a named, actually scrollable host', () => {
    const oversized = {
      ...visibleGeometry,
      bottom: 1_100,
      height: 1_000
    }

    expect(
      isFocusedElementUnobscured({
        ...oversized,
        isNamedScrollHost: true
      })
    ).toBe(true)
    expect(
      isFocusedElementUnobscured({
        ...oversized,
        isNamedScrollHost: false
      })
    ).toBe(false)
  })

  it('never permits a scroll host focus edge under the sticky header', () => {
    expect(
      isFocusedElementUnobscured({
        ...visibleGeometry,
        bottom: 1_020,
        height: 1_000,
        isNamedScrollHost: true,
        top: 20
      })
    ).toBe(false)
  })
})
