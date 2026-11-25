import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import type { SsoAccountFlow } from '@app/account/hooks/useSsoAccountManagement'
import { useRetryToast } from '@nihongo/browser/common/components/Toast'

// JLP-860: text on top, the button under it on the left (the My study empty
// state's rule), so the description can use the full width.
export const SettingRow = ({
  children,
  action
}: {
  children: ReactNode
  action?: ReactNode
}): ReactElement => (
  <div className="account-row">
    <div className="account-row-body">{children}</div>
    {action ? <div className="account-row-action">{action}</div> : null}
  </div>
)

/** The sign-in method row: checking, failed, not moved yet, or Google. */
export const SignInMethodRow = ({
  flow
}: {
  flow: SsoAccountFlow
}): ReactElement | null => {
  // Left uncompiled: the compiled settings section already caches this row
  // (#1124 bundle).
  'use no memo'
  const { t } = useTranslation('account')
  const { t: authT } = useTranslation('auth')
  const { caps } = flow
  // #1292: a failed read hides the row; the toast carries the retry.
  const isLoadFailed = !flow.capabilities.isPending && !caps
  useRetryToast(
    isLoadFailed ? authT('sso.actionFailed') : null,
    'sign-in-method',
    () => void flow.capabilities.refetch()
  )
  if (isLoadFailed) return null
  // Unlinking is not offered (C2): Google is the only sign-in method shown.
  const google = caps?.providers.find((p) => p.provider === 'google')
  return (
    <SettingRow>
      <p className="account-row-label">{t('settings.signInMethod')}</p>
      {flow.capabilities.isPending ? (
        <p role="status">{authT('sso.checkingAccount')}</p>
      ) : !caps ? null : !google ? (
        <p role="status">{authT('sso.migrationIncomplete')}</p>
      ) : (
        <>
          <p className="account-row-provider">
            {/* Google's own G mark, unchanged; the word stays as text. */}
            <img
              src="/auth/google-mark.svg"
              alt=""
              aria-hidden="true"
              width={20}
              height={20}
            />
            Google
          </p>
          {!google.reauthAvailable ? (
            <p className="account-row-note">
              {authT('sso.unavailableProvider', { provider: 'Google' })}
            </p>
          ) : null}
        </>
      )}
    </SettingRow>
  )
}
