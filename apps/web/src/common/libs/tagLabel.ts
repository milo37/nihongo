import type { UiLocale } from '@nihongo/browser/i18n/types'

// #976: a tag may carry a Japanese name (labelJa, optional in the contract).
type TagNames = {
  readonly label: string
  readonly labelJa?: string | null
}

const japaneseName = (tag: TagNames): string | null =>
  tag.labelJa?.trim() ? tag.labelJa : null

/** The name in the screen language; no Korean name on a Japanese screen. */
export const getTagLabelInLocale = (
  tag: TagNames,
  locale: UiLocale
): string | null => (locale === 'ja' ? japaneseName(tag) : tag.label)
