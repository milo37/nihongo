import type { ReactElement } from 'react'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ReactQueryProvider } from '@nihongo/browser/provider/ReactQueryProvider'
import { ReactRouterProvider } from '@provider/ReactRouterProvider'

export const AppProvider = (): ReactElement => {
  return (
    <ReactQueryProvider>
      <I18nProvider>
        <ToastProvider>
          <ReactRouterProvider />
        </ToastProvider>
      </I18nProvider>
    </ReactQueryProvider>
  )
}
