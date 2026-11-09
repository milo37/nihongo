import { useTranslation } from 'react-i18next'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { ReactElement } from 'react'
import { GUEST_DAILY_SESSION_LIMIT } from '@nihongo/contracts/study/guest-limits'
import { SsoProviderButton } from '@app/login/components/SsoProviderButton'
import { useStartSocialSignIn } from '@app/login/hooks/useStartSocialSignIn'

/**
 * Today's guest tries are used up (U4 L18), from the allowance or from the
 * server's GUEST_LIMIT_REACHED. Not an error: no red, no alert role.
 */
export const GuestDailyLimitCard = ({
  redirect
}: {
  redirect: string
}): ReactElement => {
  const { t } = useTranslation('practice')
  const { t: authT } = useTranslation('auth')
  const start = useStartSocialSignIn()
  const busy = start.isPending || start.isRedirecting
  return (
    <section
      className="practice-guest-limit"
      aria-labelledby="practice-guest-limit-title"
    >
      <span className="practice-guest-limit-icon" aria-hidden="true">
        <Icon name="alarm-clock" />
      </span>
      <div className="min-w-0">
        <h2 id="practice-guest-limit-title">{t('setup.dailyLimit.title')}</h2>
        <p>
          {t('setup.dailyLimit.description', {
            total: GUEST_DAILY_SESSION_LIMIT
          })}
        </p>
        {start.isError ? (
          <p className="auth-notice auth-error" role="alert">
            {authT('sso.failedProvider', { provider: 'Google' })}
          </p>
        ) : null}
        <SsoProviderButton
          provider="google"
          label={authT('sso.continueGoogle')}
          disabled={busy}
          isLoading={busy}
          loadingLabel={authT('sso.redirecting', { provider: 'Google' })}
          onClick={() => {
            if (busy) return
            start.mutate({ provider: 'google', callbackURL: redirect })
          }}
        />
      </div>
    </section>
  )
}
