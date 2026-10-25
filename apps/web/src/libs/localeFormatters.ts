import type { UiLocale } from '@/i18n/types'
import { INTL_LOCALE_BY_UI_LOCALE } from '@/i18n/types'

type FormatterOptions = Record<string, boolean | number | string | undefined>

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()
const numberFormatters = new Map<string, Intl.NumberFormat>()
const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>()

const getOptionsKey = (options: FormatterOptions): string => {
  return JSON.stringify(
    Object.entries(options)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
  )
}

const getDateTimeFormatter = (
  locale: UiLocale,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat => {
  const key = `${locale}:${getOptionsKey(options as FormatterOptions)}`
  const cached = dateTimeFormatters.get(key)
  if (cached) {
    return cached
  }

  const formatter = new Intl.DateTimeFormat(
    INTL_LOCALE_BY_UI_LOCALE[locale],
    options
  )
  dateTimeFormatters.set(key, formatter)
  return formatter
}

const getNumberFormatter = (
  locale: UiLocale,
  options: Intl.NumberFormatOptions
): Intl.NumberFormat => {
  const key = `${locale}:${getOptionsKey(options as FormatterOptions)}`
  const cached = numberFormatters.get(key)
  if (cached) {
    return cached
  }

  const formatter = new Intl.NumberFormat(
    INTL_LOCALE_BY_UI_LOCALE[locale],
    options
  )
  numberFormatters.set(key, formatter)
  return formatter
}

const getRelativeTimeFormatter = (
  locale: UiLocale,
  options: Intl.RelativeTimeFormatOptions
): Intl.RelativeTimeFormat => {
  const key = `${locale}:${getOptionsKey(options as FormatterOptions)}`
  const cached = relativeTimeFormatters.get(key)
  if (cached) {
    return cached
  }

  const formatter = new Intl.RelativeTimeFormat(
    INTL_LOCALE_BY_UI_LOCALE[locale],
    options
  )
  relativeTimeFormatters.set(key, formatter)
  return formatter
}

export const formatDateTime = (
  value: Date | number | string,
  locale: UiLocale,
  options: Intl.DateTimeFormatOptions = {}
): string => {
  const date = value instanceof Date ? value : new Date(value)
  return getDateTimeFormatter(locale, options).format(date)
}

export const formatDateTimeToParts = (
  value: Date | number | string,
  locale: UiLocale,
  options: Intl.DateTimeFormatOptions = {}
): Intl.DateTimeFormatPart[] => {
  const date = value instanceof Date ? value : new Date(value)
  return getDateTimeFormatter(locale, options).formatToParts(date)
}

export const formatNumber = (
  value: number,
  locale: UiLocale,
  options: Intl.NumberFormatOptions = {}
): string => getNumberFormatter(locale, options).format(value)

export const formatRelativeTime = (
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  locale: UiLocale,
  options: Intl.RelativeTimeFormatOptions = {}
): string => getRelativeTimeFormatter(locale, options).format(value, unit)
