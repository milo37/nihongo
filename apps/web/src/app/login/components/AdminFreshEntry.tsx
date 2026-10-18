import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { safeAdminFreshReturnPath } from '@nihongo/contracts/auth/admin-fresh-sso'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import { SsoProviderButton } from '@app/login/components/SsoProviderButton'
import { useStartAdminFresh } from '@app/login/hooks/useStartAdminFresh'
import { AuthFlowError } from '@app/login/authFlowErrors'

type AdminFreshEntryProps = { returnPath: string; disabled?: boolean }
export const AdminFreshEntry = ({
  returnPath,
  disabled = false
}: AdminFreshEntryProps): ReactElement => {
  const { t } = useTranslation('auth')
  const start = useStartAdminFresh()
  const apple = useRef<HTMLButtonElement>(null)
  const google = useRef<HTMLButtonElement>(null)
  const busy = start.isPending || start.isRedirecting
  const provider = start.variables?.provider
  useEffect(() => {
    if (start.isError) (provider === 'apple' ? apple : google).current?.focus()
  }, [provider, start.isError])
  const begin = (selected: SsoProviderId): void => {
    if (busy || disabled) return
    start.mutate({
      purpose: 'ADMIN_FRESH',
      provider: selected,
      callbackURL: safeAdminFreshReturnPath(returnPath)
    })
  }
  return (
    <section className="auth-guest" aria-labelledby="admin-fresh-title">
      <h2 id="admin-fresh-title" className="text-lg font-semibold">
        {t('adminFresh.title')}
      </h2>
      <p>{t('adminFresh.description')}</p>
      <div className="auth-actions" aria-busy={busy || undefined}>
        <SsoProviderButton
          provider="apple"
          label={t('sso.continueApple')}
          buttonRef={apple}
          disabled={disabled || busy}
          onClick={() => begin('apple')}
        />
        <SsoProviderButton
          provider="google"
          label={t('sso.continueGoogle')}
          buttonRef={google}
          disabled={disabled || busy}
          onClick={() => begin('google')}
        />
      </div>
      {busy ? (
        <p className="auth-notice" role="status">
          {t('sso.redirecting', {
            provider: provider === 'apple' ? 'Apple' : 'Google'
          })}
        </p>
      ) : null}
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
