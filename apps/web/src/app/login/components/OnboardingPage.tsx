import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useSearchParams } from 'react-router'
import type { KeyboardEvent, ReactElement } from 'react'
import { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { LEVELS } from '@nihongo/browser/common/types/domain'
import { Button } from '@nihongo/browser/common/components/Button'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { readLastPracticeLevel } from '@app/login/queries/studyGoalQueries'
import { FALLBACK_LEVEL } from '@app/practice/practiceSetupOptions'
import {
  EDIT_RETURN_PATH,
  useStudyGoalPage
} from '@app/login/hooks/useStudyGoalPage'

// #1090 O-r7: 10~150 in tens, 10 until the member picks (the contract's
// DAILY_GOAL_* values; the contract module would bring its schemas along).
const DAILY_MIN = 10
const DAILY_MAX = 150
const DAILY_STEP = 10

// My page opens the page to come back to itself; anything else is a sign-in
// return and follows the same rule.
const readRedirect = (value: string | null): string =>
  value === EDIT_RETURN_PATH ? value : safeSsoReturnPath(value)

const clampDaily = (value: number): number =>
  Math.min(DAILY_MAX, Math.max(DAILY_MIN, value))

// The teacher's red circle from the result score, on the picked level only.
const PEN_PATH =
  'M15.5 3.2C9 1.6 3 5.6 3.4 11.6c.4 5.6 7 8.4 12.2 6.2 4.6-2 5.6-7.6 2.4-11.4'

const LevelStrip = ({
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
            {picked ? (
              <svg
                className="study-goal-pen"
                viewBox="0 0 24 22"
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
              >
                <path d={PEN_PATH} />
              </svg>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

const StepIcon = ({ plus }: { plus: boolean }): ReactElement => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={plus ? 'M5 12h14M12 5v14' : 'M5 12h14'} />
  </svg>
)

const DailyGoalStepper = ({
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

const StudyGoalForm = ({
  userId,
  redirect
}: {
  userId: string
  redirect: string
}): ReactElement | null => {
  const { t } = useTranslation('auth')
  const heading = useRef<HTMLHeadingElement>(null)
  const page = useStudyGoalPage(userId, redirect)
  const [level, setLevel] = useState<JlptLevel | null>(null)
  const [daily, setDaily] = useState<number | null>(null)
  const { goal } = page

  useEffect(() => {
    if (goal) heading.current?.focus()
  }, [goal])

  if (!goal) {
    return (
      <div className="auth-panel study-goal">
        <p role="status">{t('sso.checkingAccount')}</p>
      </div>
    )
  }
  // O-2: the saved level, else this device's last practice level, else N5.
  const pickedLevel =
    level ?? goal.targetLevel ?? readLastPracticeLevel() ?? FALLBACK_LEVEL
  const pickedDaily = daily ?? goal.dailyGoal ?? DAILY_MIN
  // O-3: [시작하기]/[나중에 할게요] only on the first onboarding; from My page
  // it is always [저장]/[취소], answered or not.
  const first = goal.onboardingRequired && redirect !== EDIT_RETURN_PATH
  const save = (): void =>
    page.onSave({ targetLevel: pickedLevel, dailyGoal: pickedDaily })
  return (
    <div className="auth-panel study-goal">
      <h1 ref={heading} className="outline-none" tabIndex={-1}>
        {t('studyGoal.title')}
      </h1>
      <p className="study-goal-hint">{t('studyGoal.hint')}</p>
      <div className="study-goal-question">
        <p className="study-goal-label" aria-hidden="true">
          {t('studyGoal.level')}
        </p>
        <LevelStrip
          label={t('studyGoal.level')}
          value={pickedLevel}
          onChange={setLevel}
        />
      </div>
      <div className="study-goal-question">
        <p className="study-goal-label" aria-hidden="true">
          {t('studyGoal.daily')}
        </p>
        <DailyGoalStepper
          label={t('studyGoal.daily')}
          value={pickedDaily}
          onChange={setDaily}
        />
      </div>
      <div className="study-goal-actions">
        {page.failed ? (
          <p className="study-goal-error" role="alert">
            {t('studyGoal.failed')}
          </p>
        ) : null}
        <Button
          className="study-goal-submit"
          size="lg"
          fullWidth
          disabled={page.busy}
          isLoading={page.isSaving}
          onClick={save}
        >
          {first ? t('studyGoal.start') : t('studyGoal.save')}
        </Button>
        <button
          type="button"
          className="study-goal-later"
          disabled={page.busy}
          onClick={first ? page.onSkip : page.onCancel}
        >
          {first ? t('studyGoal.later') : t('studyGoal.cancel')}
        </button>
      </div>
    </div>
  )
}

/**
 * #1090 '학습 목표': one page after the sign-up check (and once after a
 * sign-in while it is due), and the same page from My page. Guests have no
 * study goal; the layout shows only the logo here.
 */
export const OnboardingPage = (): ReactElement => {
  const { t } = useTranslation('auth')
  const [search] = useSearchParams()
  const { isReady, user } = useAuth()
  const redirect = readRedirect(search.get('redirect'))
  if (!isReady) {
    return (
      <section className="auth-page">
        <p role="status">{t('sso.checkingSession')}</p>
      </section>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return (
    <section className="auth-page study-goal-page">
      <StudyGoalForm key={user.id} userId={user.id} redirect={redirect} />
    </section>
  )
}
