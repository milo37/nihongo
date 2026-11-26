import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { Button } from '@nihongo/browser/common/components/Button'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { readLastPracticeLevel } from '@app/login/queries/studyGoalQueries'
import { FALLBACK_LEVEL } from '@app/practice/practiceSetupOptions'
import {
  EDIT_RETURN_PATH,
  useStudyGoalPage
} from '@app/login/hooks/useStudyGoalPage'
import {
  DAILY_MIN,
  DailyGoalStepper
} from '@app/login/components/DailyGoalStepper'
import { LevelStrip } from '@app/login/components/LevelStrip'
import { PenCircle } from '@app/login/components/PenCircle'
import {
  useErrorToast,
  useToast
} from '@nihongo/browser/common/components/Toast'
import { useGoalPush } from '@app/login/hooks/useGoalPush'

// My page opens the page to come back to itself; anything else is a sign-in
// return and follows the same rule.
const readRedirect = (value: string | null): string =>
  value === EDIT_RETURN_PATH ? value : safeSsoReturnPath(value)

// #1046: 'Shall we tell you at 8?' with a switch. Blocked by the browser or
// before an iPhone home screen install: dimmed, with one grey line why.
const GoalPushSwitch = ({
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

const StudyGoalForm = ({
  userId,
  redirect
}: {
  userId: string
  redirect: string
}): ReactElement | null => {
  const { t } = useTranslation('auth')
  const heading = useRef<HTMLHeadingElement>(null)
  const push = useGoalPush()
  const { addToast } = useToast()
  // The goal is saved either way; a failed subscription says so once.
  const page = useStudyGoalPage(userId, redirect, async () => {
    try {
      await push.apply()
    } catch {
      addToast({
        key: 'study-goal-push',
        title: t('studyGoal.pushFailed'),
        variant: 'warning'
      })
    }
  })
  // #1292: the button stays as it was; the toast says the save failed.
  useErrorToast(page.failed ? t('studyGoal.failed') : null, 'study-goal')
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
      <h1 ref={heading} className="auth-title-quiet" tabIndex={-1}>
        {t('studyGoal.title')}
      </h1>
      <p className="study-goal-hint">{t('studyGoal.hint')}</p>
      <div className="study-goal-list">
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
        <GoalPushSwitch push={push} disabled={page.busy} />
      </div>
      <div className="study-goal-actions">
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
