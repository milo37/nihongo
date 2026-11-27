import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { PenCircle } from '@app/login/components/PenCircle'
import type { useGoalPush } from '@app/login/hooks/useGoalPush'

// #1046: 'Shall we tell you at 8?' with a switch. Blocked by the browser or
// before an iPhone home screen install: dimmed, with one grey line why.
export const GoalPushSwitch = ({
  push,
  disabled
}: {
  push: ReturnType<typeof useGoalPush>
  disabled: boolean
}): ReactElement | null => {
  const { t } = useTranslation('auth')
  const id = useId()
  if (push.state === 'hidden') return null
  const hint =
    push.state === 'denied'
      ? t('studyGoal.pushDenied')
      : push.state === 'ios'
        ? t('studyGoal.pushIos')
        : null
  return (
    <div className="study-goal-question study-goal-push">
      <label className="study-goal-label" htmlFor={id}>
        {t('studyGoal.push')}
      </label>
      <span className="study-goal-switch-box">
        <input
          id={id}
          className="study-goal-switch"
          type="checkbox"
          role="switch"
          checked={push.checked}
          disabled={disabled || hint !== null}
          aria-describedby={hint ? id + '-hint' : undefined}
          onChange={(event) => void push.toggle(event.currentTarget.checked)}
        />
        <PenCircle className="study-goal-switch-pen" />
      </span>
      {hint ? (
        <p id={id + '-hint'} className="study-goal-push-hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
