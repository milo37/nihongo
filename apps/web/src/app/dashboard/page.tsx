import { Navigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import { LearningHome } from '@app/home/page'
import { ReviewDueLine } from '@app/dashboard/components/ReviewDueLine'
import { WeekLine } from '@app/dashboard/components/WeekLine'

export const DashboardPage = (): ReactElement => {
  const [searchParams] = useSearchParams()
  return searchParams.get('view') === 'learning' ? (
    <LearningHome
      memberLine={<ReviewDueLine />}
      memberFootLine={(level) => <WeekLine level={level} />}
    />
  ) : (
    <Navigate replace to="/wrong-notes" />
  )
}
