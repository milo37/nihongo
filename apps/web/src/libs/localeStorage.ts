import type { UiLocale } from '@/i18n/types'
import { DEFAULT_UI_LOCALE, isUiLocale } from '@/i18n/types'
import { cachedStorage, readFreshLocalStorageItem } from '@libs/storage'

export const UI_LOCALE_STORAGE_KEY = 'jlpt-drill-note:ui-locale:v1'
export const UI_LOCALE_STORAGE_VERSION = 1

interface UiLocalePreference {
  version: typeof UI_LOCALE_STORAGE_VERSION
  locale: UiLocale
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const parseUiLocalePreference = (
  serialized: string | null
): UiLocale => {
  if (!serialized) {
    return DEFAULT_UI_LOCALE
  }

  try {
    const parsed: unknown = JSON.parse(serialized)
    if (!isRecord(parsed)) {
      return DEFAULT_UI_LOCALE
    }

    const keys = Object.keys(parsed).sort()
    if (
      keys.length !== 2 ||
      keys[0] !== 'locale' ||
      keys[1] !== 'version' ||
      parsed.version !== UI_LOCALE_STORAGE_VERSION ||
      !isUiLocale(parsed.locale)
    ) {
      return DEFAULT_UI_LOCALE
    }

    return parsed.locale
  } catch {
    return DEFAULT_UI_LOCALE
  }
}

export const readUiLocalePreference = (): UiLocale => {
  try {
    return parseUiLocalePreference(cachedStorage.getItem(UI_LOCALE_STORAGE_KEY))
  } catch {
    return DEFAULT_UI_LOCALE
  }
}

export const readFreshUiLocalePreference = (): UiLocale => {
  try {
    return parseUiLocalePreference(
      readFreshLocalStorageItem(UI_LOCALE_STORAGE_KEY)
    )
  } catch {
    return DEFAULT_UI_LOCALE
  }
}

export const writeUiLocalePreference = (locale: UiLocale): boolean => {
  const preference: UiLocalePreference = {
    version: UI_LOCALE_STORAGE_VERSION,
    locale
  }

  try {
    return cachedStorage.setItem(
      UI_LOCALE_STORAGE_KEY,
      JSON.stringify(preference)
    )
  } catch {
    return false
  }
}
