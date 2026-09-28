import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { i18nResources } from '@/i18n/resources'
import { DEFAULT_UI_LOCALE, UI_LOCALES } from '@/i18n/types'
import { readUiLocalePreference } from '@libs/localeStorage'

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
