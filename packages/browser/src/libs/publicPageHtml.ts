// #981: crawlers that do not run JavaScript (Naver) read each public page's
// own title, description and share text from a copy of the built index.html.
// The API static server answers /practice with practice/index.html, so the
// copies need no server or deploy change. The body and scripts stay the same.

export const SITE_ORIGIN = 'https://harumaru.app'

export type PublicPageHead = {
  readonly path: string
  readonly title: string
  readonly description: string
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

export const renderPublicPageHtml = (
  indexHtml: string,
  { path, title, description }: PublicPageHead
): string => {
  const url = escapeAttribute(`${SITE_ORIGIN}${path}`)
  const safeTitle = escapeAttribute(title)
  const safeDescription = escapeAttribute(description)
  let html = replaceOnce(
    indexHtml,
    /<title>[^<]*<\/title>/u,
    () =>
      `<title>${safeTitle}</title>\n    <link rel="canonical" href="${url}" />`
  )
  html = setMetaContent(html, 'name', 'description', safeDescription)
  html = setMetaContent(html, 'property', 'og:title', safeTitle)
  html = setMetaContent(html, 'property', 'og:description', safeDescription)
  return setMetaContent(html, 'property', 'og:url', url)
}
