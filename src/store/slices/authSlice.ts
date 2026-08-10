import type { StateCreator } from 'zustand'
import type { User } from '@common/types/domain'

export interface AuthSlice {
  currentUser: User | null
  setCurrentUser: (user: User | null) => void
  continueAsGuest: () => void
}

export const createAuthSlice: StateCreator<AuthSlice, [], [], AuthSlice> = (
  set
) => ({
  currentUser: null,
  setCurrentUser: (user) => {
    set({ currentUser: user })
  },
  continueAsGuest: () => {
    set({ currentUser: null })
  }
})
