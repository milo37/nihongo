import { google } from 'better-auth/social-providers'
import { verifyProviderIdToken } from 'better-auth/oauth2'
import { z } from 'zod'
import type { SsoProvider, SsoVerifiedIdentity } from './ssoProtocol.js'

const profileSchema = z.object({
  email: z.email().max(320),
  emailVerified: z.literal(true),
  name: z.string().trim().min(1).max(80).catch('학습자')
})
const subjectSchema = z.string().min(1).max(255)

const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const GOOGLE_REVOKE_TIMEOUT_MS = 5_000

/**
 * JLP-718: Google revokes the whole grant for any of its tokens. An already
 * revoked or expired token answers 400 invalid_token, which is the same end.
 */
export const revokeGoogleToken = async (
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> => {
  const response = await fetchImpl(GOOGLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(GOOGLE_REVOKE_TIMEOUT_MS)
  })
  if (response.ok) return true
  const body: unknown = await response.json().catch(() => null)
  return (
    response.status === 400 &&
    typeof body === 'object' &&
    body !== null &&
    (body as { error?: unknown }).error === 'invalid_token'
  )
}

/** The Google-first implementation baseline is not a user-selected provider. */
export const createGoogleSsoProvider = (input: {
  clientId: string
  clientSecret: string
  callbackURL: string
  fetch?: typeof fetch
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
        !(await verifyProviderIdToken(provider, tokens.idToken, nonce))
      ) {
        return null
      }
      const info = await provider.getUserInfo(tokens)
      const parsed = profileSchema.safeParse(info?.user)
      const subject = subjectSchema.safeParse(info?.data?.sub)
      if (!parsed.success || !subject.success) return null
      const accessToken = tokens.accessToken
      return {
        provider: 'google',
        accountId: subject.data,
        email: parsed.data.email.toLowerCase(),
        name: parsed.data.name,
        ...(accessToken
          ? { revokeGrant: () => revokeGoogleToken(accessToken, input.fetch) }
          : {})
      }
    }
  }
}
