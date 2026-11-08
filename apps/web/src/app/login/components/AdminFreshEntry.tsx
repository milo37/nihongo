import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { safeAdminFreshReturnPath } from '@nihongo/contracts/auth/admin-fresh-sso'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import { SsoProviderButton } from '@app/login/components/SsoProviderButton'
import { useStartAdminFresh } from '@app/login/hooks/useStartAdminFresh'
import { AuthFlowError } from '@nihongo/browser/app/login/authFlowErrors'

type AdminFreshEntryProps = { returnPath: string }
export const AdminFreshEntry = ({
  returnPath
}: AdminFreshEntryProps): ReactElement => {
  const { t } = useTranslation('auth')
  const start = useStartAdminFresh()
  const google = useRef<HTMLButtonElement>(null)
  const busy = start.isPending || start.isRedirecting
  useEffect(() => {
    if (start.isError) google.current?.focus()
  }, [start.isError])
  const begin = (selected: SsoProviderId): void => {
    if (busy) return
    start.mutate({
      purpose: 'ADMIN_FRESH',
      provider: selected,
      callbackURL: safeAdminFreshReturnPath(returnPath)
    })
  }
  return (
    <section aria-labelledby="admin-fresh-title">
      <h1 id="admin-fresh-title">{t('adminFresh.title')}</h1>
      <p className="auth-description">{t('adminFresh.description')}</p>
      <div className="auth-actions">
        <SsoProviderButton
          provider="google"
          label={t('sso.continueGoogle')}
          buttonRef={google}
          disabled={busy}
          isLoading={busy}
          loadingLabel={t('sso.redirecting', { provider: 'Google' })}
          onClick={() => begin('google')}
        />
      </div>
      {start.isError ? (
        <p className="auth-notice auth-error" role="alert">
          {t(
            start.error instanceof AuthFlowError && start.error.unavailable
              ? 'sso.unavailable'
              : 'adminFresh.failed'
          )}
        </p>
      ) : null}
    </section>
  )
}
