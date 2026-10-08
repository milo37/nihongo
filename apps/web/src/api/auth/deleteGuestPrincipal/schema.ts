import { z } from 'zod'

export const deleteGuestPrincipalResponseSchema = z.undefined()

export type DeleteGuestPrincipalResponse = z.output<
  typeof deleteGuestPrincipalResponseSchema
>
