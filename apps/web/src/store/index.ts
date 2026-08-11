import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { cachedStorage } from '@libs/storage'
import { createAuthSlice, type AuthSlice } from '@store/slices/authSlice'
import {
  createPracticeSlice,
  type PracticeSlice
} from '@store/slices/practiceSlice'
import { createUiSlice, type UiSlice } from '@store/slices/uiSlice'

export type AppStore = AuthSlice & PracticeSlice & UiSlice

export const useAppStore = create<AppStore>()(
  persist(
    (...args) => ({
      ...createAuthSlice(...args),
      ...createPracticeSlice(...args),
      ...createUiSlice(...args)
    }),
    {
      name: 'jlpt-drill-note-store',
      version: 1,
      storage: createJSONStorage(() => cachedStorage),
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
