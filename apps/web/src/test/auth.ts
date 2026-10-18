import { signInSocial } from '@api/auth/signInSocial'
import { completeMockSocialSignIn } from '@api/auth/completeMockSocialSignIn'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'

export const signInMockAccount = async (
  provider: SsoProviderId = 'google'
): Promise<void> => {
  await signInSocial({ provider })
  await completeMockSocialSignIn(provider)
}
