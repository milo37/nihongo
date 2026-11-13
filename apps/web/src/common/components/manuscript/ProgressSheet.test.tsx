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

  it('marks an unanswered question with a grey dash, no number', () => {
    const { container } = render(<ProgressSheet states={['ok', 'skip']} />)
    expect(container.querySelectorAll('.grade-skip')).toHaveLength(1)
    expect(container.querySelectorAll('text')).toHaveLength(0)
  })

  it('fills the width with the shown squares, at most 28px each', () => {
    // fallbackWidth 350 (jsdom): five squares stop at 28, not 35.
    const { container } = render(
      <ProgressSheet
        states={Array<ProgressCellState>(5).fill('todo')}
        rowOf={0}
        maxCellSize={28}
      />
    )
    expect(container.querySelector('svg')).toHaveAttribute('width', '140')
    expect(container.querySelectorAll('text')).toHaveLength(5)
  })

  it('drops the numbers when a square is under 17px', () => {
    const { container } = render(
      <ProgressSheet
        states={Array<ProgressCellState>(20).fill('todo')}
        singleRowCellSize={16}
      />
    )
    expect(container.querySelectorAll('text')).toHaveLength(0)
  })

  it('keeps two-digit numbers under 24px, set smaller (JLP-869)', () => {
    // fallbackWidth 350 (jsdom), 16 squares in one row: 21px each.
    const { container } = render(
      <ProgressSheet
        states={Array<ProgressCellState>(16).fill('todo')}
        singleRowCellSize={28}
      />
    )
    const texts = [...container.querySelectorAll('text')]
    expect(texts.map((node) => node.textContent)).toEqual(
      Array.from({ length: 16 }, (_, index) => String(index + 1))
    )
    expect(texts[8]).not.toHaveClass('is-small')
    expect(texts[9]).toHaveClass('is-small')
  })

  it('fills a current square under 24px and keeps its two-digit number', () => {
    // Squares of 20px, as in the 390px phone row at 10 / 10.
    const states = Array<ProgressCellState>(10).fill('answered')
    states[9] = 'current'
    const { container } = render(
      <ProgressSheet states={states} rowOf={9} maxCellSize={20} />
    )
    const number = container.querySelector('.progress-sheet-number.is-current')
    expect(number).toHaveTextContent('10')
    expect(number).toHaveClass('is-small', 'is-on-fill')
    const box = container.querySelector('.progress-sheet-current')
    expect(box).toHaveAttribute('width', '18')
    expect(box).toHaveClass('is-filled')
  })

  it('fills the current square when no number fits', () => {
    const states = Array<ProgressCellState>(10).fill('todo')
    states[4] = 'current'
    const { container } = render(
      <ProgressSheet states={states} rowOf={4} maxCellSize={14} />
    )
    expect(container.querySelectorAll('text')).toHaveLength(0)
    expect(container.querySelector('.progress-sheet-current')).toHaveClass(
      'is-filled'
    )
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
