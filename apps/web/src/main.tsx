import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { unregisterMockServiceWorker } from '@api/mockServiceWorker'
import { isMockApiMode } from '@libs/apiMode'
import { AppProvider } from '@provider/index'
import '@/styles.css'

const rootElement = document.getElementById('root')

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
