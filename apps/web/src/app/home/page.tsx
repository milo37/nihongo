import { Navigate, useLocation } from 'react-router'
import type { ReactElement } from 'react'
import { PracticePage } from '@app/practice/page'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

export const HomePage = (): ReactElement => {
  const { isReady, role } = useAuth()
  const location = useLocation()
  if (isReady && role !== 'GUEST') {
    const searchParams = new URLSearchParams(location.search)
    searchParams.set('view', 'learning')
    return (
      <Navigate
        to={{
          pathname: '/dashboard',
          search: `?${searchParams.toString()}`,
          hash: location.hash
        }}
        replace
      />
    )
  }
  return <PracticePage />
}
