import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { DELETE_PARAGRAPHS } from '@app/account/components/TwoStepConfirmDialog'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

// Static guide: what sign-out, unlink and deletion do with account data. It
// makes no account requests, so signed-out visitors see no error state.
export const AccountDataPage = (): ReactElement => {
  const { t } = useTranslation('account')
  const { user } = useAuth()
  return (
    <section className="auth-page">
      <div className="auth-panel grid gap-4 text-sm leading-7">
        <h1>{t('dataGuide')}</h1>
        <p className="text-muted">{t('data.description')}</p>
        <h2 className="mt-2 text-base font-semibold">{t('danger.title')}</h2>
        {DELETE_PARAGRAPHS.map((key) => (
          <p key={key}>{t(`confirm.deleteDescription.${key}`)}</p>
        ))}
        <p>
          <Link className="text-link underline" to="/legal#privacy">
            {t('data.privacyLink')}
          </Link>
        </p>
        {user ? (
          <p>
            <Link className="text-link underline" to="/account">
              {t('data.manageLink')}
            </Link>
          </p>
        ) : null}
      </div>
    </section>
  )
}
