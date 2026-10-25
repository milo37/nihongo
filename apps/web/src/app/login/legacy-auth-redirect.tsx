import { Navigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'

export const LegacyAuthRedirect = (): ReactElement => {
  const [search] = useSearchParams()
  const redirect = safeSsoReturnPath(search.get('redirect'))
  const next = new URLSearchParams()
  if (redirect !== '/') next.set('redirect', redirect)
  return (
    <Navigate
      replace
      to={{ pathname: '/login', search: next.toString() }}
      state={{ legacyAuthMethod: true }}
    />
  )
}
