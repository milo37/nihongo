import { mutationOptions } from '@tanstack/react-query'
import { importGuestResult } from '@api/study/importGuestResult'

export const guestCarryMutations = {
  importGuestResult: () =>
    mutationOptions({
      mutationKey: ['guest-result-import'] as const,
      mutationFn: () => importGuestResult(),
      // Nothing to retry by hand: a failure leaves the guest cookie, so the
      // next sign-in moves it. The hook shows one light line instead.
      meta: { localErrorUi: true }
    })
} as const
