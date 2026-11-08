import { queryOptions } from '@tanstack/react-query'
import { getGuestAllowance } from '@api/study/getGuestAllowance'
import type { GetGuestAllowanceResponse } from '@nihongo/contracts/study/get-guest-allowance'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'

export const guestAllowanceQueries = {
  // Changes only when this guest starts a session (or the day turns), so
  // callers refetch after creating one or after GUEST_LIMIT_REACHED.
  get: () =>
    queryOptions({
      queryKey: serverStateQueryKeys.study.guestAllowance(),
      queryFn: ({ signal }) => getGuestAllowance(signal),
      staleTime: 60_000,
      meta: { localErrorUi: true }
    })
} as const

export type GuestAllowance = Extract<
  GetGuestAllowanceResponse,
  { kind: 'GUEST' }
>

export const asGuestAllowance = (
  allowance: GetGuestAllowanceResponse | undefined
): GuestAllowance | null =>
  allowance && allowance.kind === 'GUEST' ? (allowance as GuestAllowance) : null
