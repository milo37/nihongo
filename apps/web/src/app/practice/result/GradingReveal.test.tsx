import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { appI18n } from '@nihongo/browser/i18n/config'
import {
  GradingReveal,
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
