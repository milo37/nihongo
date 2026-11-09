import { Navigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import { LearningHome } from '@app/home/page'

export const DashboardPage = (): ReactElement => {
  const [searchParams] = useSearchParams()
  return searchParams.get('view') === 'learning' ? (
    <LearningHome />
  ) : (
    <Navigate replace to="/wrong-notes" />
  )
}
