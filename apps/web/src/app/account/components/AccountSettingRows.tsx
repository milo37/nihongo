import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import type { SsoAccountFlow } from '@app/account/hooks/useSsoAccountManagement'
import { Button } from '@nihongo/browser/common/components/Button'

// JLP-860: text on top, the button under it on the left (the My study empty
// state's rule), so the description can use the full width.
export const SettingRow = ({
  children,
  action
}: {
  children: ReactNode
  action?: ReactNode
}): ReactElement => (
  <div className="py-4 first:pt-0 last:pb-0">
    <div className="min-w-0 break-words text-sm leading-6">{children}</div>
    {action ? <div className="mt-3">{action}</div> : null}
  </div>
)

/** The sign-in method row: checking, failed, not moved yet, or Google. */
export const SignInMethodRow = ({
  flow
}: {
  flow: SsoAccountFlow
}): ReactElement => {
  // Left uncompiled: the compiled settings section already caches this row
  // (#1124 bundle).
  'use no memo'
  const { t } = useTranslation('account')
  const { t: authT } = useTranslation('auth')
  const { caps } = flow
  // Unlinking is not offered (C2): Google is the only sign-in method shown.
  const google = caps?.providers.find((p) => p.provider === 'google')
  return (
    <SettingRow>
      <p className="text-caption text-muted">{t('settings.signInMethod')}</p>
      {flow.capabilities.isPending ? (
        <p role="status">{authT('sso.checkingAccount')}</p>
      ) : !caps ? (
        <div role="alert">
          <p>{authT('sso.actionFailed')}</p>
          <Button
            className="mt-2"
            variant="outline"
            disabled={flow.capabilities.isFetching}
            onClick={() => void flow.capabilities.refetch()}
          >
            {authT('sso.recheck')}
          </Button>
        </div>
      ) : !google ? (
        <p role="status">{authT('sso.migrationIncomplete')}</p>
      ) : (
        <>
          <p className="mt-1 flex items-center gap-2 text-base font-semibold">
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
            <p className="text-caption">
              {authT('sso.unavailableProvider', { provider: 'Google' })}
            </p>
          ) : null}
        </>
      )}
    </SettingRow>
  )
}
