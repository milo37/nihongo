import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { queryClient } from '@libs/queryClient'
import {
  APP_STORE_KEY,
  cachedSessionStorage,
  cachedStorage,
  clearStorageCache,
  MOCK_DATABASE_STORAGE_KEY,
  PRACTICE_STORE_KEY
} from '@libs/storage'
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
  cachedStorage.removeItem(APP_STORE_KEY)
  cachedStorage.removeItem(MOCK_DATABASE_STORAGE_KEY)
  cachedSessionStorage.removeItem(PRACTICE_STORE_KEY)
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
