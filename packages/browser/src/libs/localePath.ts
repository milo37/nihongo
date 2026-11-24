import type { UiLocale } from '../i18n/types'

// #1268: the Japanese copy of a public page lives under /ja (/ja,
// /ja/practice, /ja/legal, /ja/support). It is the same screen: the prefix
// only names the language of the first visit.
const JA_PREFIX = /^\/ja(?=\/|$)/u

/** The path without the /ja prefix, so route labels and tabs match as usual. */
export const stripLocalePrefix = (pathname: string): string =>
  pathname.replace(JA_PREFIX, '') || '/'

/** The language a /ja address asks for; null for every other address. */
export const readPathLocale = (pathname: string): UiLocale | null =>
  JA_PREFIX.test(pathname) ? 'ja' : null
