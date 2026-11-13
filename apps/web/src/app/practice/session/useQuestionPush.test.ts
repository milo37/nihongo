import { act, renderHook } from '@testing-library/react'
import { useQuestionPush } from '@app/practice/session/useQuestionPush'

const stubMotion = (allowed: boolean): void => {
  vi.stubGlobal(
    'matchMedia',
    (query: string): Pick<MediaQueryList, 'matches'> => ({
      matches: query.includes('no-preference') ? allowed : !allowed
    })
  )
}

const renderPush = (index = 0, isShown = true) =>
  renderHook(
    ({ index, isShown }: { index: number; isShown: boolean }) =>
      useQuestionPush(index, isShown),
    { initialProps: { index, isShown } }
  )

describe('useQuestionPush (JLP-870)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('does not move on the first question shown', () => {
    stubMotion(true)
    const { result } = renderPush(3)
    expect(result.current.from).toBeNull()
    expect(result.current.direction).toBeUndefined()
  })

  it('pushes left for a later question and right for an earlier one', () => {
    stubMotion(true)
    const { result, rerender } = renderPush(0)
    rerender({ index: 1, isShown: true })
    expect(result.current).toMatchObject({ from: 0, direction: 'next' })
    rerender({ index: 0, isShown: true })
    expect(result.current).toMatchObject({ from: 1, direction: 'prev' })
  })

  it('compares numbers for a sheet jump', () => {
    stubMotion(true)
    const { result, rerender } = renderPush(6)
    rerender({ index: 2, isShown: true })
    expect(result.current).toMatchObject({ from: 6, direction: 'prev' })
  })

  it('starts a new move from the question now shown and ends on finish', () => {
    stubMotion(true)
    const { result, rerender } = renderPush(0)
    rerender({ index: 1, isShown: true })
    const firstKey = result.current.key
    rerender({ index: 2, isShown: true })
    expect(result.current).toMatchObject({ from: 1, direction: 'next' })
    expect(result.current.key).not.toBe(firstKey)
    act(() => result.current.finish())
    expect(result.current.from).toBeNull()
  })

  it('does not move with reduced motion', () => {
    stubMotion(false)
    const { result, rerender } = renderPush(0)
    rerender({ index: 1, isShown: true })
    expect(result.current.from).toBeNull()
  })

  it('does not move when the question first appears (resume, reload)', () => {
    stubMotion(true)
    const { result, rerender } = renderPush(0, false)
    rerender({ index: 4, isShown: true })
    expect(result.current.from).toBeNull()
  })
})
