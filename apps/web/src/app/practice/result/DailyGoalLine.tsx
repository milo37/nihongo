import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { useStampOnce } from '@app/practice/hooks/useStampOnce'
import { useTodayGoal } from '@app/practice/hooks/useTodayGoal'
import { StampStage } from '@app/practice/result/StampStage'

// The server stamps the Asia/Seoul day it saves the set, so the stamp's
// month is the submission's month there.
const stampMonth = (submittedAt: string | null): number =>
  Number(
    new Date(submittedAt ?? Date.now()).toLocaleDateString('en-US', {
      month: 'numeric',
      timeZone: 'Asia/Seoul'
    })
  )

/**
 * #1090 O-r7: today's answers against the daily goal, one grey line under
 * the score; ink once the goal is met. Nothing without a goal.
 * #1094 M-2: the set that met the goal also gets Maru's stamp and
 * '· 11월 도장 꾹' at the end of the same line, once (M-2b: the stamp's
 * month, never a count).
 */
export const DailyGoalLine = ({
  userId,
  sessionId,
  stampEarned,
  submittedAt
}: {
  userId: string
  sessionId: string
  stampEarned: boolean
  submittedAt: string | null
}): ReactElement | null => {
  const { t } = useTranslation('result')
  const goal = useTodayGoal(userId)
  const stamp = useStampOnce(sessionId, stampEarned)
  if (goal?.dailyGoal == null) return null
  const today = goal.todayAnsweredCount
  const done = today >= goal.dailyGoal
  if (!done) {
    return (
      <p className="result-daily-goal">
        {t('dailyGoal.progress', { today, goal: goal.dailyGoal })}
      </p>
    )
  }
  const line = (
    <p className="result-daily-goal is-done">
      {t('dailyGoal.done', { goal: goal.dailyGoal })}
      {stamp ? (
        <span className="result-stamp-note">
          {t('dailyGoal.stamp', { month: stampMonth(submittedAt) })}
        </span>
      ) : null}
    </p>
  )
  return stamp ? (
    <div className="result-stamp">
      <StampStage />
      {line}
    </div>
  ) : (
    line
  )
}
