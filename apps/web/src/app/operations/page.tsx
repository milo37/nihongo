import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { OperationsNavigation } from '@app/operations/components/OperationsNavigation'
import { OperationsTableOfContents } from '@app/operations/components/OperationsTableOfContents'
import { operationsPages } from '@app/operations/operationsContent'
import type { OperationsInformationPageKind } from '@app/operations/operationsContent'
import { Icon } from '@common/components/Icon'

type OperationsInformationPageProps = {
  page: OperationsInformationPageKind
}

export const OperationsInformationPage = ({
  page
}: OperationsInformationPageProps): ReactElement => {
  const { t } = useTranslation('operations')
  const { sections } = operationsPages[page]

  return (
    <div className="operations-information">
      <OperationsNavigation page={page} translate={t} />
      <header className="operations-heading">
        <h1>{t(`pages.${page}.title`)}</h1>
        <p>{t(`pages.${page}.description`)}</p>
      </header>
      <aside
        className="operations-notice"
        aria-labelledby="operations-notice-title"
      >
        <Icon name="circle-alert" />
        <div>
          <p id="operations-notice-title">
            <strong>{t('foundation.title')}</strong>
          </p>
          <p>{t('foundation.description')}</p>
        </div>
      </aside>
      <OperationsTableOfContents sections={sections} translate={t} />
      {sections.map(({ id, key }) => (
        <section
          className="operations-section"
          id={id}
          key={id}
          tabIndex={-1}
          aria-labelledby={`${id}-title`}
        >
          <h2 id={`${id}-title`}>
            {t(`sections.${key}.title`)}
            {page === 'account' ? (
              <span className="operations-unsupported">{t('unsupported')}</span>
            ) : null}
          </h2>
          <p>{t(`sections.${key}.summary`)}</p>
          <p className="operations-details">{t(`sections.${key}.details`)}</p>
          <p className="operations-pending">{t(`sections.${key}.status`)}</p>
        </section>
      ))}
    </div>
  )
}
