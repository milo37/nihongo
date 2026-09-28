export const UI_LOCALES = ['ko', 'ja'] as const

export type UiLocale = (typeof UI_LOCALES)[number]

export const DEFAULT_UI_LOCALE: UiLocale = 'ko'

export const INTL_LOCALE_BY_UI_LOCALE: Record<UiLocale, string> = {
  ko: 'ko-KR',
  ja: 'ja-JP'
}

export const isUiLocale = (value: unknown): value is UiLocale => {
  return typeof value === 'string' && UI_LOCALES.includes(value as UiLocale)
}
