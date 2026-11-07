import { z } from 'zod'

export const deleteGuestPrincipalErrorCodeSchema = z.enum([
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])
