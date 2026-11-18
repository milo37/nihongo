import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { useTodayGoal } from '@app/practice/hooks/useTodayGoal'

/**
 * #1090 O-r7: today's answers against the daily goal, one grey line under
 * the score; ink once the goal is met. Nothing without a goal.
 */
export const DailyGoalLine = ({
  userId
}: {
  userId: string
}): ReactElement | null => {
  const { t } = useTranslation('result')
  const goal = useTodayGoal(userId)
  if (goal?.dailyGoal == null) return null
  const today = goal.todayAnsweredCount
  const done = today >= goal.dailyGoal
  return (
    <p className={done ? 'result-daily-goal is-done' : 'result-daily-goal'}>
      {done
        ? t('dailyGoal.done', { goal: goal.dailyGoal })
        : t('dailyGoal.progress', { today, goal: goal.dailyGoal })}
    </p>
  )
}
