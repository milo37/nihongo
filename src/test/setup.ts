import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { queryClient } from '@libs/queryClient'
import { clearStorageCache } from '@libs/storage'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

const resetTestState = (): void => {
  queryClient.clear()
  mockDatabase.reset()
  useAppStore.setState({
    currentUser: null,
    sessionId: null,
    currentQuestionIndex: 0,
    selectedAnswers: {},
    startedAt: null,
    pendingBookmarkIds: {},
    isMobileMenuOpen: false
  })
  window.localStorage.clear()
  clearStorageCache()
}

beforeAll(() => {
  mockServer.listen({ onUnhandledRequest: 'error' })
})

beforeEach(() => {
  resetTestState()
})

afterEach(() => {
  cleanup()
  mockServer.resetHandlers()
  resetTestState()
})

afterAll(() => {
  mockServer.close()
})
