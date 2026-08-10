import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProvider } from '@provider/index'
import { enableMocking } from '@mocks/service'
import '@/styles.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element was not found')
}

const startApplication = async (): Promise<void> => {
  await enableMocking()
  createRoot(rootElement).render(
    <StrictMode>
      <AppProvider />
    </StrictMode>
  )
}

void startApplication()
