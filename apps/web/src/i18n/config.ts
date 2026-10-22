import type { LocaleCatalog } from '@/i18n/resources/ja'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_UI_LOCALE, UI_LOCALES } from '@/i18n/types'
import { readUiLocalePreference } from '@libs/localeStorage'

// Both resources are ready before first render, including immediate offline switching.
const [{ koResources }, { jaCoreResources }, { jaAdminResources }] =
  await Promise.all([
    import('@/i18n/resources/ko'),
    import('@/i18n/resources/ja'),
    import('@/i18n/resources/ja-admin')
  ])
const { errors, a11y, ...jaNamespaces } = jaCoreResources
const jaResources = {
  ...jaNamespaces,
  admin: jaAdminResources,
  errors,
  a11y
} as const satisfies LocaleCatalog<typeof koResources>
const i18nResources = { ko: koResources, ja: jaResources }
const initialLocale = readUiLocalePreference()

void i18n.use(initReactI18next).init({
  resources: i18nResources,
  lng: initialLocale,
  fallbackLng: DEFAULT_UI_LOCALE,
  supportedLngs: UI_LOCALES,
  load: 'languageOnly',
  nonExplicitSupportedLngs: false,
  defaultNS: 'common',
  ns: Object.keys(i18nResources.ko),
  initAsync: false,
  returnNull: false,
  interpolation: {
    escapeValue: false
  },
  react: {
    useSuspense: false
  }
})

export const appI18n = i18n
