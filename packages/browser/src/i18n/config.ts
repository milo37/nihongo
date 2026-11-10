import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_UI_LOCALE, UI_LOCALES } from './types'
import { readUiLocalePreference } from '../libs/localeStorage'

// Both locales are ready before first render, including immediate offline
// switching. The admin namespace starts with only what the learner app shows
// (report dialogs, API errors, re-verification); the admin app adds the rest
// with loadAdminResources() before it renders (JLP-758).
const [
  { koCoreResources },
  { jaCoreResources },
  { koAdminLearnerResources },
  { jaAdminLearnerResources }
] = await Promise.all([
  import('./resources/ko'),
  import('./resources/ja'),
  import('./resources/ko-admin-learner'),
  import('./resources/ja-admin-learner')
])
const { errors: koErrors, a11y: koA11y, ...koNamespaces } = koCoreResources
const { errors: jaErrors, a11y: jaA11y, ...jaNamespaces } = jaCoreResources
const i18nResources = {
  ko: {
    ...koNamespaces,
    admin: koAdminLearnerResources,
    errors: koErrors,
    a11y: koA11y
  },
  ja: {
    ...jaNamespaces,
    admin: jaAdminLearnerResources,
    errors: jaErrors,
    a11y: jaA11y
  }
}
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

/** Adds the whole admin copy in both locales; the admin app awaits it once. */
export const loadAdminResources = async (): Promise<void> => {
  const [{ koAdminResources }, { jaAdminResources }] = await Promise.all([
    import('./resources/ko-admin'),
    import('./resources/ja-admin')
  ])
  i18n.addResourceBundle('ko', 'admin', koAdminResources, true, true)
  i18n.addResourceBundle('ja', 'admin', jaAdminResources, true, true)
}

export const appI18n = i18n
