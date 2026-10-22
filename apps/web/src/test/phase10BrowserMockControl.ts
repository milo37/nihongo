import { getCurrentPrincipalResponseSchema } from '@nihongo/contracts/auth/get-current-principal'
import { worker } from '@mocks/browser'
import { resetMockSocialSignInForTesting } from '@mocks/handlers/authHandlers'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { queryClient } from '@libs/queryClient'

const assertMockTestMode = (): void => {
  if (__NIHONGO_API_MODE__ !== 'mock' || import.meta.env.MODE !== 'test') {
    throw new Error('Phase 10 Mock control requires Mock test mode.')
  }
}

export const resetPhase10MockState = async (): Promise<void> => {
  assertMockTestMode()
  await queryClient.cancelQueries()
  worker.resetHandlers()
  resetMockSocialSignInForTesting()
  mockDatabase.reset()
  queryClient.clear()
}

export const completePhase10MockGoogleCallback = async (): Promise<void> => {
  assertMockTestMode()
  const response = await fetch('/api/_mock/auth/social/callback', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'google' })
  })
  if (!response.ok) throw new Error('Mock Google callback was not accepted.')
  const principal = getCurrentPrincipalResponseSchema.parse(
    await response.json()
  )
  if (principal.kind !== 'USER' || principal.user.role !== 'USER') {
    throw new Error('Mock Google callback did not confirm a USER.')
  }
}
