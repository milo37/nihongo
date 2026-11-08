import { Navigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import { PracticePage } from '@app/practice/page'

export const DashboardPage = (): ReactElement => {
  const [searchParams] = useSearchParams()
  return searchParams.get('view') === 'learning' ? (
    <PracticePage />
  ) : (
    <Navigate replace to="/wrong-notes" />
  )
}
