// #981: crawlers that do not run JavaScript (Naver) read each public page's
// own title, description and share text from a copy of the built index.html.
// The API static server answers /practice with practice/index.html, so the
// copies need no server or deploy change.
// #1268: the copies also carry the page language, hreflang links and the
// page's own text inside <noscript>: crawlers and visitors without JavaScript
// read it, while a browser that runs the app never shows it (no flash, no
// layout change). The scripts stay the same.

export const SITE_ORIGIN = 'https://harumaru.app'

export type PublicPageHtml = {
  readonly path: string
  readonly locale: 'ko' | 'ja'
  readonly title: string
  readonly description: string
  /** Escaped HTML of the page's text; shown only without JavaScript. */
  readonly bodyHtml: string
  readonly alternates: readonly { hreflang: string; href: string }[]
}

const escapeAttribute = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

// Each tag must appear exactly once, so a changed index.html stops the build.
const replaceOnce = (
  html: string,
  pattern: RegExp,
  replace: (match: string) => string
): string => {
  const matches = html.match(new RegExp(pattern.source, `${pattern.flags}g`))
  if (matches?.length !== 1) {
    throw new Error(`Public page HTML: expected one ${pattern.source}`)
  }
  return html.replace(pattern, replace)
}

const setMetaContent = (
  html: string,
  attribute: 'name' | 'property',
  name: string,
  content: string
): string =>
  replaceOnce(
    html,
    new RegExp(`<meta\\s+${attribute}="${name}"\\s+content="[^"]*"`, 'u'),
    (match) =>
      `${match.slice(0, match.indexOf('content="'))}content="${content}"`
  )

const OG_LOCALE = { ko: 'ko_KR', ja: 'ja_JP' } as const

export const renderPublicPageHtml = (
  indexHtml: string,
  { path, locale, title, description, bodyHtml, alternates }: PublicPageHtml
): string => {
  const url = escapeAttribute(`${SITE_ORIGIN}${path}`)
  const safeTitle = escapeAttribute(title)
  const safeDescription = escapeAttribute(description)
  const headTags = [
    `<link rel="canonical" href="${url}" />`,
    ...alternates.map(
      ({ hreflang, href }) =>
        `<link rel="alternate" hreflang="${escapeAttribute(hreflang)}" href="${escapeAttribute(href)}" />`
    ),
    // The app keeps these tags on the first view of this very page.
    `<meta name="nihongo-prerender" content="${locale}:${escapeAttribute(path)}" />`
  ].join('\n    ')
  let html = replaceOnce(
    indexHtml,
    /<title>[^<]*<\/title>/u,
    () => `<title>${safeTitle}</title>\n    ${headTags}`
  )
  html = replaceOnce(
    html,
    /<html lang="[a-z]+">/u,
    () => `<html lang="${locale}">`
  )
  html = replaceOnce(
    html,
    /<div id="root"><\/div>/u,
    (root) => `<noscript>${bodyHtml}</noscript>\n    ${root}`
  )
  html = setMetaContent(html, 'name', 'description', safeDescription)
  html = setMetaContent(html, 'property', 'og:title', safeTitle)
  html = setMetaContent(html, 'property', 'og:description', safeDescription)
  html = setMetaContent(html, 'property', 'og:locale', OG_LOCALE[locale])
  return setMetaContent(html, 'property', 'og:url', url)
}
