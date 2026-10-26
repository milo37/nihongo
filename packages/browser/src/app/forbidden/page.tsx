import { useTranslation } from 'react-i18next'
import { AppLink as Link } from '../../common/components/AppLink'
import type { ReactElement } from 'react'
import { getButtonClassName } from '../../common/components/Button'
import { useAuth } from '../../provider/ProtectedRouteProvider'

export const ForbiddenPage = (): ReactElement => {
  const { t } = useTranslation('errors')
  const { t: commonT } = useTranslation('common')
  const { user } = useAuth()
  return (
    <section className="auth-page">
      <div className="auth-panel auth-system-panel">
        <h1>{t('forbidden.title')}</h1>
        <p className="auth-result-description">
          {t(
            user ? 'forbidden.memberDescription' : 'forbidden.guestDescription'
          )}
        </p>
        <div className="auth-actions">
          <Link
            className={getButtonClassName({ fullWidth: true, size: 'lg' })}
            to={user ? '/practice' : '/login'}
          >
            {user ? commonT('actions.goPractice') : commonT('actions.goLogin')}
          </Link>
          <Link
            className={getButtonClassName({
              fullWidth: true,
              size: 'lg',
              variant: 'outline'
            })}
            to={user ? '/login' : '/practice'}
          >
            {user
              ? t('forbidden.accountAction')
              : commonT('actions.goPractice')}
          </Link>
        </div>
      </div>
    </section>
  )
}
