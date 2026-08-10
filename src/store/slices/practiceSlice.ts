import type { StateCreator } from 'zustand'

export interface PracticeSlice {
  sessionId: string | null
  currentQuestionIndex: number
  selectedAnswers: Record<string, string>
  startedAt: string | null
  pendingBookmarkIds: Record<string, boolean>
  beginPractice: (sessionId: string, startedAt: string) => void
  selectAnswer: (questionId: string, optionId: string) => void
  setCurrentQuestionIndex: (index: number) => void
  setPendingBookmark: (questionId: string, isBookmarked: boolean) => void
  resetPractice: () => void
}

const initialPracticeState = {
  sessionId: null,
  currentQuestionIndex: 0,
  selectedAnswers: {},
  startedAt: null,
  pendingBookmarkIds: {}
} satisfies Pick<
  PracticeSlice,
  | 'sessionId'
  | 'currentQuestionIndex'
  | 'selectedAnswers'
  | 'startedAt'
  | 'pendingBookmarkIds'
>

export const createPracticeSlice: StateCreator<
  PracticeSlice,
  [],
  [],
  PracticeSlice
> = (set) => ({
  ...initialPracticeState,
  beginPractice: (sessionId, startedAt) => {
    set({
      sessionId,
      startedAt,
      currentQuestionIndex: 0,
      selectedAnswers: {},
      pendingBookmarkIds: {}
    })
  },
  selectAnswer: (questionId, optionId) => {
    set((state) => ({
      selectedAnswers: {
        ...state.selectedAnswers,
        [questionId]: optionId
      }
    }))
  },
  setCurrentQuestionIndex: (index) => {
    set({ currentQuestionIndex: Math.max(0, index) })
  },
  setPendingBookmark: (questionId, isBookmarked) => {
    set((state) => ({
      pendingBookmarkIds: {
        ...state.pendingBookmarkIds,
        [questionId]: isBookmarked
      }
    }))
  },
  resetPractice: () => {
    set(initialPracticeState)
  }
})
