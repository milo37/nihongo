import { render } from '@testing-library/react'
import {
  gradeTiming,
  ProgressSheet
} from '@common/components/manuscript/ProgressSheet'
import type { ProgressCellState } from '@common/components/manuscript/ProgressSheet'

const rows = (container: HTMLElement): number =>
  container.querySelectorAll('.manuscript-sheet-rules > g > rect').length

describe('ProgressSheet (B4 manuscript strip)', () => {
  it('draws five squares in one row for a five-question set', () => {
    const { container } = render(
      <ProgressSheet states={Array<ProgressCellState>(5).fill('todo')} />
    )
    expect(rows(container)).toBe(1)
    expect(container.querySelectorAll('text')).toHaveLength(5)
  })

  it('wraps twenty questions into two rows of ten', () => {
    const { container } = render(
      <ProgressSheet states={Array<ProgressCellState>(20).fill('todo')} />
    )
    expect(rows(container)).toBe(2)
    expect(container.querySelectorAll('text')).toHaveLength(20)
  })

  it('shows only the row holding the current question with real numbers', () => {
    const states = Array<ProgressCellState>(20).fill('todo')
    states[12] = 'current'
    const { container } = render(<ProgressSheet states={states} rowOf={12} />)
    const numbers = [...container.querySelectorAll('text')].map(
      (node) => node.textContent
    )
    expect(numbers).toEqual(
      Array.from({ length: 10 }, (_, index) => String(index + 11))
    )
    expect(container.querySelector('.progress-sheet-current')).not.toBeNull()
  })

  it('marks correct with a circle and wrong with a fill and slash', () => {
    const { container } = render(
      <ProgressSheet states={['ok', 'ng', 'answered']} />
    )
    expect(container.querySelectorAll('.grade-ok')).toHaveLength(1)
    expect(container.querySelectorAll('.grade-ng')).toHaveLength(1)
    expect(container.querySelectorAll('.grade-ng-fill')).toHaveLength(1)
    expect(container.querySelectorAll('.progress-sheet-dot')).toHaveLength(1)
    // Static unless asked to animate.
    expect(container.querySelector('.manuscript-pen')).toBeNull()
  })

  it('animates the red pen on the B4 timing and stays decorative', () => {
    const { container } = render(
      <ProgressSheet states={['ok', 'ng']} animate />
    )
    const pens = container.querySelectorAll<SVGElement>('.manuscript-pen')
    expect([...pens].map((pen) => pen.style.animationDelay)).toEqual([
      '150ms',
      '250ms'
    ])
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('times 5, 10 and 20 questions as the spec says', () => {
    expect(gradeTiming(5).scoreCircleMs).toBe(800)
    expect(gradeTiming(10).scoreCircleMs).toBe(1300)
    expect(gradeTiming(20).scoreCircleMs).toBe(1350)
    expect(gradeTiming(20).delayMs(19)).toBe(1100)
  })
})
