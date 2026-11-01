import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { apiClient } from '@nihongo/browser/api/config'
import { appI18n } from '@nihongo/browser/i18n/config'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { clearAllSubmissionAttempts } from '@nihongo/browser/app/practice/submissionAttemptStorage'
import { clearAllResultRetryAttempts } from '@nihongo/browser/app/practice/resultRetryAttemptStorage'
import { clearAllStudyDraftWorkingCopies } from '@nihongo/browser/app/practice/draft/studyDraftWorkingCopyStorage'
import { closeAllStudyDraftRevisionChannels } from '@nihongo/browser/app/practice/draft/useStudyDraftRevisionSync'
import { clearAllTargetedReviewAttempts } from '@nihongo/browser/app/wrong-note/targetedReviewAttemptStorage'
import {
  APP_STORE_KEY,
  cachedSessionStorage,
  cachedStorage,
  clearStorageCache,
  MOCK_DATABASE_STORAGE_KEY,
  ADMIN_CMS_STORAGE_KEY,
  QUESTION_REPORT_RATE_LIMIT_STORAGE_KEY,
  PRACTICE_STORE_KEY
} from '@nihongo/browser/libs/storage'
import { UI_LOCALE_STORAGE_KEY } from '@nihongo/browser/libs/localeStorage'
import { resetMockSocialSignInForTesting } from '@mocks/handlers/authHandlers'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { resetAdminCmsCommandRateLimitForTesting } from '@mocks/handlers/adminCmsCommandHandlers'
import { resetDashboardInsightsRateLimitForTesting } from '@mocks/handlers/dashboardInsightsV1Handlers'
import { resetQuestionReadRateLimitForTesting } from '@mocks/handlers/questionHandlers'
import { useAppStore } from '@nihongo/browser/store/index'
import { clearMockGuestPrincipalCookie, mockServer } from '@/test/server'

const resetTestState = async (): Promise<void> => {
  await clearMockGuestPrincipalCookie()
  clearAllSubmissionAttempts()
  clearAllResultRetryAttempts()
  clearAllTargetedReviewAttempts()
  clearAllStudyDraftWorkingCopies()
  closeAllStudyDraftRevisionChannels()
  queryClient.clear()
  resetAdminCmsCommandRateLimitForTesting()
  resetDashboardInsightsRateLimitForTesting()
  resetQuestionReadRateLimitForTesting()
  resetMockSocialSignInForTesting()
  mockDatabase.reset()
  useAppStore.setState({
    currentUser: null,
    sessionId: null,
    currentQuestionIndex: 0,
    selectedAnswers: {},
    startedAt: null,
    draftWorkingCopy: null,
    draftSaveState: 'idle',
    draftConflict: null,
    isDraftConflictPending: false,
    isMobileMenuOpen: false
  })
  cachedStorage.removeItem(APP_STORE_KEY)
  cachedStorage.removeItem(MOCK_DATABASE_STORAGE_KEY)
  cachedStorage.removeItem(ADMIN_CMS_STORAGE_KEY)
  cachedStorage.removeItem(QUESTION_REPORT_RATE_LIMIT_STORAGE_KEY)
  cachedStorage.removeItem(UI_LOCALE_STORAGE_KEY)
  cachedSessionStorage.removeItem(PRACTICE_STORE_KEY)
  clearStorageCache()
  await appI18n.changeLanguage('ko')
  document.documentElement.lang = 'ko'
  document.title = 'JLPT Drill Note'
  const description = document.querySelector<HTMLMetaElement>(
    'meta[name="description"]'
  )
  if (description) {
    description.content =
      'JLPT N5부터 N1까지 문제를 풀고 오답을 반복 학습하는 JLPT Drill Note'
  }
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
