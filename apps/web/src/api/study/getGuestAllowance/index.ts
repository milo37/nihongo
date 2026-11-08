import { safeGet } from '@nihongo/browser/api/http'
import { getGuestAllowanceResponseSchema } from '@api/study/getGuestAllowance/schema'
import type { GetGuestAllowanceResponse } from '@api/study/getGuestAllowance/schema'

const requestGuestAllowance = safeGet(getGuestAllowanceResponseSchema)

export const getGuestAllowance = (
  signal?: AbortSignal
): Promise<GetGuestAllowanceResponse> =>
  requestGuestAllowance('/v1/guest-allowance', null, { signal })
