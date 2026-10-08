import { deleteGuestPrincipalResponseSchema } from '@api/auth/deleteGuestPrincipal/schema'
import type { DeleteGuestPrincipalResponse } from '@api/auth/deleteGuestPrincipal/schema'
import { safeDel } from '@api/http'

const requestGuestPrincipalDeletion = safeDel(
  deleteGuestPrincipalResponseSchema
)

export const deleteGuestPrincipal = (): Promise<DeleteGuestPrincipalResponse> =>
  requestGuestPrincipalDeletion('/v1/guest-principal')
