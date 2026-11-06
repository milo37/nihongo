import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { OperationsNavigation } from '@app/operations/components/OperationsNavigation'
import { OperationsTableOfContents } from '@app/operations/components/OperationsTableOfContents'
import { operationsPages } from '@app/operations/operationsContent'
import type { OperationsInformationPageKind } from '@app/operations/operationsContent'
import { legalSettings } from '@app/operations/legalSettings'
import type { LegalSettings } from '@app/operations/legalSettings'

type OperationsInformationPageProps = {
  page: OperationsInformationPageKind
  settings?: LegalSettings
}

// Circled numbers start the clauses of one article; each gets its own line.
const splitClauses = (body: string): string[] =>
  body.split(/(?=[①-⑳])/).map((clause) => clause.trim())

export const OperationsInformationPage = ({
  page,
  settings = legalSettings
}: OperationsInformationPageProps): ReactElement => {
  const { t } = useTranslation('operations')
  const { sections } = operationsPages[page]
  const contactUnset = t('sections.contact.contactUnset')
  const values = {
    effectiveDate: settings.effectiveDate || t('settingFallback.effectiveDate'),
    privacyOfficer:
      settings.privacyOfficer || t('settingFallback.privacyOfficer'),
    contactEmail: settings.contactEmail || contactUnset
  }

  return (
    <div className="operations-information">
      <OperationsNavigation page={page} translate={t} />
      <header className="operations-heading">
        <h1>{t(`pages.${page}.title`)}</h1>
        <p>{t(`pages.${page}.description`)}</p>
      </header>
      {page === 'legal' ? (
        <p className="operations-effective-date">
          {t('effectiveDate', values)}
        </p>
      ) : null}
      <OperationsTableOfContents sections={sections} translate={t} />
      {sections.map((section) => {
        const { id, key } = section
        return (
          <section
            className="operations-section"
            id={id}
            key={id}
            tabIndex={-1}
            aria-labelledby={`${id}-title`}
          >
            <h2 id={`${id}-title`}>{t(`sections.${key}.title`)}</h2>
            {key === 'contact' && !settings.contactEmail ? (
              <p>{contactUnset}</p>
            ) : (
              <p>{t(`sections.${key}.summary`, values)}</p>
            )}
            {'articleCount' in section ? (
              <ol className="operations-articles">
                {Array.from({ length: section.articleCount }, (_, index) => {
                  const number = String(index + 1)
                  return (
                    <li key={number}>
                      <h3>
                        {t('articleTitle', {
                          number,
                          title: t(`sections.${key}.articles.${number}.title`)
                        })}
                      </h3>
                      {splitClauses(
                        t(`sections.${key}.articles.${number}.body`, values)
                      ).map((clause) => (
                        <p key={clause}>{clause}</p>
                      ))}
                    </li>
                  )
                })}
              </ol>
            ) : (
              <p className="operations-details">
                {t(`sections.${key}.details`)}
              </p>
            )}
            {key === 'questionReport' ? (
              <p className="operations-details">
                {t('sections.questionReport.response')}
              </p>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
