import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState
} from 'react'
import { I18nextProvider } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { appI18n } from '../i18n/config'
import type { UiLocale } from '../i18n/types'
import { DEFAULT_UI_LOCALE } from '../i18n/types'
import {
  parseUiLocalePreference,
  readFreshUiLocalePreference,
  readUiLocalePreference,
  UI_LOCALE_STORAGE_KEY,
  writeUiLocalePreference
} from '../libs/localeStorage'
import { subscribeStorageChanges } from '../libs/storage'

interface I18nContextValue {
  locale: UiLocale
  setLocale: (locale: UiLocale) => void
}

type I18nProviderProps = {
  children: ReactNode
  /** Shows this language whatever the browser saved, and ignores changes. */
  fixedLocale?: UiLocale
}

const I18nContext = createContext<I18nContextValue | null>(null)

export const I18nProvider = ({
  children,
  fixedLocale
}: I18nProviderProps): ReactElement => {
  const [locale, setLocaleState] = useState<UiLocale>(() => {
    const initialLocale = fixedLocale ?? readUiLocalePreference()
    // i18n starts on the saved language; switch before the first render.
    if (appI18n.resolvedLanguage !== initialLocale) {
      void appI18n.changeLanguage(initialLocale)
    }
    return initialLocale
  })

  const applyLocale = (nextLocale: UiLocale): void => {
    setLocaleState(nextLocale)
    if (appI18n.resolvedLanguage !== nextLocale) {
      void appI18n.changeLanguage(nextLocale)
    }
  }

  const setLocale = (nextLocale: UiLocale): void => {
    if (fixedLocale || nextLocale === locale) {
      return
    }

    if (!writeUiLocalePreference(nextLocale)) {
      applyLocale(DEFAULT_UI_LOCALE)
      return
    }

    applyLocale(nextLocale)
  }

  useLayoutEffect(() => {
    document.documentElement.lang = locale
    if (appI18n.resolvedLanguage !== locale) {
      void appI18n.changeLanguage(locale)
    }
  }, [locale])

  useEffect(() => {
    if (fixedLocale) {
      return
    }

    return subscribeStorageChanges((event) => {
      if (event.key !== null && event.key !== UI_LOCALE_STORAGE_KEY) {
        return
      }

      const nextLocale =
        event.key === UI_LOCALE_STORAGE_KEY
          ? parseUiLocalePreference(event.newValue)
          : readFreshUiLocalePreference()
      applyLocale(nextLocale)
    })
  }, [fixedLocale])

  return (
    <I18nContext.Provider value={{ locale, setLocale }}>
      <I18nextProvider i18n={appI18n}>{children}</I18nextProvider>
    </I18nContext.Provider>
  )
}

export const useUiLocale = (): I18nContextValue => {
  const context = useContext(I18nContext)

  if (!context) {
    throw new Error('useUiLocale must be used inside I18nProvider')
  }

  return context
}
