import type { ReactElement } from 'react'
import { ToastProvider } from '@common/components/Toast'
import { ReactQueryProvider } from '@provider/ReactQueryProvider'
import { ReactRouterProvider } from '@provider/ReactRouterProvider'

export const AppProvider = (): ReactElement => {
  return (
    <ReactQueryProvider>
      <ToastProvider>
        <ReactRouterProvider />
      </ToastProvider>
    </ReactQueryProvider>
  )
}
