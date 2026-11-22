import { useEffect } from 'react'
import { Navigate } from 'react-router'
import type { ReactElement } from 'react'
import {
  ACCOUNT_FRESH_PARAM,
  ACCOUNT_REAUTH_PARAM
} from '@app/account/hooks/useSsoAccountManagement'
import { appDocumentNavigation } from '@nihongo/browser/libs/appNavigation'

// /login is for signed-out visitors. Signed-in visitors go to learning home,
// except two hand-offs that still arrive here: account verification returns
// (forwarded to /account) and admin verification opened from the admin app.
/** The admin app is another document, so leave the learner router. */
const AdminDocumentReturn = ({ to }: { readonly to: string }): null => {
  useEffect(() => appDocumentNavigation.replace(to), [to])
  return null
}

export const SignedInRedirect = ({
  isAdmin,
  redirect,
  accountReturn,
  reauth
}: {
  isAdmin: boolean
  redirect: string
  accountReturn: string | null
  reauth: string | null
}): ReactElement => {
  if (accountReturn !== null) {
    const forward = new URLSearchParams()
    forward.set(ACCOUNT_FRESH_PARAM, accountReturn)
    if (reauth !== null) forward.set(ACCOUNT_REAUTH_PARAM, reauth)
    return (
      <Navigate
        replace
        to={{ pathname: '/account', search: forward.toString() }}
      />
    )
  }
  // Admin pages start re-verification themselves; an old
  // /login?redirect=/admin/... link just goes back to the admin page.
  if (isAdmin && redirect.startsWith('/admin'))
    return <AdminDocumentReturn to={redirect} />
  return <Navigate replace to="/" />
}
