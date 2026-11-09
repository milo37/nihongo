import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { appI18n } from '@nihongo/browser/i18n/config'
import {
  GradingReveal,
  getRevealColumns,
  getRevealSchedule
} from '@app/practice/result/GradingReveal'

const outcomes = [true, false, true, true, false]

beforeEach(async () => {
  await appI18n.changeLanguage('ko')
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('stays under 2.5 seconds for 1 to 20 questions', () => {
  for (let count = 1; count <= 20; count += 1) {
    expect(getRevealSchedule(count).total).toBeLessThanOrEqual(2500)
  }
})

it('splits rows evenly: phone 5 per row, wide 10 (design rule)', () => {
  const phone = [5, 7, 10, 20].map((n) => getRevealColumns(n, 5))
  const wide = [5, 10, 15, 20].map((n) => getRevealColumns(n, 10))
  expect(phone).toEqual([5, 4, 5, 5])
  expect(wide).toEqual([5, 10, 8, 10])
})

it('flips tiles in order, then announces the score once', () => {
  render(<GradingReveal outcomes={outcomes} onClose={vi.fn()} />)
  expect(screen.getByRole('heading')).toHaveTextContent('채점하고 있어요')
  const tiles = document.querySelectorAll('.grading-reveal-tile')
  expect(tiles).toHaveLength(5)
  expect(document.querySelectorAll('[data-open]')).toHaveLength(0)
  act(() => vi.advanceTimersByTime(500))
  expect(screen.getByRole('heading')).toHaveTextContent('채점 결과')
  expect(document.querySelectorAll('[data-open]')).toHaveLength(1)
  act(() => vi.advanceTimersByTime(getRevealSchedule(5).total))
  expect(document.querySelectorAll('[data-open]')).toHaveLength(5)
  expect(screen.getByText('5문제 중 3개 맞음')).toBeInTheDocument()
  expect(screen.getByText('1번 정답')).toBeInTheDocument()
  expect(screen.getByText('2번 오답')).toBeInTheDocument()
})

it('opens everything at once on any key and closes from the button', () => {
  const onClose = vi.fn()
  render(<GradingReveal outcomes={outcomes} onClose={onClose} />)
  fireEvent.keyDown(document.querySelector('.grading-reveal')!, { key: 'a' })
  expect(document.querySelectorAll('[data-open]')).toHaveLength(5)
  expect(screen.getByText('5문제 중 3개 맞음')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '결과 보기' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('skips the motion when reduced motion is preferred', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: true } as MediaQueryList)
  )
  render(<GradingReveal outcomes={[true, true]} onClose={vi.fn()} />)
  expect(document.querySelectorAll('[data-open]')).toHaveLength(2)
  expect(document.querySelector('[data-perfect]')).not.toBeNull()
  expect(screen.getByText('2문제 중 2개 맞음')).toBeInTheDocument()
})

it('is a modal: labelled dialog, inert background, Tab stays on the button', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: true } as MediaQueryList)
  )
  const { container, unmount } = render(
    <GradingReveal outcomes={outcomes} onClose={vi.fn()} />
  )
  const dialog = screen.getByRole('dialog', { name: '채점 결과' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(container).toHaveAttribute('inert')
  act(() => vi.advanceTimersToNextFrame())
  const close = screen.getByRole('button', { name: '결과 보기' })
  expect(close).toHaveFocus()
  fireEvent.keyDown(close, { key: 'Tab' })
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
  expect(close).toHaveFocus()
  unmount()
  expect(container).not.toHaveAttribute('inert')
})
