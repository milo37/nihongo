import { useTranslation } from 'react-i18next'
import { AppLink as Link } from '../../common/components/AppLink'
import type { ReactElement } from 'react'
import { getButtonClassName } from '../../common/components/Button'

export const NotFoundPage = (): ReactElement => {
  const { t } = useTranslation('errors')
  const { t: commonT } = useTranslation('common')
  return (
    <section className="auth-page">
      <div className="auth-panel auth-system-panel">
        <h1>{t('notFound.title')}</h1>
        <p className="auth-result-description">{t('notFound.description')}</p>
        <div className="auth-actions">
          <Link
            className={getButtonClassName({ fullWidth: true, size: 'lg' })}
            to="/practice"
          >
            {commonT('actions.goPractice')}
          </Link>
        </div>
      </div>
    </section>
  )
}
