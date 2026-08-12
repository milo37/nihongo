import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { User } from '@common/types/domain'
import { LEVELS, USER_ROLES } from '@common/types/domain'
import { APP_STORE_KEY, splitAppStateStorage } from '@libs/storage'
import { createAuthSlice, type AuthSlice } from '@store/slices/authSlice'
import {
  createPracticeSlice,
  type PracticeSlice
} from '@store/slices/practiceSlice'
import { createUiSlice, type UiSlice } from '@store/slices/uiSlice'

export type AppStore = AuthSlice & PracticeSlice & UiSlice

const LEVEL_SET: ReadonlySet<string> = new Set(LEVELS)
const ROLE_SET: ReadonlySet<string> = new Set(USER_ROLES)

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isStringRecord = (value: unknown): value is Record<string, string> => {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  )
}

const isBooleanRecord = (value: unknown): value is Record<string, boolean> => {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'boolean')
  )
}

const isPersistedUser = (value: unknown): value is User => {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.role === 'string' &&
    ROLE_SET.has(value.role) &&
    typeof value.targetLevel === 'string' &&
    LEVEL_SET.has(value.targetLevel) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  )
}

const sanitizePersistedState = (
  value: unknown,
  includePractice: boolean
): Partial<AppStore> => {
  if (!isRecord(value)) {
    return {}
  }

  const sanitized: Partial<AppStore> = {
    currentUser: isPersistedUser(value.currentUser) ? value.currentUser : null
  }

  if (!includePractice) {
    return sanitized
  }

  if (typeof value.sessionId === 'string' || value.sessionId === null) {
    sanitized.sessionId = value.sessionId
  }
  if (
    typeof value.currentQuestionIndex === 'number' &&
    Number.isInteger(value.currentQuestionIndex) &&
    value.currentQuestionIndex >= 0
  ) {
    sanitized.currentQuestionIndex = value.currentQuestionIndex
  }
  if (isStringRecord(value.selectedAnswers)) {
    sanitized.selectedAnswers = value.selectedAnswers
  }
  if (typeof value.startedAt === 'string' || value.startedAt === null) {
    sanitized.startedAt = value.startedAt
  }
  if (isBooleanRecord(value.pendingBookmarkIds)) {
    sanitized.pendingBookmarkIds = value.pendingBookmarkIds
  }

  return sanitized
}

export const useAppStore = create<AppStore>()(
  persist(
    (...args) => ({
      ...createAuthSlice(...args),
      ...createPracticeSlice(...args),
      ...createUiSlice(...args)
    }),
    {
      name: APP_STORE_KEY,
      version: 2,
      storage: createJSONStorage(() => splitAppStateStorage),
      migrate: (persistedState, version) =>
        sanitizePersistedState(persistedState, version >= 2),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizePersistedState(persistedState, true)
      }),
      partialize: (state) => ({
        currentUser: state.currentUser,
        sessionId: state.sessionId,
        currentQuestionIndex: state.currentQuestionIndex,
        selectedAnswers: state.selectedAnswers,
        startedAt: state.startedAt,
        pendingBookmarkIds: state.pendingBookmarkIds
      })
    }
  )
)
