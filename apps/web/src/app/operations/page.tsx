import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'

export type OperationsInformationPageKind = 'account' | 'legal' | 'support'

interface OperationsInformationPageProps {
  readonly page: OperationsInformationPageKind
}

const sectionIdsByPage = {
  account: ['deletion', 'dataExport'],
  legal: ['terms', 'privacy', 'copyright'],
  support: ['questionReport', 'contact']
} as const

const informationLinks = [
  { href: '/legal#terms', key: 'terms' },
  { href: '/legal#privacy', key: 'privacy' },
  { href: '/legal#copyright', key: 'copyright' },
  { href: '/account/data#deletion', key: 'deletion' },
  { href: '/account/data#data-export', key: 'dataExport' },
  { href: '/support#question-report', key: 'questionReport' },
  { href: '/support#contact', key: 'contact' }
] as const

const sectionDomIds = {
  contact: 'contact',
  copyright: 'copyright',
  dataExport: 'data-export',
  deletion: 'deletion',
  privacy: 'privacy',
  questionReport: 'question-report',
  terms: 'terms'
} as const

export const OperationsInformationPage = ({
  page
}: OperationsInformationPageProps): ReactElement => {
  const { t } = useTranslation('operations')
  const sections = sectionIdsByPage[page]

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:py-16">
      <p className="text-sm font-black tracking-[0.16em] text-brand">
        {t(`pages.${page}.eyebrow`)}
      </p>
      <h1 className="mt-2 text-4xl font-black tracking-tight">
        {t(`pages.${page}.title`)}
      </h1>
      <p className="mt-4 max-w-3xl leading-7 text-muted">
        {t(`pages.${page}.description`)}
      </p>

      <div
        className="mt-8 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950"
        role="status"
      >
        <p className="font-black">{t('foundation.title')}</p>
        <p className="mt-2 leading-7">{t('foundation.description')}</p>
      </div>

      <nav
        aria-label={t('navigation.label')}
        className="mt-8 rounded-xl border border-line bg-white p-5"
      >
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          {informationLinks.map(({ href, key }) => (
            <li key={key}>
              <Link
                className="inline-flex min-h-11 items-center font-bold text-brand underline decoration-2 underline-offset-4"
                to={href}
              >
                {t(`navigation.${key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-10 space-y-6">
        {sections.map((section) => (
          <article
            key={section}
            className="scroll-mt-24 rounded-xl border border-line bg-white p-6 shadow-soft sm:p-8"
            id={sectionDomIds[section]}
            tabIndex={-1}
          >
            <h2 className="text-2xl font-black">
              {t(`sections.${section}.title`)}
            </h2>
            <p className="mt-4 leading-7 text-ink">
              {t(`sections.${section}.summary`)}
            </p>
            <p className="mt-3 leading-7 text-muted">
              {t(`sections.${section}.details`)}
            </p>
            <p className="mt-4 border-l-4 border-amber-400 pl-4 text-sm font-semibold leading-6 text-amber-950">
              {t(`sections.${section}.status`)}
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}
