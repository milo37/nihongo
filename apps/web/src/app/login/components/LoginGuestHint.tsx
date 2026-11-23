import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import {
  GUEST_DAILY_SESSION_LIMIT,
  GUEST_SESSION_QUESTION_LIMIT
} from '@nihongo/contracts/study/guest-limits'

/** Under the sign-in card: guests can still practise, with a link back. */
export const LoginGuestHint = ({
  redirect
}: {
  redirect: string
}): ReactElement => {
  const { t } = useTranslation('auth')
  return (
    <p className="auth-guest-hint">
      {t('sso.guestHint', {
        total: GUEST_DAILY_SESSION_LIMIT,
        count: GUEST_SESSION_QUESTION_LIMIT
      })}{' '}
      <Link to={redirect.startsWith('/practice') ? redirect : '/practice'}>
        {t('sso.guestLink')}
      </Link>
    </p>
  )
}
