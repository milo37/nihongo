import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { accountQueries } from '@app/login/queries/accountQueries'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { Button, getButtonClassName } from '@common/components/Button'
export const AccountDataPage = (): ReactElement => {
  const { t } = useTranslation('auth')
  const { isReady, user } = useAuth()
  const receipt = useQuery({
    ...accountQueries.deletion(),
    enabled: isReady && user === null
  })
  return (
    <section className="auth-page">
      <div className="auth-panel">
        <header className="auth-heading">
          <h1>{t('sso.dataGuide')}</h1>
          <p>{t('sso.dataDescription')}</p>
        </header>
        <p>{t('sso.deleteDescription')}</p>
        {!isReady || (!user && receipt.isPending) ? (
          <p role="status">{t('sso.checkingAccount')}</p>
        ) : receipt.data && !user ? (
          <>
            <p role="status">
              {t(
                receipt.data.appStatus === 'DELETED'
                  ? 'sso.deletionComplete'
                  : 'sso.deletionAccepted'
              )}
            </p>
            <ul className="grid gap-3">
              {receipt.data.providerCleanup.map((item) => (
                <li key={item.provider}>
                  <strong>
                    {item.provider === 'apple' ? 'Apple' : 'Google'}
                  </strong>
                  <p>
                    {t(
                      item.status === 'COMPLETED'
                        ? 'sso.cleanupComplete'
                        : item.status === 'FAILED'
                          ? 'sso.cleanupFailed'
                          : 'sso.cleanupPending'
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : !user ? (
          <p role="status">{t('sso.deletionUnknown')}</p>
        ) : null}
        <div className="auth-actions">
          {!user ? (
            <Button
              className="whitespace-normal break-words text-center"
              fullWidth
              variant="outline"
              disabled={receipt.isFetching}
              onClick={() => void receipt.refetch()}
            >
              {t('sso.recheck')}
            </Button>
          ) : null}
          <Link
            to="/login"
            className={getButtonClassName({
              variant: 'outline',
              fullWidth: true,
              className: 'whitespace-normal break-words text-center'
            })}
          >
            {t('sso.accountTitle')}
          </Link>
          <Link
            to="/practice"
            className={getButtonClassName({
              variant: 'ghost',
              fullWidth: true,
              className: 'whitespace-normal break-words text-center'
            })}
          >
            {t('sso.guest')}
          </Link>
        </div>
      </div>
    </section>
  )
}
