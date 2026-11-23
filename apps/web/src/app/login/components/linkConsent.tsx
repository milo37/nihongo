import { Link } from 'react-router'
import type { ReactNode } from 'react'

const CONSENT_LINKS = {
  terms: '/legal#terms',
  privacy: '/legal#privacy'
} as const

type ConsentLinkName = keyof typeof CONSENT_LINKS

const consentLinkNames = Object.keys(CONSENT_LINKS) as ConsentLinkName[]

/**
 * Turns the <terms>…</terms> and <privacy>…</privacy> marks in the consent
 * text into links with plain string search, no regular expression, so every
 * browser reads it the same way. A mark without its end is dropped, never
 * shown. (react-i18next's Trans would add an HTML parser to the bundle.)
 */
export const linkConsent = (
  text: string,
  // #1085: the sign-up check opens them in a new tab so its boxes stay.
  newTab = false
): ReactNode[] => {
  const parts: ReactNode[] = []
  let rest = text
  while (rest) {
    const next = consentLinkNames
      .map((name) => ({ name, start: rest.indexOf(`<${name}>`) }))
      .filter(({ start }) => start >= 0)
      .sort((left, right) => left.start - right.start)[0]
    if (!next) {
      parts.push(rest)
      break
    }
    const open = `<${next.name}>`
    const close = `</${next.name}>`
    const end = rest.indexOf(close, next.start + open.length)
    if (next.start > 0) parts.push(rest.slice(0, next.start))
    const label = rest.slice(
      next.start + open.length,
      end < 0 ? undefined : end
    )
    parts.push(
      end < 0 ? (
        label
      ) : (
        <Link
          key={parts.length}
          to={CONSENT_LINKS[next.name]}
          {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}
        >
          {label}
        </Link>
      )
    )
    rest = end < 0 ? '' : rest.slice(end + close.length)
  }
  return parts
}
