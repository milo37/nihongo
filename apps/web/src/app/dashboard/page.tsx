import { Navigate, useLocation, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import { LearningHome } from '@app/home/page'
import { ReviewDueLine } from '@app/dashboard/components/ReviewDueLine'
import { WeekLine } from '@app/dashboard/components/WeekLine'

/** A member's home at /: the same screen with the member lines. */
export const MemberHome = (): ReactElement => (
  <LearningHome
    memberLine={<ReviewDueLine />}
    memberFootLine={(level) => <WeekLine level={level} />}
  />
)

// #978: home has one address, /. An old /dashboard?view=learning link lands
// there; a bare /dashboard still opens the wrong-answer notes.
export const DashboardPage = (): ReactElement => {
  const [searchParams] = useSearchParams()
  const { hash } = useLocation()
  if (searchParams.get('view') !== 'learning')
    return <Navigate replace to="/wrong-notes" />
  // A copy: the router hands back the same object on the next render.
  const search = new URLSearchParams(searchParams)
  search.delete('view')
  return (
    <Navigate replace to={{ pathname: '/', search: search.toString(), hash }} />
  )
}
