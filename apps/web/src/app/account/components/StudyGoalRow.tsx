import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { readDevicePush } from '@common/libs/devicePush'
import {
  onboardingPath,
  useStudyGoal
} from '@app/login/queries/studyGoalQueries'

/**
 * #1090 O-3·O-r7: one '학습 목표' row under the name, in place of the target
 * level select. Set: the values in a bordered row; not set: a grey line and
 * a link, no box. Both open the study goal page, which comes back here.
 */
export const StudyGoalRow = ({ userId }: { userId: string }): ReactElement => {
  const { t } = useTranslation('account')
  const goal = useStudyGoal(userId)
  const to = onboardingPath('/account')
  const set = goal?.dailyGoal != null && goal.targetLevel !== null
  // #1046: '알림 켬' when this device gets the morning push.
  const [pushOn, setPushOn] = useState(false)
  useEffect(() => {
    let live = true
    void readDevicePush().then((state) => {
      if (live) setPushOn(state === 'on')
    })
    return () => {
      live = false
    }
  }, [])
  return (
    <section className="study-goal-row" aria-labelledby="study-goal-row-label">
      <p id="study-goal-row-label" className="study-goal-row-label">
        {t('studyGoal.label')}
      </p>
      {goal === null ? null : set ? (
        <Link className="study-goal-row-link is-set" to={to}>
          <span>
            {t('studyGoal.set', {
              level: goal.targetLevel,
              count: goal.dailyGoal,
              today: goal.todayAnsweredCount
            })}
          </span>
          {pushOn ? (
            <span className="study-goal-row-push">{t('studyGoal.pushOn')}</span>
          ) : null}
          <Icon name="chevron-right" className="study-goal-row-chevron" />
        </Link>
      ) : (
        <>
          <p className="study-goal-row-note">{t('studyGoal.unset')}</p>
          <Link className="study-goal-row-link" to={to}>
            {t('studyGoal.action')}
            <Icon name="chevron-right" className="study-goal-row-chevron" />
          </Link>
        </>
      )}
    </section>
  )
}
