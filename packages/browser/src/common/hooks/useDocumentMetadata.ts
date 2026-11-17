import { useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useHref, useLocation } from 'react-router'
import { getAppPath } from '../../libs/appNavigation'
import { getRouteLabelKey } from '../../i18n/routePresentation'
import type { RouteLabelKey } from '../../i18n/routePresentation'

// #981: the public pages describe themselves, with the same text the build
// writes into their page copies (packages/browser/vite.config.ts).
const pageDescriptionKeys = {
  'routes.practiceSetup': 'metaDescriptions.practiceSetup',
  'routes.legal': 'metaDescriptions.legal',
  'routes.support': 'metaDescriptions.support'
} as const

type DocumentMetadataOptions = {
  readonly robots: 'index,follow' | 'noindex,follow'
  /** Overrides the label the path gives, e.g. the sign-up check (#1085). */
  readonly routeLabelKey?: RouteLabelKey
}

export const useDocumentMetadata = ({
  robots,
  routeLabelKey
}: DocumentMetadataOptions): void => {
  const routeLocation = useLocation()
  const basename = useHref('/')
  const location = {
    ...routeLocation,
    pathname: getAppPath(routeLocation.pathname, basename)
  }
  const { t, i18n } = useTranslation('navigation')

  useLayoutEffect(() => {
    const routeKey = routeLabelKey ?? getRouteLabelKey(location.pathname)
    const route = t(routeKey)
    document.title = t('documentTitle', { route })

    let description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]'
    )
    if (!description) {
      description = document.createElement('meta')
      description.name = 'description'
      document.head.append(description)
    }
    description.content = t(
      routeKey in pageDescriptionKeys
        ? pageDescriptionKeys[routeKey as keyof typeof pageDescriptionKeys]
        : 'metaDescription'
    )

    // #1045: the name iOS gives the home screen icon follows the page
    // language. Only the learner page carries the tag; admin has none.
    const appleTitle = document.querySelector<HTMLMetaElement>(
      'meta[name="apple-mobile-web-app-title"]'
    )
    if (appleTitle) appleTitle.content = t('common:appName')

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
  }, [
    basename,
    i18n.resolvedLanguage,
    location.pathname,
    robots,
    routeLabelKey,
    t
  ])
}
