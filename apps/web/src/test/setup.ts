import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { apiClient } from '@api/config'
import { queryClient } from '@libs/queryClient'
import { clearAllSubmissionAttempts } from '@app/practice/submissionAttemptStorage'
import { clearAllStudyDraftWorkingCopies } from '@app/practice/draft/studyDraftWorkingCopyStorage'
import { closeAllStudyDraftRevisionChannels } from '@app/practice/draft/useStudyDraftRevisionSync'
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
import { clearMockGuestPrincipalCookie, mockServer } from '@/test/server'

const resetTestState = async (): Promise<void> => {
  await clearMockGuestPrincipalCookie()
  clearAllSubmissionAttempts()
  clearAllStudyDraftWorkingCopies()
  closeAllStudyDraftRevisionChannels()
  queryClient.clear()
  mockDatabase.reset()
  useAppStore.setState({
    currentUser: null,
    sessionId: null,
    currentQuestionIndex: 0,
    selectedAnswers: {},
    startedAt: null,
    pendingBookmarkIds: {},
    draftWorkingCopy: null,
    draftSaveState: 'idle',
    draftConflict: null,
    isDraftConflictPending: false,
    isMobileMenuOpen: false
  })
  cachedStorage.removeItem(APP_STORE_KEY)
  cachedStorage.removeItem(MOCK_DATABASE_STORAGE_KEY)
  cachedSessionStorage.removeItem(PRACTICE_STORE_KEY)
  clearStorageCache()
}

let browserOriginInterceptorId: number | undefined

beforeAll(() => {
  browserOriginInterceptorId = apiClient.interceptors.request.use((config) => {
    if (['delete', 'patch', 'post', 'put'].includes(config.method ?? '')) {
      config.headers.set('Origin', window.location.origin)
    }
    return config
  })
  mockServer.listen({ onUnhandledRequest: 'error' })
})

beforeEach(async () => {
  await resetTestState()
})

afterEach(async () => {
  cleanup()
  mockServer.resetHandlers()
  await resetTestState()
})

afterAll(() => {
  if (browserOriginInterceptorId !== undefined) {
    apiClient.interceptors.request.eject(browserOriginInterceptorId)
  }
  mockServer.close()
})
