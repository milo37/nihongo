import { useTranslation } from 'react-i18next'
import type { KeyboardEvent, ReactElement } from 'react'

// #1090 O-r7: 10~150 in tens, 10 until the member picks (the contract's
// DAILY_GOAL_* values; the contract module would bring its schemas along).
export const DAILY_MIN = 10
const DAILY_MAX = 150
const DAILY_STEP = 10

const clampDaily = (value: number): number =>
  Math.min(DAILY_MAX, Math.max(DAILY_MIN, value))

const StepIcon = ({ plus }: { plus: boolean }): ReactElement => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={plus ? 'M5 12h14M12 5v14' : 'M5 12h14'} />
  </svg>
)

export const DailyGoalStepper = ({
  label,
  value,
  onChange
}: {
  label: string
  value: number
  onChange: (value: number) => void
}): ReactElement => {
  const { t } = useTranslation('auth')
  const step = (by: number): void => onChange(clampDaily(value + by))
  const atMin = value <= DAILY_MIN
  const atMax = value >= DAILY_MAX
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next: Record<string, number> = {
      ArrowUp: value + DAILY_STEP,
      ArrowRight: value + DAILY_STEP,
      ArrowDown: value - DAILY_STEP,
      ArrowLeft: value - DAILY_STEP,
      Home: DAILY_MIN,
      End: DAILY_MAX
    }
    const target = next[event.key]
    if (target === undefined) return
    event.preventDefault()
    onChange(clampDaily(target))
  }
  // The ends stay focusable but do nothing (r12: '사용할 수 없음').
  return (
    <div className="study-goal-stepper">
      <button
        type="button"
        className="study-goal-step"
        aria-label={t('studyGoal.decrease')}
        aria-disabled={atMin || undefined}
        onClick={() => {
          if (!atMin) step(-DAILY_STEP)
        }}
      >
        <StepIcon plus={false} />
      </button>
      <div
        className="study-goal-value"
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={DAILY_MIN}
        aria-valuemax={DAILY_MAX}
        aria-valuenow={value}
        aria-valuetext={t('studyGoal.count', { count: value })}
        onKeyDown={onKeyDown}
      >
        <span className="study-goal-number">{value}</span>
        <span className="study-goal-unit">{t('studyGoal.unit')}</span>
      </div>
      <button
        type="button"
        className="study-goal-step"
        aria-label={t('studyGoal.increase')}
        aria-disabled={atMax || undefined}
        onClick={() => {
          if (!atMax) step(DAILY_STEP)
        }}
      >
        <StepIcon plus />
      </button>
    </div>
  )
}
