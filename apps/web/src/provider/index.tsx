import type { ReactElement } from 'react'
import { ToastProvider } from '@common/components/Toast'
import { I18nProvider } from '@provider/I18nProvider'
import { ReactQueryProvider } from '@provider/ReactQueryProvider'
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
