import { useRef } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { LEVELS } from '@nihongo/browser/common/types/domain'

export const LevelStrip = ({
  label,
  value,
  onChange
}: {
  label: string
  value: JlptLevel
  onChange: (level: JlptLevel) => void
}): ReactElement => {
  const cells = useRef<(HTMLButtonElement | null)[]>([])
  // Arrow keys move the pick like any radio group (r11 접근성).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowUp: -1,
      ArrowRight: 1,
      ArrowDown: 1
    }
    const step = steps[event.key]
    if (step === undefined) return
    event.preventDefault()
    const index = LEVELS.indexOf(value)
    const next = (index + step + LEVELS.length) % LEVELS.length
    const level = LEVELS[next]
    if (!level) return
    onChange(level)
    cells.current[next]?.focus()
  }
  return (
    <div
      className="study-goal-levels"
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {LEVELS.map((level, index) => {
        const picked = level === value
        return (
          <button
            key={level}
            ref={(cell) => {
              cells.current[index] = cell
            }}
            type="button"
            role="radio"
            aria-checked={picked}
            tabIndex={picked ? 0 : -1}
            className="study-goal-level"
            onClick={() => onChange(level)}
          >
            {level}
          </button>
        )
      })}
    </div>
  )
}
