import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { unregisterMockServiceWorker } from '@nihongo/browser/api/mockServiceWorker'
import {
  frontendErrorReporter,
  installGlobalFrontendErrorReporting
} from '@nihongo/browser/observability/frontendErrorReporter'
import { getRouteLabelKey } from '@nihongo/browser/i18n/routePresentation'
import { AdminApp } from '@/App'
import '@nihongo/browser/styles.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element was not found')
installGlobalFrontendErrorReporting(frontendErrorReporter, () =>
  getRouteLabelKey(window.location.pathname)
)

const startApplication = async (): Promise<void> => {
  await unregisterMockServiceWorker()
  createRoot(rootElement).render(
    <StrictMode>
      <AdminApp />
    </StrictMode>
  )
}
void startApplication()
