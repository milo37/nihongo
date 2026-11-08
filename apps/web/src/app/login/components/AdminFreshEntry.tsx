import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { AuthFlowError } from '@nihongo/browser/app/login/authFlowErrors'
import { ReauthButton } from '@nihongo/browser/app/reauth/ReauthButton'
import { useStartReauth } from '@nihongo/browser/app/reauth/useStartReauth'

type AdminFreshEntryProps = { returnPath: string }

// Admin pages still link here as /login?redirect=/admin/...; each starts the
// same-tab re-verification directly once the admin screens use
// useStartReauth, and this entry goes away.
export const AdminFreshEntry = ({
  returnPath
}: AdminFreshEntryProps): ReactElement => {
  const { t } = useTranslation('auth')
  const { t: adminT } = useTranslation('admin')
  const reauth = useStartReauth()
  const google = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (reauth.error) google.current?.focus()
  }, [reauth.error])
  return (
    <section aria-labelledby="admin-fresh-title">
      <h1 id="admin-fresh-title">{t('reauth.name')}</h1>
      <p className="auth-description">{t('reauth.description')}</p>
      <div className="auth-actions">
        <ReauthButton
          size="lg"
          fullWidth
          className="auth-sso-button"
          buttonRef={google}
          busy={reauth.busy}
          onClick={() => reauth.start(returnPath)}
        />
      </div>
      {reauth.error ? (
        <p className="auth-notice auth-error" role="alert">
          {reauth.error instanceof AuthFlowError && reauth.error.unavailable
            ? t('sso.unavailable')
            : adminT('reauth.failed')}
        </p>
      ) : null}
    </section>
  )
}
