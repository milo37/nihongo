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
// Route styles ride in the main stylesheet: the bundle contract takes no CSS
// file for a lazy route, and the CSP (style-src 'self') blocks inline <style>.
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
