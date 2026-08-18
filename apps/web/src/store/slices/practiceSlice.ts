import type { StateCreator } from 'zustand'
import type { StudyDraftSnapshot } from '@nihongo/contracts/study/study-draft'
import type { StudyDraftConflict } from '@app/practice/draft/studyDraftMerge'
import type { StudyDraftWorkingCopy } from '@app/practice/draft/studyDraftWorkingCopy'

export type StudyDraftSaveState =
  | 'idle'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'conflict'
  | 'error'

export interface PracticeDraftConflictState {
  conflicts: StudyDraftConflict[]
  localPreferred: StudyDraftSnapshot
  remote: StudyDraftSnapshot
}

export interface PracticeSlice {
  sessionId: string | null
  currentQuestionIndex: number
  selectedAnswers: Record<string, string>
  startedAt: string | null
  pendingBookmarkIds: Record<string, boolean>
  draftWorkingCopy: StudyDraftWorkingCopy | null
  draftSaveState: StudyDraftSaveState
  draftConflict: PracticeDraftConflictState | null
  isDraftConflictPending: boolean
  beginPractice: (sessionId: string, startedAt: string) => void
  selectAnswer: (questionId: string, optionId: string) => void
  setCurrentQuestionIndex: (index: number) => void
  setPendingBookmark: (questionId: string, isBookmarked: boolean) => void
  setDraftWorkingCopy: (workingCopy: StudyDraftWorkingCopy | null) => void
  setDraftSaveState: (state: StudyDraftSaveState) => void
  setDraftConflict: (conflict: PracticeDraftConflictState | null) => void
  setDraftConflictPending: (pending: boolean) => void
  resetPractice: () => void
}

const initialPracticeState = {
  sessionId: null,
  currentQuestionIndex: 0,
  selectedAnswers: {},
  startedAt: null,
  pendingBookmarkIds: {},
  draftWorkingCopy: null,
  draftSaveState: 'idle',
  draftConflict: null,
  isDraftConflictPending: false
} satisfies Pick<
  PracticeSlice,
  | 'sessionId'
  | 'currentQuestionIndex'
  | 'selectedAnswers'
  | 'startedAt'
  | 'pendingBookmarkIds'
  | 'draftWorkingCopy'
  | 'draftSaveState'
  | 'draftConflict'
  | 'isDraftConflictPending'
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
      pendingBookmarkIds: {},
      draftWorkingCopy: null,
      draftSaveState: 'idle',
      draftConflict: null,
      isDraftConflictPending: false
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
  setDraftWorkingCopy: (draftWorkingCopy) => {
    set({ draftWorkingCopy })
  },
  setDraftSaveState: (draftSaveState) => {
    set({ draftSaveState })
  },
  setDraftConflict: (draftConflict) => {
    set({ draftConflict })
  },
  setDraftConflictPending: (isDraftConflictPending) => {
    set({ isDraftConflictPending })
  },
  resetPractice: () => {
    set(initialPracticeState)
  }
})
