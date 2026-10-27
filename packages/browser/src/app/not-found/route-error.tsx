import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { useDocumentMetadata } from '../../common/hooks/useDocumentMetadata'

// This fallback must render even when the authenticated app shell fails.
export const RouteErrorPage = (): ReactElement => {
  useDocumentMetadata({ robots: 'noindex,follow' })
  const { t } = useTranslation('errors')
  const { t: commonT } = useTranslation('common')
  return (
    <main
      id="main-content"
      className="auth-page auth-route-fallback"
      role="alert"
      tabIndex={-1}
    >
      <div className="auth-panel auth-system-panel">
        <h1>{t('route.title')}</h1>
        <p className="auth-result-description">{t('route.fallback')}</p>
        <div className="auth-actions">
          <a className="auth-fallback-action" href="/practice">
            {commonT('actions.goPractice')}
          </a>
        </div>
      </div>
    </main>
  )
}
