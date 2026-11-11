import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { unregisterMockServiceWorker } from '@nihongo/browser/api/mockServiceWorker'
import { isMockApiMode } from '@nihongo/browser/libs/apiMode'
import {
  frontendErrorReporter,
  installGlobalFrontendErrorReporting
} from '@nihongo/browser/observability/frontendErrorReporter'
import { getRouteLabelKey } from '@nihongo/browser/i18n/routePresentation'
import { AppProvider } from '@provider/index'
import '@/styles.css'
// Shared by several lazy routes, so they ride in the main stylesheet: a CSS
// file of its own for a shared chunk is not allowed by the bundle contract,
// and inline <style> is blocked by the CSP (style-src 'self').
import '@app/home/home.css'
import '@common/components/manuscript/manuscript.css'
import '@app/practice/setup.css'
import '@app/practice/session/session.css'
import '@app/practice/result/result.css'

const rootElement = document.getElementById('root')

installGlobalFrontendErrorReporting(frontendErrorReporter, () =>
  getRouteLabelKey(window.location.pathname)
)

if (!rootElement) {
  throw new Error('Root element was not found')
}

const startApplication = async (): Promise<void> => {
  if (__NIHONGO_PRODUCTION_BUILD__ || !isMockApiMode) {
    await unregisterMockServiceWorker()
  } else {
    const { enableMocking } = await import('@mocks/service')
    await enableMocking()
  }

  createRoot(rootElement).render(
    <StrictMode>
      <AppProvider />
    </StrictMode>
  )
}

void startApplication()
