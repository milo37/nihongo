import type { StateCreator } from 'zustand'
import type { AuthenticatedUser } from '@nihongo/contracts/auth/get-current-principal'

export interface AuthSlice {
  currentUser: AuthenticatedUser | null
  setCurrentUser: (user: AuthenticatedUser | null) => void
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
