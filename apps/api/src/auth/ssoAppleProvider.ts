import { isIP } from 'node:net'
import { apple } from 'better-auth/social-providers'
import { verifyProviderIdToken } from 'better-auth/oauth2'
import { z } from 'zod'
import type { SsoProvider } from './ssoProtocol.js'

const profileSchema = z.object({
  email: z.email().max(320),
  emailVerified: z.literal(true),
  name: z.string().trim().min(1).max(80).catch('학습자')
})
const subjectSchema = z.string().min(1).max(255)

export const createAppleSsoProvider = (input: {
  clientId: string
  clientSecret: string
  callbackURL: string
}): SsoProvider => {
  const callback = new URL(input.callbackURL)
  const hostname = callback.hostname
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '')
  if (
    !hostname.includes('.') ||
    isIP(hostname) !== 0 ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    callback.protocol !== 'https:' ||
    callback.pathname !== '/api/auth/callback/apple' ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password
  ) {
    throw new TypeError('Apple SSO requires an exact HTTPS callback.')
  }
  const provider = apple({
    clientId: input.clientId,
    clientSecret: input.clientSecret
  })
  return {
    authorizationURL: async ({ state, nonce, codeVerifier }) => {
      const url = await provider.createAuthorizationURL({
        state,
        codeVerifier,
        redirectURI: callback.href
      })
      url.searchParams.set('nonce', nonce)
      // Only the server token exchange supplies identity. Ignore front-channel
      // id_token and user JSON; Apple returns code/state by form_post.
      url.searchParams.set('response_type', 'code')
      return url.href
    },
    exchange: async ({ code, nonce, codeVerifier }) => {
      const tokens = await provider.validateAuthorizationCode({
        code,
        codeVerifier,
        redirectURI: callback.href
      })
      if (
        !tokens.idToken ||
        !(await verifyProviderIdToken(provider, tokens.idToken, nonce))
      )
        return null
      const info = await provider.getUserInfo(tokens)
      const parsed = profileSchema.safeParse(info?.user)
      const subject = subjectSchema.safeParse(info?.data?.sub)
      if (!parsed.success || !subject.success) return null
      return {
        provider: 'apple',
        accountId: subject.data,
        email: parsed.data.email.toLowerCase(),
        name: parsed.data.name
      }
    }
  }
}
