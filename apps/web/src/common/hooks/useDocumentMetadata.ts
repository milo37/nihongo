import { useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { getRouteLabelKey } from '@/i18n/routePresentation'

export const useDocumentMetadata = (): void => {
  const location = useLocation()
  const { t, i18n } = useTranslation('navigation')

  useLayoutEffect(() => {
    const route = t(getRouteLabelKey(location.pathname))
    document.title = t('documentTitle', { route })

    let description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]'
    )
    if (!description) {
      description = document.createElement('meta')
      description.name = 'description'
      document.head.append(description)
    }
    description.content = t('metaDescription')
  }, [i18n.resolvedLanguage, location.pathname, t])
}
