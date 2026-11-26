import { useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useHref, useLocation } from 'react-router'
import { getAppPath } from '../../libs/appNavigation'
import { stripLocalePrefix } from '../../libs/localePath'
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

// #1268: the build writes each public page's own title, description,
// canonical and hreflang into its HTML and names the page in a meta tag
// ("ko:/practice"). The first view of that very page in that language keeps
// them; the first move to another page or language removes the tag and hands
// over to this hook for good.
// A plain function: the compiler adds cache slots to every value in a hook.
const keepsBuiltHead = (language: string | undefined, fullPath: string) => {
  const tag = document.head.querySelector<HTMLMetaElement>(
    'meta[data-prerender]'
  )
  const keep = tag?.content === `${language}:${fullPath}`
  // The tag and the language links belong to the build's copy only.
  if (tag && !keep)
    document
      .querySelectorAll('[data-prerender]')
      .forEach((node) => node.remove())
  return keep
}

export const useDocumentMetadata = ({
  robots,
  routeLabelKey
}: DocumentMetadataOptions): void => {
  const routeLocation = useLocation()
  const basename = useHref('/')
  const fullPath = getAppPath(routeLocation.pathname, basename)
  const path = stripLocalePrefix(fullPath)
  const { t, i18n } = useTranslation('navigation')

  useLayoutEffect(() => {
    const keepPrerendered = keepsBuiltHead(i18n.resolvedLanguage, fullPath)

    if (!keepPrerendered) {
      const routeKey = routeLabelKey ?? getRouteLabelKey(path)
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
    }

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

    if (keepPrerendered) return
    // #980: an indexed page names itself (no query or hash) as canonical.
    const canonicalNodes = Array.from(
      document.head.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]')
    )
    if (robots === 'index,follow') {
      const canonical = canonicalNodes[0] ?? document.createElement('link')
      canonical.rel = 'canonical'
      canonical.href = `${window.location.origin}${basename.replace(/\/$/u, '')}${fullPath}`
      if (canonicalNodes.length === 0) document.head.append(canonical)
      canonicalNodes.slice(1).forEach((node) => node.remove())
    } else {
      canonicalNodes.forEach((node) => node.remove())
    }
  }, [
    basename,
    fullPath,
    i18n.resolvedLanguage,
    path,
    robots,
    routeLabelKey,
    t
  ])
}
