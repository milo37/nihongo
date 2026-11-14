import type { ReactElement } from 'react'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { DEFAULT_UI_LOCALE } from '@nihongo/browser/i18n/types'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ReactQueryProvider } from '@nihongo/browser/provider/ReactQueryProvider'
import { ReactRouterProvider } from '@provider/ReactRouterProvider'
import { isLanguageMenuShown } from '@common/libs/languageMenu'

export const AppProvider = (): ReactElement => {
  return (
    <ReactQueryProvider>
      <I18nProvider
        fixedLocale={isLanguageMenuShown ? undefined : DEFAULT_UI_LOCALE}
      >
        <ToastProvider>
          <ReactRouterProvider />
        </ToastProvider>
      </I18nProvider>
    </ReactQueryProvider>
  )
}
