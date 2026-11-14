import { useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useHref, useLocation } from 'react-router'
import { getAppPath } from '../../libs/appNavigation'
import { getRouteLabelKey } from '../../i18n/routePresentation'

type DocumentMetadataOptions = {
  readonly robots: 'index,follow' | 'noindex,follow'
}

export const useDocumentMetadata = ({
  robots
}: DocumentMetadataOptions): void => {
  const routeLocation = useLocation()
  const basename = useHref('/')
  const location = {
    ...routeLocation,
    pathname: getAppPath(routeLocation.pathname, basename)
  }
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

    const robotsNodes = Array.from(
      document.head.querySelectorAll<HTMLMetaElement>('meta[name="robots" i]')
    )
    const robotsMeta = robotsNodes[0] ?? document.createElement('meta')
    robotsMeta.name = 'robots'
    robotsMeta.content = robots
    if (robotsNodes.length === 0) document.head.append(robotsMeta)
    robotsNodes.slice(1).forEach((node) => node.remove())

    // #980: an indexed page names itself (no query or hash) as canonical.
    const canonicalNodes = Array.from(
      document.head.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]')
    )
    if (robots === 'index,follow') {
      const canonical = canonicalNodes[0] ?? document.createElement('link')
      canonical.rel = 'canonical'
      canonical.href = `${window.location.origin}${basename.replace(/\/$/u, '')}${location.pathname}`
      if (canonicalNodes.length === 0) document.head.append(canonical)
      canonicalNodes.slice(1).forEach((node) => node.remove())
    } else {
      canonicalNodes.forEach((node) => node.remove())
    }
  }, [basename, i18n.resolvedLanguage, location.pathname, robots, t])
}
