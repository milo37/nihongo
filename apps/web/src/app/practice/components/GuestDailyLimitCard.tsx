import { useTranslation } from 'react-i18next'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { ReactElement } from 'react'
import { GUEST_DAILY_SESSION_LIMIT } from '@nihongo/contracts/study/guest-limits'
import { SsoProviderButton } from '@app/login/components/SsoProviderButton'
import { useStartSocialSignIn } from '@app/login/hooks/useStartSocialSignIn'

/**
 * Today's guest tries are used up (JLP-823 limit card): on the first screen,
 * the practice setup, the last result and a server GUEST_LIMIT_REACHED alike.
 * Not an error: no red, no alert role.
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
      <div className="practice-guest-limit-head">
        <Icon name="moon" className="practice-guest-limit-icon" />
        <h2 id="practice-guest-limit-title">
          {t('setup.dailyLimit.title', { total: GUEST_DAILY_SESSION_LIMIT })}
        </h2>
      </div>
      <p>{t('setup.dailyLimit.description')}</p>
      {start.isError ? (
        <p className="auth-notice auth-error" role="alert">
          {authT('sso.failedProvider', { provider: 'Google' })}
        </p>
      ) : null}
      <SsoProviderButton
        provider="google"
        label={t('setup.dailyLimit.login')}
        disabled={busy}
        isLoading={busy}
        loadingLabel={authT('sso.redirecting', { provider: 'Google' })}
        onClick={() => {
          if (busy) return
          start.mutate({ provider: 'google', callbackURL: redirect })
        }}
      />
      <p className="practice-guest-limit-reset">
        {t('setup.dailyLimit.reset', { total: GUEST_DAILY_SESSION_LIMIT })}
      </p>
    </section>
  )
}
