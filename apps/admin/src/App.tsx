import { RouterProvider } from 'react-router'
import type { ReactElement } from 'react'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ReactQueryProvider } from '@nihongo/browser/provider/ReactQueryProvider'
import { createAdminRouter } from '@/router'

const router = createAdminRouter()

export const AdminApp = (): ReactElement => (
  <ReactQueryProvider>
    <I18nProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </I18nProvider>
  </ReactQueryProvider>
)
