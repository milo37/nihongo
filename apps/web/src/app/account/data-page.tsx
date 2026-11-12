import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { DELETE_PARAGRAPHS } from '@app/account/components/TwoStepConfirmDialog'
import { OperationsNavigation } from '@app/operations/components/OperationsNavigation'

// Static guide: what sign-out, unlink and deletion do with account data. It
// makes no account requests, so signed-out visitors see no error state.
// JLP-850: the same frame as the other two information pages (top tabs,
// heading, sections); the bottom tab bar leads back to My.
export const AccountDataPage = (): ReactElement => {
  const { t } = useTranslation('account')
  const { t: operationsT } = useTranslation('operations')
  return (
    <div className="operations-information">
      <OperationsNavigation page="account" translate={operationsT} />
      <header className="operations-heading">
        <h1>{t('dataGuide')}</h1>
        <p>{t('data.description')}</p>
      </header>
      <section className="operations-section" aria-labelledby="deletion-title">
        <h2 id="deletion-title">{t('danger.title')}</h2>
        {DELETE_PARAGRAPHS.map((key) => (
          <p key={key}>{t(`confirm.deleteDescription.${key}`)}</p>
        ))}
        <p>
          <Link
            className="inline-flex min-h-11 items-center text-link underline"
            to="/legal#privacy"
          >
            {t('data.privacyLink')}
          </Link>
        </p>
      </section>
    </div>
  )
}
