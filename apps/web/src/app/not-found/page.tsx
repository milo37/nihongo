import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'

export const NotFoundPage = (): ReactElement => {
  const { t } = useTranslation('errors')
  const { t: commonT } = useTranslation('common')

  return (
    <section className="mx-auto max-w-2xl px-4 py-20 text-center">
      <p className="mb-3 text-sm font-bold text-brand">
        {t('notFound.eyebrow')}
      </p>
      <h1 className="text-3xl font-black">{t('notFound.title')}</h1>
      <p className="mt-4 text-muted">{t('notFound.description')}</p>
      <Link
        className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-bold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        to="/"
      >
        {commonT('actions.goHome')}
      </Link>
    </section>
  )
}
