import { google } from 'better-auth/social-providers'
import { z } from 'zod'
import type { SsoProvider, SsoVerifiedIdentity } from './ssoProtocol.js'

const profileSchema = z.object({
  id: z.string().min(1).max(255),
  email: z.email().max(320),
  emailVerified: z.literal(true),
  name: z.string().trim().min(1).max(80).catch('학습자')
})

/** The Google-first implementation baseline is not a user-selected provider. */
export const createGoogleSsoProvider = (input: {
  clientId: string
  clientSecret: string
  callbackURL: string
}): SsoProvider => {
  const callback = new URL(input.callbackURL)
  if (
    callback.pathname !== '/api/auth/callback/google' ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password ||
    !(
      callback.protocol === 'https:' ||
      (callback.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(callback.hostname))
    )
  ) {
    throw new TypeError('Invalid SSO callback origin.')
  }
  const provider = google({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    prompt: 'select_account',
    accessType: 'online'
  })
  return {
    authorizationURL: async ({ state, nonce, codeVerifier }) => {
      const url = await provider.createAuthorizationURL({
        state,
        codeVerifier,
        redirectURI: callback.href
      })
      url.searchParams.set('nonce', nonce)
      return url.href
    },
    exchange: async ({
      code,
      nonce,
      codeVerifier
    }): Promise<SsoVerifiedIdentity | null> => {
      const tokens = await provider.validateAuthorizationCode({
        code,
        codeVerifier,
        redirectURI: callback.href
      })
      // In the installed library getUserInfo decodes a JWT. Verify signature,
      // issuer, audience, expiry/age and our nonce before using that profile.
      if (
        !tokens.idToken ||
        !(await provider.verifyIdToken(tokens.idToken, nonce))
      ) {
        return null
      }
      const info = await provider.getUserInfo(tokens)
      const parsed = profileSchema.safeParse(info?.user)
      if (!parsed.success) return null
      return {
        provider: 'google',
        accountId: parsed.data.id,
        email: parsed.data.email.toLowerCase(),
        name: parsed.data.name
      }
    }
  }
}
