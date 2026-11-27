import type { StateCreator } from 'zustand'
import type { StudyDraftWorkingCopy } from '../../app/practice/draft/studyDraftWorkingCopy'

export type StudyDraftSaveState =
  'idle' | 'dirty' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error'

export interface PracticeSlice {
  sessionId: string | null
  currentQuestionIndex: number
  selectedAnswers: Record<string, string>
  startedAt: string | null
  draftWorkingCopy: StudyDraftWorkingCopy | null
  draftSaveState: StudyDraftSaveState
  isDraftConflictPending: boolean
  beginPractice: (sessionId: string, startedAt: string) => void
  selectAnswer: (questionId: string, optionId: string) => void
  setCurrentQuestionIndex: (index: number) => void
  setDraftWorkingCopy: (workingCopy: StudyDraftWorkingCopy | null) => void
  setDraftSaveState: (state: StudyDraftSaveState) => void
  setDraftConflictPending: (pending: boolean) => void
  resetPractice: () => void
}

const initialPracticeState = {
  sessionId: null,
  currentQuestionIndex: 0,
  selectedAnswers: {},
  startedAt: null,
  draftWorkingCopy: null,
  draftSaveState: 'idle',
  isDraftConflictPending: false
} satisfies Pick<
  PracticeSlice,
  | 'sessionId'
  | 'currentQuestionIndex'
  | 'selectedAnswers'
  | 'startedAt'
  | 'draftWorkingCopy'
  | 'draftSaveState'
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
      draftWorkingCopy: null,
      draftSaveState: 'idle',
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
  setDraftWorkingCopy: (draftWorkingCopy) => {
    set({ draftWorkingCopy })
  },
  setDraftSaveState: (draftSaveState) => {
    set({ draftSaveState })
  },
  setDraftConflictPending: (isDraftConflictPending) => {
    set({ isDraftConflictPending })
  },
  resetPractice: () => {
    set(initialPracticeState)
  }
})
