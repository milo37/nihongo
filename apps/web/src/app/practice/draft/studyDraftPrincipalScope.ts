import type { AuthenticatedUser } from '@nihongo/contracts/auth/get-current-principal'

export const getStudyDraftPrincipalScope = (
  user: AuthenticatedUser | null
): string => (user ? `${user.role}:${user.id}` : 'GUEST')
