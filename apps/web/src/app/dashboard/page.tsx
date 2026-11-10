import { Navigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import { LearningHome } from '@app/home/page'
import { ReviewDueLine } from '@app/dashboard/components/ReviewDueLine'

export const DashboardPage = (): ReactElement => {
  const [searchParams] = useSearchParams()
  return searchParams.get('view') === 'learning' ? (
    <LearningHome memberLine={<ReviewDueLine />} />
  ) : (
    <Navigate replace to="/wrong-notes" />
  )
}
