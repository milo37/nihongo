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
import { registerHomeScreenWorker } from '@common/libs/homeScreenWorker'
// The first stylesheet. Screens the first load does not need import
// styles/screens.css themselves (#1346); both are files, since the CSP
// (style-src 'self') blocks inline <style>.
import '@/styles/index.css'

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
  registerHomeScreenWorker()
}

void startApplication()
