import type { StateCreator } from 'zustand'

export interface UiSlice {
  isMobileMenuOpen: boolean
  setMobileMenuOpen: (isOpen: boolean) => void
  toggleMobileMenu: () => void
}

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set) => ({
  isMobileMenuOpen: false,
  setMobileMenuOpen: (isOpen) => {
    set({ isMobileMenuOpen: isOpen })
  },
  toggleMobileMenu: () => {
    set((state) => ({ isMobileMenuOpen: !state.isMobileMenuOpen }))
  }
})
